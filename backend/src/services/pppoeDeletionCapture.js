const db = require('../db');
const { ensurePppoeLifecycleSchema } = require('./pppoeLifecycleController');

async function ensurePppoeDeletionCapture() {
  await ensurePppoeLifecycleSchema();

  await db.query(`
    CREATE OR REPLACE FUNCTION polyizon_capture_pppoe_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.radius_username IS NOT NULL
         AND BTRIM(OLD.radius_username) <> ''
         AND OLD.radius_password_ciphertext IS NOT NULL
         AND BTRIM(OLD.radius_password_ciphertext) <> ''
         AND COALESCE(OLD.access_mode, 'pppoe') IN ('pppoe', 'pppoe_static') THEN
        INSERT INTO billing_pppoe_lifecycle_state (
          subscriber_id,
          client_id,
          router_id,
          radius_username,
          plan_id,
          rate_limit,
          access_active,
          service_status,
          radius_status,
          effective_expires_at,
          last_action,
          last_error,
          last_seen_at,
          updated_at
        ) VALUES (
          OLD.id,
          OLD.client_id,
          OLD.router_id,
          OLD.radius_username,
          OLD.plan_id,
          NULL,
          TRUE,
          OLD.service_status,
          OLD.radius_status,
          CASE
            WHEN OLD.expires_at IS NULL THEN NULL
            ELSE OLD.expires_at + (COALESCE(OLD.grace_period_days, 0) * INTERVAL '1 day')
          END,
          'delete_pending',
          NULL,
          NOW(),
          NOW()
        )
        ON CONFLICT (subscriber_id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          router_id = EXCLUDED.router_id,
          radius_username = EXCLUDED.radius_username,
          plan_id = EXCLUDED.plan_id,
          access_active = TRUE,
          service_status = EXCLUDED.service_status,
          radius_status = EXCLUDED.radius_status,
          effective_expires_at = EXCLUDED.effective_expires_at,
          last_action = 'delete_pending',
          last_error = NULL,
          last_seen_at = NOW(),
          updated_at = NOW();
      END IF;
      RETURN OLD;
    END;
    $$
  `);

  await db.query('DROP TRIGGER IF EXISTS billing_subscribers_capture_pppoe_delete ON billing_subscribers');
  await db.query(`
    CREATE TRIGGER billing_subscribers_capture_pppoe_delete
    BEFORE DELETE ON billing_subscribers
    FOR EACH ROW
    EXECUTE FUNCTION polyizon_capture_pppoe_delete()
  `);
}

module.exports = { ensurePppoeDeletionCapture };
