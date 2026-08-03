const db = require('../db');
const { appendBillingEvent, ensureEventSchema } = require('./events');

const BASELINE_SOURCES = [
  {
    table: 'billing_subscribers',
    entityType: 'subscriber',
    sensitivity: 'confidential',
    query: `SELECT
      id, client_id, plan_id, full_name, phone, email, account_number,
      radius_username, radius_status, service_status, expires_at, router_id,
      router_name, access_mode, vlan_id, static_ip::text AS static_ip,
      created_at, updated_at
    FROM billing_subscribers`,
    name: (row) => row.full_name,
    related: (row) => [
      row.plan_id && { entityType: 'package', entityId: row.plan_id, relationship: 'subscribed_to' },
      row.router_id && { entityType: 'router', entityId: row.router_id, relationship: 'connected_through' },
    ],
  },
  {
    table: 'billing_plans',
    entityType: 'package',
    query: `SELECT
      id, client_id, name, description, download_speed_mbps, upload_speed_mbps,
      price, validity_days, radius_profile, router_id, fup_enabled,
      fup_threshold_mb, fup_download_speed_mbps, fup_upload_speed_mbps,
      is_active, created_at, updated_at
    FROM billing_plans`,
    name: (row) => row.name,
    related: (row) => [
      row.router_id && { entityType: 'router', entityId: row.router_id, relationship: 'allocated_to' },
    ],
  },
  {
    table: 'billing_hotspot_plans',
    entityType: 'hotspot_package',
    query: `SELECT
      id, client_id, name, price, duration_minutes, data_limit_mb,
      mikrotik_rate_limit, router_id, fup_enabled, fup_threshold_mb,
      fup_download_speed_mbps, fup_upload_speed_mbps, is_active,
      created_at, updated_at
    FROM billing_hotspot_plans`,
    name: (row) => row.name,
    related: (row) => [
      row.router_id && { entityType: 'router', entityId: row.router_id, relationship: 'allocated_to' },
    ],
  },
  {
    table: 'billing_invoices',
    entityType: 'invoice',
    sensitivity: 'confidential',
    query: `SELECT
      id, client_id, subscriber_id, invoice_number, amount, status,
      due_date, paid_at, created_at
    FROM billing_invoices`,
    name: (row) => row.invoice_number,
    related: (row) => [
      row.subscriber_id && { entityType: 'subscriber', entityId: row.subscriber_id, relationship: 'billed_to' },
    ],
  },
  {
    table: 'billing_payments',
    entityType: 'payment',
    sensitivity: 'confidential',
    query: `SELECT
      id, client_id, subscriber_id, invoice_id, amount, method, reference,
      status, paid_at, created_at
    FROM billing_payments`,
    name: (row) => row.reference || `Payment ${row.id}`,
    related: (row) => [
      row.subscriber_id && { entityType: 'subscriber', entityId: row.subscriber_id, relationship: 'paid_by' },
      row.invoice_id && { entityType: 'invoice', entityId: row.invoice_id, relationship: 'settles' },
    ],
  },
  {
    table: 'employees',
    entityType: 'employee',
    sensitivity: 'confidential',
    query: `SELECT
      id, client_id, name, role, location, phone, email, is_active, created_at
    FROM employees`,
    name: (row) => row.name,
  },
  {
    table: 'tickets',
    entityType: 'ticket',
    sensitivity: 'confidential',
    query: `SELECT
      id, client_id, conversation_id, customer_name, title, category, priority,
      status, source, summary, assigned_admin_id, assigned_employee_id,
      opened_at, updated_at, resolved_at
    FROM tickets`,
    name: (row) => row.title,
    related: (row) => [
      row.assigned_employee_id && {
        entityType: 'employee',
        entityId: row.assigned_employee_id,
        relationship: 'assigned_to',
      },
      row.conversation_id && {
        entityType: 'conversation',
        entityId: row.conversation_id,
        relationship: 'originated_from',
      },
    ],
  },
  {
    table: 'mikrotik_routers',
    entityType: 'router',
    sensitivity: 'restricted',
    query: `SELECT
      id, client_id, name, port, connection_type, features, is_active,
      last_status, last_error, last_identity, last_version, last_uptime,
      last_seen_at, created_at, updated_at
    FROM mikrotik_routers`,
    name: (row) => row.name,
  },
  {
    table: 'tr069_device_cache',
    idColumn: 'device_id',
    entityType: 'ont',
    sensitivity: 'restricted',
    query: `SELECT
      device_id, client_id, serial_number, manufacturer, model_name,
      software_version, ip_address, mac_address, ssid, rx_power_dbm,
      tx_power_dbm, uptime_seconds, last_inform, status, synced_at
    FROM tr069_device_cache`,
    name: (row) => [row.manufacturer, row.model_name, row.serial_number].filter(Boolean).join(' '),
  },
];

let bootstrapRunning = false;

function compactRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([key, value]) => key !== 'client_id' && key !== 'id' && value !== null)
  );
}

function relatedEntities(source, row) {
  if (!source.related) return [];
  return source.related(row).filter(Boolean).map((item) => ({
    ...item,
    entityId: String(item.entityId),
  }));
}

async function tableExists(queryable, table) {
  const result = await queryable.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`]);
  return result.rows[0]?.exists === true;
}

async function captureKnowledgeBaseline() {
  if (bootstrapRunning) return { skipped: true, captured: 0, duplicates: 0 };
  bootstrapRunning = true;
  const client = await db.connect();
  let captured = 0;
  let duplicates = 0;
  try {
    await ensureEventSchema(db);
    for (const source of BASELINE_SOURCES) {
      if (!(await tableExists(client, source.table))) continue;
      const result = await client.query(source.query);
      for (const row of result.rows) {
        const entityId = row[source.idColumn || 'id'];
        if (!row.client_id || entityId === null || entityId === undefined) continue;
        await client.query('BEGIN');
        try {
          const state = compactRow(row);
          const resultEvent = await appendBillingEvent(client, {
            clientId: row.client_id,
            eventType: 'knowledge.baseline_captured',
            category: 'knowledge',
            source: 'knowledge.bootstrap',
            entityType: source.entityType,
            entityId: String(entityId),
            actorType: 'system',
            severity: 'info',
            sensitivity: source.sensitivity || 'internal',
            title: `${source.entityType.replace(/_/g, ' ')} baseline captured`,
            description: `Current ${source.entityType.replace(/_/g, ' ')} state was captured for Nexa knowledge.`,
            payload: {
              display_name: source.name?.(row) || null,
              baseline_source: source.table,
            },
            newState: state,
            relatedEntities: relatedEntities(source, row),
            occurredAt: row.updated_at || row.synced_at || row.created_at || row.opened_at || new Date(),
            deduplicationKey: `knowledge-baseline:${source.table}:${entityId}`,
          });
          await client.query('COMMIT');
          if (resultEvent.duplicate) duplicates += 1;
          else captured += 1;
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not start */ }
          throw error;
        }
      }
    }
    return { captured, duplicates };
  } finally {
    client.release();
    bootstrapRunning = false;
  }
}

function startKnowledgeBootstrapScheduler() {
  const run = () => captureKnowledgeBaseline()
    .then((result) => {
      if (result.captured) {
        console.log(`Nexa knowledge baseline captured ${result.captured} existing records.`);
      }
    })
    .catch((error) => console.error('Nexa knowledge baseline failed:', error.message));
  setTimeout(run, 3000);
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = {
  BASELINE_SOURCES,
  captureKnowledgeBaseline,
  compactRow,
  relatedEntities,
  startKnowledgeBootstrapScheduler,
};
