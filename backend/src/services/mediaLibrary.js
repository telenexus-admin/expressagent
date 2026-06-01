const db = require('../db');

let ready = false;

async function ensureMediaLibraryTable() {
  if (ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS media_library (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title VARCHAR(140) NOT NULL,
      tag VARCHAR(80),
      description TEXT,
      media_type VARCHAR(30) NOT NULL CHECK (media_type IN ('image', 'document')),
      mime_type VARCHAR(100) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      trigger_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
      attach_on_welcome BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      data BYTEA NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE media_library DROP CONSTRAINT IF EXISTS media_library_media_type_check`);
  await db.query(`ALTER TABLE media_library ADD CONSTRAINT media_library_media_type_check CHECK (media_type IN ('image', 'document'))`);
  await db.query(`ALTER TABLE media_library ADD COLUMN IF NOT EXISTS tag VARCHAR(80)`);
  await db.query(`
    UPDATE media_library
    SET tag = CASE WHEN media_type = 'image' THEN 'image' || id ELSE 'doc' || id END
    WHERE tag IS NULL OR tag = ''
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_media_library_client ON media_library(client_id, is_active, attach_on_welcome)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_media_library_client_tag_unique ON media_library(client_id, LOWER(tag)) WHERE tag IS NOT NULL AND tag <> ''`);
  ready = true;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeTag(value) {
  const stripped = String(value || '')
    .trim()
    .replace(/^\{+|\}+$/g, '')
    .trim()
    .toLowerCase();
  return stripped.replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

function defaultTagFor(row) {
  if (!row || !row.id) return '';
  return `${row.media_type === 'image' ? 'image' : 'doc'}${row.id}`;
}

function extractMediaTags(text) {
  const tags = [];
  const seen = new Set();
  const matches = String(text || '').matchAll(/\{([a-zA-Z0-9_-]{1,80})\}/g);
  for (const match of matches) {
    const tag = normalizeTag(match[1]);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function stripMediaTags(text) {
  return String(text || '')
    .replace(/[ \t]*\{[a-zA-Z0-9_-]{1,80}\}[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mediaSummary(row) {
  return {
    id: row.id,
    title: row.title,
    tag: row.tag || defaultTagFor(row),
    description: row.description || '',
    media_type: row.media_type,
    mime_type: row.mime_type,
    filename: row.filename,
    trigger_keywords: Array.isArray(row.trigger_keywords) ? row.trigger_keywords : [],
    attach_on_welcome: row.attach_on_welcome === true,
    is_active: row.is_active === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listMedia(clientId) {
  await ensureMediaLibraryTable();
  const result = await db.query(
    `SELECT id, title, tag, description, media_type, mime_type, filename, trigger_keywords,
            attach_on_welcome, is_active, created_at, updated_at
     FROM media_library
     WHERE client_id = $1
     ORDER BY attach_on_welcome DESC, created_at DESC`,
    [clientId]
  );
  return result.rows.map(mediaSummary);
}

async function getMedia(clientId, id) {
  await ensureMediaLibraryTable();
  const result = await db.query(
    `SELECT * FROM media_library WHERE client_id = $1 AND id = $2 LIMIT 1`,
    [clientId, id]
  );
  return result.rows[0] || null;
}

async function welcomeMedia(clientId) {
  await ensureMediaLibraryTable();
  const result = await db.query(
    `SELECT * FROM media_library
     WHERE client_id = $1 AND is_active = TRUE AND attach_on_welcome = TRUE
     ORDER BY created_at DESC
     LIMIT 3`,
    [clientId]
  );
  return result.rows;
}

async function matchingMedia(clientId, text, { limit = 2 } = {}) {
  await ensureMediaLibraryTable();
  const haystack = String(text || '').toLowerCase();
  if (!haystack.trim()) return [];

  const result = await db.query(
    `SELECT * FROM media_library
     WHERE client_id = $1 AND is_active = TRUE
     ORDER BY attach_on_welcome DESC, created_at DESC`,
    [clientId]
  );

  return result.rows
    .map((row) => {
      const keywords = Array.isArray(row.trigger_keywords) ? row.trigger_keywords : [];
      const score = keywords.reduce((total, keyword) => (
        keyword && haystack.includes(String(keyword).toLowerCase()) ? total + 1 : total
      ), 0);
      return { row, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row);
}

async function mediaByTags(clientId, textOrTags, { limit = 5 } = {}) {
  await ensureMediaLibraryTable();
  const tags = Array.isArray(textOrTags)
    ? textOrTags.map(normalizeTag).filter(Boolean)
    : extractMediaTags(textOrTags);
  if (tags.length === 0) return [];

  const result = await db.query(
    `SELECT * FROM media_library
     WHERE client_id = $1 AND is_active = TRUE AND LOWER(tag) = ANY($2::text[])`,
    [clientId, tags.slice(0, limit)]
  );

  const byTag = new Map(result.rows.map((row) => [String(row.tag || '').toLowerCase(), row]));
  return tags
    .map((tag) => byTag.get(tag))
    .filter(Boolean)
    .slice(0, limit);
}

function uniqueMediaItems(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of group || []) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

module.exports = {
  defaultTagFor,
  extractMediaTags,
  getMedia,
  ensureMediaLibraryTable,
  listMedia,
  matchingMedia,
  mediaByTags,
  mediaSummary,
  normalizeKeywords,
  normalizeTag,
  stripMediaTags,
  uniqueMediaItems,
  welcomeMedia,
};
