require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('Adding installation email workflow fields...');
  await pool.query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS support_email VARCHAR(255);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS installation_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS request_email_status VARCHAR(20) NOT NULL DEFAULT 'skipped';
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS request_email_error TEXT;
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS confirmation_email_status VARCHAR(20) NOT NULL DEFAULT 'skipped';
    ALTER TABLE escalations ADD COLUMN IF NOT EXISTS confirmation_email_error TEXT;
  `);
  console.log('Installation email workflow fields are ready.');
}

main()
  .catch((err) => {
    console.error('Email workflow migration failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
