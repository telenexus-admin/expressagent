const axios = require('axios');
const db = require('../db');

const MAX_PAGE_BYTES = 900 * 1024;
const MAX_CONTEXT_CHARS = 6000;
const AUTO_REFRESH_INTERVALS = [5, 10, 30];
let websiteKnowledgeSchedulerStarted = false;
let websiteKnowledgeRefreshRunning = false;

async function ensureWebsiteKnowledgeTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS website_knowledge (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title VARCHAR(180) NOT NULL,
      url TEXT NOT NULL,
      summary TEXT,
      content TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      auto_refresh_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      refresh_interval_minutes INTEGER NOT NULL DEFAULT 30,
      last_refresh_error TEXT,
      fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE website_knowledge ADD COLUMN IF NOT EXISTS auto_refresh_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE website_knowledge ADD COLUMN IF NOT EXISTS refresh_interval_minutes INTEGER NOT NULL DEFAULT 30`);
  await db.query(`ALTER TABLE website_knowledge ADD COLUMN IF NOT EXISTS last_refresh_error TEXT`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_website_knowledge_client_active ON website_knowledge(client_id, is_active, fetched_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_website_knowledge_auto_refresh ON website_knowledge(is_active, auto_refresh_enabled, fetched_at)`);
}

function normalizeRefreshInterval(value) {
  const parsed = Number(value);
  if (!AUTO_REFRESH_INTERVALS.includes(parsed)) return 30;
  return parsed;
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Website URL is required');
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('Enter a valid website URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS website links are supported');
  url.hash = '';
  return url.toString();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractText(html) {
  const source = String(html || '');
  const title = decodeHtml((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const body = source
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|header|footer|main|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeHtml(body)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function fetchWebsiteText(url) {
  const normalizedUrl = normalizeUrl(url);
  const response = await axios.get(normalizedUrl, {
    responseType: 'text',
    timeout: 20000,
    maxContentLength: MAX_PAGE_BYTES,
    headers: {
      'User-Agent': 'NexaAI-KnowledgeBot/1.0',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  const raw = String(response.data || '');
  const extracted = contentType.includes('html') ? extractText(raw) : { title: '', text: raw.replace(/\s+/g, ' ').trim() };
  if (!extracted.text || extracted.text.length < 80) throw new Error('I could not read enough text from that website. Try a public page with visible text.');
  return {
    url: normalizedUrl,
    title: extracted.title || new URL(normalizedUrl).hostname,
    content: extracted.text.slice(0, 30000),
  };
}

function rowSummary(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    summary: row.summary || '',
    is_active: row.is_active !== false,
    auto_refresh_enabled: row.auto_refresh_enabled === true,
    refresh_interval_minutes: normalizeRefreshInterval(row.refresh_interval_minutes),
    last_refresh_error: row.last_refresh_error || '',
    fetched_at: row.fetched_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    content_preview: String(row.content || '').slice(0, 220),
  };
}

async function listWebsiteKnowledge(clientId) {
  await ensureWebsiteKnowledgeTable();
  const result = await db.query(
    `SELECT id, title, url, summary, content, is_active, auto_refresh_enabled,
            refresh_interval_minutes, last_refresh_error, fetched_at, created_at, updated_at
     FROM website_knowledge
     WHERE client_id = $1
     ORDER BY fetched_at DESC, id DESC`,
    [clientId]
  );
  return result.rows.map(rowSummary);
}

async function createWebsiteKnowledge(clientId, { url, title = '', summary = '', auto_refresh_enabled = false, refresh_interval_minutes = 30 }) {
  if (!clientId) throw new Error('Client is required');
  const fetched = await fetchWebsiteText(url);
  await ensureWebsiteKnowledgeTable();
  const result = await db.query(
    `INSERT INTO website_knowledge
       (client_id, title, url, summary, content, is_active, auto_refresh_enabled, refresh_interval_minutes)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
     RETURNING id, title, url, summary, content, is_active, auto_refresh_enabled,
               refresh_interval_minutes, last_refresh_error, fetched_at, created_at, updated_at`,
    [
      clientId,
      String(title || fetched.title).trim().slice(0, 180),
      fetched.url,
      String(summary || '').trim().slice(0, 1000) || null,
      fetched.content,
      auto_refresh_enabled === true,
      normalizeRefreshInterval(refresh_interval_minutes),
    ]
  );
  return rowSummary(result.rows[0]);
}

async function refreshWebsiteKnowledge(clientId, id) {
  await ensureWebsiteKnowledgeTable();
  const current = await db.query(`SELECT * FROM website_knowledge WHERE client_id = $1 AND id = $2`, [clientId, id]);
  if (!current.rows[0]) return null;
  const fetched = await fetchWebsiteText(current.rows[0].url);
  const result = await db.query(
    `UPDATE website_knowledge
     SET title = $1, content = $2, fetched_at = NOW(), updated_at = NOW(), last_refresh_error = NULL
     WHERE client_id = $3 AND id = $4
     RETURNING id, title, url, summary, content, is_active, auto_refresh_enabled,
               refresh_interval_minutes, last_refresh_error, fetched_at, created_at, updated_at`,
    [current.rows[0].title || fetched.title, fetched.content, clientId, id]
  );
  return rowSummary(result.rows[0]);
}

async function updateWebsiteKnowledge(clientId, id, fields = {}) {
  await ensureWebsiteKnowledgeTable();
  const nextTitle = fields.title !== undefined ? String(fields.title || '').trim().slice(0, 180) : '';
  const result = await db.query(
    `UPDATE website_knowledge
     SET title = CASE WHEN $1::boolean THEN $2 ELSE title END,
         summary = CASE WHEN $3::boolean THEN $4 ELSE summary END,
         is_active = CASE WHEN $5::boolean THEN $6 ELSE is_active END,
         auto_refresh_enabled = CASE WHEN $7::boolean THEN $8 ELSE auto_refresh_enabled END,
         refresh_interval_minutes = CASE WHEN $9::boolean THEN $10 ELSE refresh_interval_minutes END,
         updated_at = NOW()
     WHERE client_id = $11 AND id = $12
     RETURNING id, title, url, summary, content, is_active, auto_refresh_enabled,
               refresh_interval_minutes, last_refresh_error, fetched_at, created_at, updated_at`,
    [
      Boolean(nextTitle),
      nextTitle || null,
      fields.summary !== undefined,
      fields.summary !== undefined ? String(fields.summary || '').trim().slice(0, 1000) || null : null,
      fields.is_active !== undefined,
      fields.is_active === true,
      fields.auto_refresh_enabled !== undefined,
      fields.auto_refresh_enabled === true,
      fields.refresh_interval_minutes !== undefined,
      normalizeRefreshInterval(fields.refresh_interval_minutes),
      clientId,
      id,
    ]
  );
  return result.rows[0] ? rowSummary(result.rows[0]) : null;
}

async function refreshWebsiteKnowledgeRow(row) {
  const fetched = await fetchWebsiteText(row.url);
  await db.query(
    `UPDATE website_knowledge
     SET title = COALESCE(NULLIF(title, ''), $1),
         content = $2,
         fetched_at = NOW(),
         updated_at = NOW(),
         last_refresh_error = NULL
     WHERE id = $3`,
    [fetched.title, fetched.content, row.id]
  );
}

async function runDueWebsiteKnowledgeRefreshes() {
  if (websiteKnowledgeRefreshRunning) return;
  websiteKnowledgeRefreshRunning = true;
  try {
    await ensureWebsiteKnowledgeTable();
    const result = await db.query(
      `SELECT id, client_id, title, url, refresh_interval_minutes
       FROM website_knowledge
       WHERE is_active = TRUE
         AND auto_refresh_enabled = TRUE
         AND fetched_at <= NOW() - (refresh_interval_minutes || ' minutes')::interval
       ORDER BY fetched_at ASC
       LIMIT 10`
    );
    for (const row of result.rows) {
      try {
        await refreshWebsiteKnowledgeRow(row);
        console.log(`Website knowledge refreshed for client ${row.client_id}: ${row.url}`);
      } catch (err) {
        const message = String(err.message || 'Refresh failed').slice(0, 1000);
        await db.query(`UPDATE website_knowledge SET last_refresh_error = $1, updated_at = NOW() WHERE id = $2`, [message, row.id]);
        console.error(`Website knowledge refresh failed for ${row.url}:`, message);
      }
    }
  } catch (err) {
    console.error('Website knowledge scheduler error:', err.message);
  } finally {
    websiteKnowledgeRefreshRunning = false;
  }
}

function startWebsiteKnowledgeScheduler() {
  if (websiteKnowledgeSchedulerStarted) return;
  websiteKnowledgeSchedulerStarted = true;
  runDueWebsiteKnowledgeRefreshes();
  setInterval(runDueWebsiteKnowledgeRefreshes, 60 * 1000);
  console.log('Website knowledge polling scheduler ready for 5/10/30 minute refreshes.');
}

async function deleteWebsiteKnowledge(clientId, id) {
  await ensureWebsiteKnowledgeTable();
  const result = await db.query(`DELETE FROM website_knowledge WHERE client_id = $1 AND id = $2 RETURNING id`, [clientId, id]);
  return Boolean(result.rows[0]);
}

async function buildWebsiteKnowledgeContext(clientId) {
  await ensureWebsiteKnowledgeTable();
  const result = await db.query(
    `SELECT title, url, summary, content
     FROM website_knowledge
     WHERE client_id = $1 AND is_active = TRUE
     ORDER BY fetched_at DESC, id DESC
     LIMIT 4`,
    [clientId]
  );
  if (result.rows.length === 0) return '';
  let remaining = MAX_CONTEXT_CHARS;
  const sections = [];
  for (const row of result.rows) {
    if (remaining <= 0) break;
    const head = `Website: ${row.title}\nURL: ${row.url}${row.summary ? `\nAdmin note: ${row.summary}` : ''}\n`;
    const body = String(row.content || '').slice(0, Math.max(400, remaining - head.length));
    remaining -= head.length + body.length;
    sections.push(`${head}Content:\n${body}`);
  }
  return (
    `\n\nWEBSITE KNOWLEDGE BASE:\n` +
    `Use the following admin-approved website knowledge when relevant. Do not mention that you scraped it unless asked.\n\n` +
    sections.join('\n\n---\n\n')
  );
}

module.exports = {
  buildWebsiteKnowledgeContext,
  createWebsiteKnowledge,
  deleteWebsiteKnowledge,
  ensureWebsiteKnowledgeTable,
  listWebsiteKnowledge,
  refreshWebsiteKnowledge,
  runDueWebsiteKnowledgeRefreshes,
  startWebsiteKnowledgeScheduler,
  updateWebsiteKnowledge,
};
