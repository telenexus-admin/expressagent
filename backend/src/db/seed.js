require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Seed a single bootstrap superadmin. All other configuration (clients,
// per-client agent prompts, Meta credentials) is created through the
// admin UI's Clients page after first login.
async function seed() {
  try {
    const hash = await bcrypt.hash('admin123', 12);

    await pool.query(
      `INSERT INTO admins (name, email, password_hash, role, client_id)
       VALUES ($1, $2, $3, 'superadmin', NULL)
       ON CONFLICT (email) DO NOTHING`,
      ['Super Admin', 'admin@example.com', hash]
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
