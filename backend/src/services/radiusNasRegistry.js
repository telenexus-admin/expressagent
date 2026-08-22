
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
    ORDER BY
      table_schema,
      table_name,
      ordinal_position
  `);

  const grouped = new Map();

  for (const row of result.rows) {
    const key =
      `${row.table_schema}.${row.table_name}`;

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
    const lowerName =
      String(table.table || '').toLowerCase();

    /*
     * Do not infer a RADIUS NAS table merely because an
     * unrelated application table contains an IP field and
     * a password field.
     */
    if (!KNOWN_TABLES.has(lowerName)) {
      continue;
    }

    const ipColumn = findColumn(
      table.rows,
      IP_COLUMNS
    );

    const secretColumn = findColumn(
      table.rows,
      SECRET_COLUMNS
    );

    if (!ipColumn || !secretColumn) {
      continue;
    }

    const identifierColumn = findColumn(
      table.rows,
      IDENTIFIER_COLUMNS
    );

    const typeColumn = findColumn(
      table.rows,
      ['type', 'nastype', 'nas_type']
    );

    const portsColumn = findColumn(
      table.rows,
      ['ports', 'port_count']
    );

    const serverColumn = findColumn(
      table.rows,
      ['server', 'virtual_server']
    );

    const communityColumn = findColumn(
      table.rows,
      ['community', 'snmp_community']
    );

    const descriptionColumn = findColumn(
      table.rows,
      ['description', 'comment', 'notes']
    );

    const suppliedColumns = new Set(
      [
        ipColumn,
        secretColumn,
        identifierColumn,
        typeColumn,
        portsColumn,
        serverColumn,
        communityColumn,
        descriptionColumn,
      ].filter(Boolean)
    );

    /*
     * A valid candidate must not require unknown values such
     * as operation, tenant_id or application-specific fields.
     * Such a table belongs to another subsystem and must not
     * receive RADIUS client secrets.
     */
    const unsupportedRequired =
      table.rows.filter(
        (row) =>
          row.is_nullable === 'NO' &&
          row.column_default == null &&
          row.is_identity !== 'YES' &&
          row.is_generated !== 'ALWAYS' &&
          !suppliedColumns.has(row.column_name)
      );

    if (unsupportedRequired.length) {
      continue;
    }

    let score = 100;

    if (lowerName === 'nas') {
      score += 100;
    }

    if (table.schema === 'public') {
      score += 20;
    }

    candidates.push({
      ...table,
      ipColumn,
      secretColumn,
      identifierColumn,
      typeColumn,
      portsColumn,
      serverColumn,
      communityColumn,
      descriptionColumn,
      score,
    });
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score
  );

  return candidates[0] || null;
}

async function discoverNasSyncQueue(pool) {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'nexa_nas_sync'
  `);

  const columns = new Set(
    result.rows.map(
      (row) => String(row.column_name)
    )
  );

  const required = [
    'nasname',
    'shortname',
    'secret',
    'operation',
    'status',
    'attempts',
    'last_error',
    'applied_at',
    'updated_at',
  ];

  if (
    !required.every(
      (column) => columns.has(column)
    )
  ) {
    return null;
  }

  return {
    schema: 'public',
    table: 'nexa_nas_sync',
  };
}
async function inspectRadiusNasRegistration(pool) {
  const syncQueue =
    await discoverNasSyncQueue(pool);

  if (syncQueue) {
    return {
      mode: 'sync_queue',
      schema: syncQueue.schema,
      table: syncQueue.table,
    };
  }

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

  throw new Error('No approved database-backed RADIUS NAS registration target was found');
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

function wait(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, milliseconds)
  );
}

async function registerSyncQueue(
  pool,
  queue,
  credential,
  routerName
) {
  const qualifiedTable =
    `${quoteIdentifier(queue.schema)}.` +
    quoteIdentifier(queue.table);

  await pool.query(
    `INSERT INTO ${qualifiedTable}
       (
         nasname,
         shortname,
         secret,
         operation,
         status,
         attempts,
         last_error,
         applied_at,
         updated_at
       )
     VALUES (
       $1,
       $2,
       $3,
       'register',
       'pending',
       0,
       NULL,
       NULL,
       NOW()
     )
     ON CONFLICT (nasname)
     DO UPDATE SET
       shortname = EXCLUDED.shortname,
       secret = EXCLUDED.secret,
       operation = 'register',
       status = 'pending',
       attempts = 0,
       last_error = NULL,
       applied_at = NULL,
       updated_at = NOW()`,
    [
      credential.nas_ip,
      credential.nas_identifier ||
        safeClientName(routerName),
      credential.secret,
    ]
  );

  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT
         status,
         attempts,
         last_error,
         applied_at,
         updated_at
       FROM ${qualifiedTable}
       WHERE nasname = $1
       LIMIT 1`,
      [credential.nas_ip]
    );

    const row = result.rows[0];

    if (row?.status === 'applied') {
      return {
        mode: 'sync_queue',
        location:
          `${queue.schema}.${queue.table}`,
        status: 'applied',
        applied_at: row.applied_at,
      };
    }

    if (row?.status === 'failed') {
      throw new Error(
        row.last_error ||
        `RADIUS NAS registration failed after ${
          row.attempts || 0
        } attempts`
      );
    }

    await wait(1000);
  }

  throw new Error(
    'The RADIUS server did not confirm NAS registration within 60 seconds'
  );
}
async function registerRadiusNas(
  pool,
  credential,
  routerName
) {
  const syncQueue =
    await discoverNasSyncQueue(pool);

  if (syncQueue) {
    return registerSyncQueue(
      pool,
      syncQueue,
      credential,
      routerName
    );
  }

  const sqlTable = await discoverSqlNasTable(pool);

  if (sqlTable) {
    return registerSqlClient(
      pool,
      sqlTable,
      credential,
      routerName
    );
  }

  throw new Error('RADIUS NAS registration requires the approved database-backed synchronizer');
}

module.exports = {
  inspectRadiusNasRegistration,
  registerRadiusNas,
};
