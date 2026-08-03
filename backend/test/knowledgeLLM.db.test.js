const crypto = require('crypto');
const db = require('../src/db');
const {
  ensureLLMSchema,
  listKnowledgeInsights,
} = require('../src/services/knowledgeLLM');

async function run() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureLLMSchema(client);
    const tenants = await client.query(
      `INSERT INTO clients (name, account_type)
       VALUES ($1, 'billing'), ($2, 'billing')
       RETURNING id`,
      [`LLM Isolation A ${crypto.randomUUID()}`, `LLM Isolation B ${crypto.randomUUID()}`]
    );
    const tenantA = tenants.rows[0].id;
    const tenantB = tenants.rows[1].id;
    const eventA = crypto.randomUUID();
    const eventB = crypto.randomUUID();
    await client.query(
      `INSERT INTO billing_events (
         id, client_id, event_type, event_category, source,
         entity_type, entity_id, title, occurred_at
       ) VALUES
         ($1,$2,'router.status_changed','router','test','router','router-a','Alpha router status',NOW()),
         ($3,$4,'router.status_changed','router','test','router','router-b','Beta router status',NOW())
       RETURNING *`,
      [eventA, tenantA, eventB, tenantB]
    );
    const facts = await client.query(
      `INSERT INTO billing_knowledge_facts (
         event_id, client_id, event_type, event_category, entity_type, entity_id,
         severity, sensitivity, fact_text, occurred_at
       ) VALUES
         ($1,$2,'router.status_changed','router','router','router-a','warning','restricted','Alpha router changed status',NOW()),
         ($3,$4,'router.status_changed','router','router','router-b','warning','restricted','Beta router changed status',NOW())
       RETURNING *`,
      [eventA, tenantA, eventB, tenantB]
    );
    await client.query(
      `INSERT INTO billing_knowledge_llm_jobs (
         fact_id, event_id, client_id, status, attempts, enriched_at
       ) VALUES
         ($1,$2,$3,'enriched',1,NOW()),
         ($4,$5,$6,'enriched',1,NOW())
       RETURNING *`,
      [facts.rows[0].id, eventA, tenantA, facts.rows[1].id, eventB, tenantB]
    );
    await client.query(
      `INSERT INTO billing_knowledge_insights (
         fact_id, event_id, client_id, insight_type, summary, risk_level,
         confidence, anomaly, tags, recommended_actions, model,
         prompt_version, prompt_hash, input_hash
       ) VALUES
         ($1,$2,$3,'network','Alpha tenant insight','high',0.9,TRUE,'["router"]','[]','synthetic','test','hash','input'),
         ($4,$5,$6,'network','Beta tenant insight','low',0.8,FALSE,'["router"]','[]','synthetic','test','hash','input')`,
      [facts.rows[0].id, eventA, tenantA, facts.rows[1].id, eventB, tenantB]
    );

    const alpha = await listKnowledgeInsights(tenantA, { queryable: client });
    const beta = await listKnowledgeInsights(tenantB, { queryable: client });
    if (alpha.length !== 1 || alpha[0].summary !== 'Alpha tenant insight') {
      throw new Error('Tenant A did not receive exactly its own LLM insight');
    }
    if (beta.length !== 1 || beta[0].summary !== 'Beta tenant insight') {
      throw new Error('Tenant B did not receive exactly its own LLM insight');
    }

    const eventC = crypto.randomUUID();
    await client.query(
      `INSERT INTO billing_events (
         id, client_id, event_type, event_category, source,
         entity_type, entity_id, title, occurred_at
       ) VALUES ($1,$2,'router.updated','router','test','router','router-c','Cross tenant guard',NOW())`,
      [eventC, tenantA]
    );
    const factC = await client.query(
      `INSERT INTO billing_knowledge_facts (
         event_id, client_id, event_type, event_category, entity_type, entity_id,
         severity, sensitivity, fact_text, occurred_at
       ) VALUES ($1,$2,'router.updated','router','router','router-c','info','restricted','Cross tenant guard',NOW())
       RETURNING id`,
      [eventC, tenantA]
    );
    await client.query('SAVEPOINT mismatched_tenant');
    let mismatchRejected = false;
    try {
      await client.query(
        `INSERT INTO billing_knowledge_llm_jobs (fact_id, event_id, client_id)
         VALUES ($1,$2,$3)`,
        [factC.rows[0].id, eventC, tenantB]
      );
    } catch {
      mismatchRejected = true;
      await client.query('ROLLBACK TO SAVEPOINT mismatched_tenant');
    }
    if (!mismatchRejected) throw new Error('Cross-tenant LLM job was not rejected');

    await client.query('ROLLBACK');
    console.log('Knowledge LLM schema and tenant-isolation tests passed and were rolled back.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* transaction did not start */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
