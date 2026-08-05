const fs = require('fs');
const path = require('path');
const {
  execFile,
} = require('child_process');
const {
  promisify,
} = require('util');

const execFileAsync = promisify(execFile);

const IP_COLUMNS = [
  'nasname',
  'nasipaddress',
  'nas_ip_address',
  'nas_ip',
  'ipaddress',
  'ip_address',
  'ipaddr',
  'address',
  'host',
];

const SECRET_COLUMNS = [
  'secret',
  'sharedsecret',
  'shared_secret',
  'radius_secret',
  'radiussecret',
  'password',
];

const IDENTIFIER_COLUMNS = [
  'shortname',
  'short_name',
  'nasidentifier',
  'nas_identifier',
  'name',
];

const KNOWN_TABLES = new Set([
  'nas',
  'radnas',
  'radius_nas',
  'radiusnas',
  'radius_clients',
  'radiusclients',
  'nas_clients',
  'nasclients',
]);

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function safeClientName(value) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  return cleaned || 'nexa-router';
}

function radiusQuoted(value) {
  return `"${String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}

function findColumn(rows, candidates) {
  const columns = new Map(
    rows.map((row) => [
      String(row.column_name).toLowerCase(),
      row.column_name,
    ])
  );

  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return columns.get(candidate);
    }
  }

  return null;
}

async function discoverSqlNasTable(pool) {
  const result = await pool.query(`
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default,
      is_identity,
      is_generated
    FROM information_schema.columns
    WHERE table_schema NOT IN (
      'pg_catalog',
      'information_schema'
    )
    ORDER BY table_schema, table_name, ordinal_position
  `);

  const grouped = new Map();

  for (const row of result.rows) {
    const key = `${row.table_schema}.${row.table_name}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        schema: row.table_schema,
        table: row.table_name,
        rows: [],
      });
    }

    grouped.get(key).rows.push(row);
  }

  const candidates = [];

  for (const table of grouped.values()) {
    const ipColumn = findColumn(
      table.rows,
      IP_COLUMNS
    );

    const secretColumn = findColumn(
      table.rows,
      SECRET_COLUMNS
    );

    if (!ipColumn || !secretColumn) continue;

    const lowerName = table.table.toLowerCase();

    let score = 0;

    if (KNOWN_TABLES.has(lowerName)) score += 100;
    if (lowerName === 'nas') score += 100;
    if (table.schema === 'public') score += 20;

    candidates.push({
      ...table,
      ipColumn,
      secretColumn,
      identifierColumn: findColumn(
        table.rows,
        IDENTIFIER_COLUMNS
      ),
      typeColumn: findColumn(
        table.rows,
        ['type', 'nastype', 'nas_type']
      ),
      portsColumn: findColumn(
        table.rows,
        ['ports', 'port_count']
      ),
      serverColumn: findColumn(
        table.rows,
        ['server', 'virtual_server']
      ),
      communityColumn: findColumn(
        table.rows,
        ['community', 'snmp_community']
      ),
      descriptionColumn: findColumn(
        table.rows,
        ['description', 'comment', 'notes']
      ),
      score,
    });
  }

  candidates.sort(
    (left, right) => right.score - left.score
  );

  return candidates[0] || null;
}

function findClientsDirectory() {
  const candidates = [
    process.env.FREERADIUS_CLIENTS_DIR,
    '/etc/freeradius/3.2/clients.d',
    '/etc/freeradius/3.0/clients.d',
    '/etc/freeradius/3.1/clients.d',
    '/etc/raddb/clients.d',
  ].filter(Boolean);

  for (const directory of candidates) {
    if (!fs.existsSync(directory)) continue;

    try {
      fs.accessSync(
        directory,
        fs.constants.W_OK
      );
    } catch (_) {
      continue;
    }

    const parent = path.dirname(directory);
    const clientsFile = path.join(
      parent,
      'clients.conf'
    );

    if (!fs.existsSync(clientsFile)) continue;

    const contents = fs.readFileSync(
      clientsFile,
      'utf8'
    );

    if (
      contents.includes('clients.d') ||
      contents.includes(path.basename(directory))
    ) {
      return directory;
    }
  }

  return null;
}

async function resolveRadiusCommand() {
  const candidates = [
    '/usr/sbin/freeradius',
    '/usr/sbin/radiusd',
    'freeradius',
    'radiusd',
  ];

  for (const candidate of candidates) {
    try {
      await execFileAsync(
        candidate,
        ['-v'],
        { timeout: 5000 }
      );

      return candidate;
    } catch (error) {
      if (
        error.code !== 'ENOENT' &&
        error.code !== 127
      ) {
        return candidate;
      }
    }
  }

  return null;
}

async function resolveRadiusService() {
  for (const service of [
    'freeradius',
    'radiusd',
  ]) {
    try {
      const result = await execFileAsync(
        'systemctl',
        [
          'show',
          service,
          '--property=LoadState',
          '--value',
        ],
        { timeout: 5000 }
      );

      if (
        String(result.stdout || '').trim() ===
        'loaded'
      ) {
        return service;
      }
    } catch (_) {
      // Try the next common service name.
    }
  }

  return null;
}

async function inspectRadiusNasRegistration(pool) {
  const sqlTable = await discoverSqlNasTable(pool);

  if (sqlTable) {
    return {
      mode: 'sql',
      schema: sqlTable.schema,
      table: sqlTable.table,
      ip_column: sqlTable.ipColumn,
      secret_column: sqlTable.secretColumn,
    };
  }

  const directory = findClientsDirectory();
  const command = await resolveRadiusCommand();
  const service = await resolveRadiusService();

  if (directory && command && service) {
    return {
      mode: 'file',
      directory,
      command,
      service,
    };
  }

  throw new Error(
    'No compatible SQL NAS table or local FreeRADIUS clients.d configuration was found'
  );
}

async function registerSqlClient(
  pool,
  table,
  credential,
  routerName
) {
  const values = new Map();

  const add = (column, value) => {
    if (column && !values.has(column)) {
      values.set(column, value);
    }
  };

  add(table.ipColumn, credential.nas_ip);
  add(table.secretColumn, credential.secret);
  add(
    table.identifierColumn,
    credential.nas_identifier
  );
  add(table.typeColumn, 'other');
  add(table.portsColumn, 0);
  add(table.serverColumn, '');
  add(table.communityColumn, '');
  add(
    table.descriptionColumn,
    `Nexa managed MikroTik: ${routerName}`
  );

  const supplied = [...values.keys()];
  const updateColumns = supplied.filter(
    (column) => column !== table.ipColumn
  );

  const qualifiedTable =
    `${quoteIdentifier(table.schema)}.` +
    quoteIdentifier(table.table);

  let found = 0;

  if (updateColumns.length) {
    const assignments = updateColumns
      .map(
        (column, index) =>
          `${quoteIdentifier(column)} = $${index + 2}`
      )
      .join(', ');

    const updated = await pool.query(
      `UPDATE ${qualifiedTable}
       SET ${assignments}
       WHERE ${quoteIdentifier(table.ipColumn)} = $1`,
      [
        values.get(table.ipColumn),
        ...updateColumns.map(
          (column) => values.get(column)
        ),
      ]
    );

    found = updated.rowCount;
  }

  if (!found) {
    const missingRequired = table.rows.filter(
      (row) =>
        row.is_nullable === 'NO' &&
        row.column_default == null &&
        row.is_identity !== 'YES' &&
        row.is_generated !== 'ALWAYS' &&
        !values.has(row.column_name)
    );

    if (missingRequired.length) {
      throw new Error(
        `The RADIUS client table requires unsupported columns: ${
          missingRequired
            .map((row) => row.column_name)
            .join(', ')
        }`
      );
    }

    const columns = supplied
      .map(quoteIdentifier)
      .join(', ');

    const placeholders = supplied
      .map((_, index) => `$${index + 1}`)
      .join(', ');

    await pool.query(
      `INSERT INTO ${qualifiedTable}
       (${columns})
       VALUES (${placeholders})`,
      supplied.map(
        (column) => values.get(column)
      )
    );
  }

  return {
    mode: 'sql',
    location: `${table.schema}.${table.table}`,
  };
}

async function registerFileClient(
  credential,
  routerName
) {
  const directory = findClientsDirectory();
  const command = await resolveRadiusCommand();
  const service = await resolveRadiusService();

  if (!directory || !command || !service) {
    throw new Error(
      'Local FreeRADIUS client registration is unavailable'
    );
  }

  const clientName = safeClientName(
    credential.nas_identifier
  );

  const target = path.join(
    directory,
    `nexa-${clientName}.conf`
  );

  const temporary = `${target}.tmp-${process.pid}`;
  const previous = fs.existsSync(target)
    ? fs.readFileSync(target)
    : null;

  const configuration = [
    `client ${clientName} {`,
    `  ipaddr = ${credential.nas_ip}`,
    `  secret = ${radiusQuoted(credential.secret)}`,
    `  shortname = ${safeClientName(routerName)}`,
    '  nas_type = other',
    '}',
    '',
  ].join('\n');

  fs.writeFileSync(
    temporary,
    configuration,
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);

  try {
    await execFileAsync(
      command,
      ['-XC'],
      {
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );

    await execFileAsync(
      'systemctl',
      ['reload-or-restart', service],
      {
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      }
    );
  } catch (error) {
    if (previous) {
      fs.writeFileSync(target, previous, {
        mode: 0o600,
      });
    } else {
      fs.rmSync(target, { force: true });
    }

    throw new Error(
      `FreeRADIUS client configuration failed: ${
        error.stderr ||
        error.stdout ||
        error.message
      }`
    );
  }

  return {
    mode: 'file',
    location: target,
  };
}

async function registerRadiusNas(
  pool,
  credential,
  routerName
) {
  const sqlTable = await discoverSqlNasTable(pool);

  if (sqlTable) {
    return registerSqlClient(
      pool,
      sqlTable,
      credential,
      routerName
    );
  }

  return registerFileClient(
    credential,
    routerName
  );
}

module.exports = {
  inspectRadiusNasRegistration,
  registerRadiusNas,
};
