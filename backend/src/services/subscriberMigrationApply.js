const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { loadSubscriber, syncSubscriberRadius } = require('./radiusSync');
const { normalizeServiceType } = require('./subscriberMigrationPolicy');
const { syncHotspotMigrationMember, verifyMigrationCredentials } = require('./subscriberMigrationRadius');
const { ensureMigrationSchema, getBatch } = require('./subscriberMigrationSchema');
const {
  CONFIRMATION, clean, isActive, normalizeRouterAddress, serviceStatusFor,
} = require('./subscriberMigrationCommon');

const RADIUS_ONLY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(48).toString('base64url'), 6);

async function createPppSubscriber(client, batch, row) {
  const account = row.normalized;
  const serviceStatus = serviceStatusFor(account);
  const result = await client.query(
    `INSERT INTO billing_subscribers(
       client_id,plan_id,full_name,phone,email,account_number,radius_username,
       radius_password_ciphertext,radius_status,service_status,expires_at,
       router_id,router_name,access_mode,notes
     )
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,m.id,m.name,'pppoe',$11
     FROM mikrotik_routers m
     WHERE m.client_id=$1 AND m.id=$12
     RETURNING *`,
    [
      batch.client_id, row.matched_plan_id, account.full_name, account.phone || null,
      account.email || null, account.account_number, account.username, row.password_ciphertext,
      serviceStatus, account.expires_at, `Imported safely in migration batch ${batch.id}`, batch.router_id,
    ]
  );
  if (!result.rows[0]) throw new Error('The selected router is no longer available.');
  await client.query(
    `UPDATE billing_subscriber_migration_rows
     SET created_subscriber_id=$3,applied_at=NOW()
     WHERE client_id=$1 AND id=$2`,
    [batch.client_id, row.id, result.rows[0].id]
  );
}

async function createHotspotMember(client, batch, row) {
  const account = row.normalized;
  const result = await client.query(
    `INSERT INTO billing_hotspot_members(
       client_id,router_id,username,password_hash,rate_limit,is_active,full_name,
       account_number,phone,email,plan_id,password_ciphertext,expires_at,
       auth_source,source_migration_batch_id,radius_sync_status,updated_at
     )
     SELECT $1,$2,$3,$4,p.mikrotik_rate_limit,$5,$6,$7,$8,$9,p.id,$10,$11,
            'radius',$12,'pending',NOW()
     FROM billing_hotspot_plans p
     WHERE p.client_id=$1 AND p.id=$13
       AND EXISTS(
         SELECT 1 FROM mikrotik_routers r
         WHERE r.client_id=$1 AND r.id=$2 AND r.is_active=TRUE
       )
     RETURNING *`,
    [
      batch.client_id, batch.router_id, account.username, RADIUS_ONLY_PASSWORD_HASH,
      isActive(account), account.full_name, account.account_number, account.phone || null,
      account.email || null, row.password_ciphertext, account.expires_at, batch.id,
      row.matched_hotspot_plan_id,
    ]
  );
  if (!result.rows[0]) throw new Error('The selected Hotspot package or router is no longer available.');
  await client.query(
    `UPDATE billing_subscriber_migration_rows
     SET created_hotspot_member_id=$3,applied_at=NOW()
     WHERE client_id=$1 AND id=$2`,
    [batch.client_id, row.id, result.rows[0].id]
  );
}

async function syncBatchCredentials(clientId, batchId) {
  const batch = (await db.query(
    `SELECT * FROM billing_subscriber_migration_batches WHERE client_id=$1 AND id=$2`,
    [clientId, batchId]
  )).rows[0];
  if (!batch) throw new Error('Migration batch was not found.');
  const serviceType = normalizeServiceType(batch.service_type);
  const failures = [];
  let synced = 0;

  if (serviceType === 'pppoe') {
    const rows = (await db.query(
      `SELECT created_subscriber_id AS id
       FROM billing_subscriber_migration_rows
       WHERE client_id=$1 AND batch_id=$2 AND created_subscriber_id IS NOT NULL
       ORDER BY row_number`,
      [clientId, batchId]
    )).rows;
    for (const row of rows) {
      try {
        const subscriber = await loadSubscriber(row.id, clientId);
        if (!subscriber) throw new Error('Imported subscriber was not found.');
        await syncSubscriberRadius(subscriber);
        synced += 1;
      } catch (error) {
        failures.push({ subscriber_id: row.id, error: clean(error.message, 300) });
      }
    }
  } else {
    const rows = (await db.query(
      `SELECT m.*,
              COALESCE(r.wireguard_address,r.private_tunnel_ip,r.management_ip) AS router_address,
              p.mikrotik_rate_limit
       FROM billing_subscriber_migration_rows mr
       JOIN billing_hotspot_members m
         ON m.id=mr.created_hotspot_member_id AND m.client_id=mr.client_id
       JOIN mikrotik_routers r
         ON r.id=m.router_id AND r.client_id=m.client_id
       LEFT JOIN billing_hotspot_plans p
         ON p.id=m.plan_id AND p.client_id=m.client_id
       WHERE mr.client_id=$1 AND mr.batch_id=$2 AND mr.created_hotspot_member_id IS NOT NULL
       ORDER BY mr.row_number`,
      [clientId, batchId]
    )).rows;
    for (const member of rows) {
      try {
        const sync = await syncHotspotMigrationMember({
          ...member,
          router_address: normalizeRouterAddress(member.router_address),
          rate_limit: member.rate_limit || member.mikrotik_rate_limit || null,
        });
        await db.query(
          `UPDATE billing_hotspot_members
           SET radius_sync_status=$3,radius_sync_error=NULL,radius_last_synced_at=NOW(),updated_at=NOW()
           WHERE client_id=$1 AND id=$2`,
          [clientId, member.id, sync.status]
        );
        synced += 1;
      } catch (error) {
        await db.query(
          `UPDATE billing_hotspot_members
           SET radius_sync_status='failed',radius_sync_error=$3,radius_last_synced_at=NOW(),updated_at=NOW()
           WHERE client_id=$1 AND id=$2`,
          [clientId, member.id, clean(error.message, 500)]
        ).catch(() => {});
        failures.push({ hotspot_member_id: member.id, error: clean(error.message, 300) });
      }
    }
  }

  await db.query(
    `UPDATE billing_subscriber_migration_batches
     SET status=$3,summary=summary||$4::jsonb
     WHERE client_id=$1 AND id=$2`,
    [
      clientId, batchId, failures.length ? 'sync_attention' : 'radius_ready',
      JSON.stringify({ radius_synced: synced, radius_failures: failures, radius_sync_checked_at: new Date().toISOString() }),
    ]
  );
  return { synced, failures };
}

async function applyMigration(input) {
  await ensureMigrationSchema();
  if (clean(input.confirmation).toUpperCase() !== CONFIRMATION) {
    throw new Error('Enter the exact migration confirmation phrase.');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const batch = (await client.query(
      `SELECT * FROM billing_subscriber_migration_batches
       WHERE client_id=$1 AND id=$2 FOR UPDATE`,
      [input.clientId, input.batchId]
    )).rows[0];
    if (!batch) throw new Error('Migration batch was not found.');
    if (batch.status !== 'validated') throw new Error('This migration batch has already changed.');
    if (Number(batch.error_rows)) throw new Error('Resolve every row marked as an error before migration.');
    const serviceType = normalizeServiceType(batch.service_type);
    const rows = (await client.query(
      `SELECT * FROM billing_subscriber_migration_rows
       WHERE client_id=$1 AND batch_id=$2 ORDER BY row_number FOR UPDATE`,
      [input.clientId, input.batchId]
    )).rows;
    for (const row of rows) {
      if (serviceType === 'hotspot') await createHotspotMember(client, batch, row);
      else await createPppSubscriber(client, batch, row);
    }
    await client.query(
      `UPDATE billing_subscriber_migration_batches
       SET status='applied',approved_by=$3,approved_at=NOW(),applied_at=NOW()
       WHERE client_id=$1 AND id=$2`,
      [input.clientId, input.batchId, input.adminId || null]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await syncBatchCredentials(input.clientId, input.batchId);
  return getBatch(input.clientId, input.batchId);
}

async function activeMigrationUsernames(clientId, batchId) {
  const rows = (await db.query(
    `SELECT normalized
     FROM billing_subscriber_migration_rows
     WHERE client_id=$1 AND batch_id=$2
       AND (created_subscriber_id IS NOT NULL OR created_hotspot_member_id IS NOT NULL)`,
    [clientId, batchId]
  )).rows;
  return rows.map((row) => row.normalized).filter(isActive)
    .map((account) => clean(account.username, 180)).filter(Boolean);
}

async function verifyBatchCredentials(clientId, batchId) {
  const usernames = await activeMigrationUsernames(clientId, batchId);
  const verification = await verifyMigrationCredentials(usernames);
  if (verification.missing.length) {
    throw new Error(
      `RADIUS verification failed for ${verification.missing.length} active imported account(s): ${verification.missing.slice(0, 5).join(', ')}`
    );
  }
  return verification;
}

module.exports = { applyMigration, syncBatchCredentials, verifyBatchCredentials };
