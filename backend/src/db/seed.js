require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEFAULT_SYSTEM_PROMPT = `You are a helpful and professional customer support agent. Your goals are:
- Answer customer questions accurately and concisely
- Be polite, empathetic, and solution-focused
- If you cannot resolve an issue, let the customer know a human agent will follow up soon
- Never make up information you are unsure about
- Keep responses brief and easy to read on a mobile device`;

async function seed() {
  try {
    const hash = await bcrypt.hash('admin123', 12);

    await pool.query(
      `INSERT INTO admins (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ['Super Admin', 'admin@example.com', hash, 'superadmin']
    );

    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ('system_prompt', $1)
       ON CONFLICT (key) DO NOTHING`,
      [DEFAULT_SYSTEM_PROMPT]
    );

    console.log('Seed completed.');
    console.warn('\n============================================================');
    console.warn('  WARNING: Default superadmin account created:');
    console.warn('    Email:    admin@example.com');
    console.warn('    Password: admin123');
    console.warn('  CHANGE THESE CREDENTIALS IMMEDIATELY IN PRODUCTION!');
    console.warn('============================================================\n');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
