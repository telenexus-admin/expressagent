const db = require('../db');

let schemaPromise = null;

function normalizeHotspotDeviceLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, Math.min(20, parsed));
}

async function ensureHotspotPlanSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        ALTER TABLE billing_hotspot_plans
        ADD COLUMN IF NOT EXISTS max_devices INTEGER NOT NULL DEFAULT 1
      `);

      await db.query(`
        UPDATE billing_hotspot_plans
        SET max_devices = 1
        WHERE max_devices IS NULL
           OR max_devices < 1
           OR max_devices > 20
      `);

      await db.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'billing_hotspot_plans_max_devices_check'
          ) THEN
            ALTER TABLE billing_hotspot_plans
            ADD CONSTRAINT billing_hotspot_plans_max_devices_check
            CHECK (max_devices BETWEEN 1 AND 20);
          END IF;
        END
        $$
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

module.exports = {
  ensureHotspotPlanSchema,
  normalizeHotspotDeviceLimit,
};
