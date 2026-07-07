const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const {
  defaultTagFor,
  ensureMediaLibraryTable,
  getMedia,
  listMedia,
  mediaSummary,
  normalizeKeywords,
  normalizeTag,
} = require('../services/mediaLibrary');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function parseDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  return { mimeType: '', buffer: Buffer.from(text, 'base64') };
}

function inferMediaType(mimeType) {
  return String(mimeType || '').startsWith('image/') ? 'image' : 'document';
}

router.get('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await listMedia(clientId));
  } catch (err) {
    console.error('GET /media-library error:', err.message);
    res.status(500).json({ error: 'Failed to load media library' });
  }
});

router.post('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const filename = String(req.body.filename || 'agent-media').trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 180);
  const parsed = parseDataUrl(req.body.data);
  const mimeType = String(req.body.mime_type || parsed.mimeType || '').trim().toLowerCase();
  const buffer = parsed.buffer;
  const triggerKeywords = normalizeKeywords(req.body.trigger_keywords);
  const attachOnWelcome = req.body.attach_on_welcome === true;
  const suppliedTag = req.body.tag !== undefined ? String(req.body.tag || '').trim() : '';
  const tag = normalizeTag(suppliedTag);

  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (suppliedTag && !tag) return res.status(400).json({ error: 'Tag can use letters, numbers, hyphen or underscore' });
  if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: 'Upload a JPG, PNG, WEBP or PDF file' });
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) return res.status(400).json({ error: 'Media must be 1 byte to 8 MB' });
  if (!tag && !attachOnWelcome && triggerKeywords.length === 0) {
    return res.status(400).json({ error: 'Add a tag, trigger keywords or enable welcome attachment' });
  }

  try {
    await ensureMediaLibraryTable();
    const result = await db.query(
      `INSERT INTO media_library
         (client_id, title, tag, description, media_type, mime_type, filename,
          trigger_keywords, attach_on_welcome, is_active, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, TRUE, $10)
       RETURNING id, title, tag, description, media_type, mime_type, filename,
                 trigger_keywords, attach_on_welcome, is_active, created_at, updated_at`,
      [
        clientId,
        title.slice(0, 140),
        tag || null,
        description.slice(0, 1000) || null,
        inferMediaType(mimeType),
        mimeType,
        filename || 'agent-media',
        JSON.stringify(triggerKeywords),
        attachOnWelcome,
        buffer,
      ]
    );
    let row = result.rows[0];
    if (!row.tag) {
      const generatedTag = defaultTagFor(row);
      const updated = await db.query(
        `UPDATE media_library SET tag = $1, updated_at = NOW() WHERE client_id = $2 AND id = $3
         RETURNING id, title, tag, description, media_type, mime_type, filename,
                   trigger_keywords, attach_on_welcome, is_active, created_at, updated_at`,
        [generatedTag, clientId, row.id]
      );
      row = updated.rows[0];
    }
    res.status(201).json(mediaSummary(row));
  } catch (err) {
    console.error('POST /media-library error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'That media tag is already in use' });
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

router.patch('/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  const current = await getMedia(clientId, req.params.id);
  if (!current) return res.status(404).json({ error: 'Media not found' });

  const title = req.body.title !== undefined ? String(req.body.title || '').trim() : current.title;
  const description = req.body.description !== undefined ? String(req.body.description || '').trim() : current.description;
  const triggerKeywords = req.body.trigger_keywords !== undefined ? normalizeKeywords(req.body.trigger_keywords) : current.trigger_keywords;
  const attachOnWelcome = req.body.attach_on_welcome !== undefined ? req.body.attach_on_welcome === true : current.attach_on_welcome;
  const isActive = req.body.is_active !== undefined ? req.body.is_active === true : current.is_active;
  const suppliedTag = req.body.tag !== undefined ? String(req.body.tag || '').trim() : current.tag;
  const tag = normalizeTag(suppliedTag || defaultTagFor(current));

  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (!tag) return res.status(400).json({ error: 'Tag can use letters, numbers, hyphen or underscore' });
  if (isActive && !tag && !attachOnWelcome && triggerKeywords.length === 0) {
    return res.status(400).json({ error: 'Active media needs a tag, trigger keywords or welcome attachment' });
  }

  try {
    const result = await db.query(
      `UPDATE media_library
       SET title = $1,
           tag = $2,
           description = $3,
           trigger_keywords = $4::jsonb,
           attach_on_welcome = $5,
           is_active = $6,
           updated_at = NOW()
       WHERE client_id = $7 AND id = $8
       RETURNING id, title, tag, description, media_type, mime_type, filename,
                 trigger_keywords, attach_on_welcome, is_active, created_at, updated_at`,
      [title.slice(0, 140), tag, description || null, JSON.stringify(triggerKeywords), attachOnWelcome, isActive, clientId, req.params.id]
    );
    res.json(mediaSummary(result.rows[0]));
  } catch (err) {
    console.error('PATCH /media-library error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'That media tag is already in use' });
    res.status(500).json({ error: 'Failed to update media' });
  }
});

router.delete('/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;

  try {
    await ensureMediaLibraryTable();
    const result = await db.query(`DELETE FROM media_library WHERE client_id = $1 AND id = $2 RETURNING id`, [clientId, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Media not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /media-library error:', err.message);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

module.exports = router;
