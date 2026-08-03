const db = require('../src/db');

async function main() {
  const result = await db.query(
    `SELECT sampled_at, status, availability_score, freshness_score, runtime
     FROM billing_twin_health_samples
     ORDER BY sampled_at DESC
     LIMIT 1`
  );
  const sample = result.rows[0];
  if (!sample) throw new Error('No twin stability health sample found');
  console.log(JSON.stringify(sample, null, 2));
}

main()
  .then(() => db.end())
  .catch(async (error) => {
    console.error(error.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
