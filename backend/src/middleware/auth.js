const jwt = require('jsonwebtoken');
const db = require('../db');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized: no token provided' });
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    if (Number.isInteger(req.user.session_version)) {
      const result = await db.query('SELECT session_version FROM admins WHERE id = $1 LIMIT 1', [req.user.id]);
      if (!result.rows[0] || result.rows[0].session_version !== req.user.session_version) return res.status(401).json({ error: 'Unauthorized: session has expired. Please sign in again.' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

function superadminMiddleware(req, res, next) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden: superadmin access required' });
  next();
}

function scopeMiddleware(req, res, next) {
  const isSuperadmin = req.user.role === 'superadmin';
  if (isSuperadmin) {
    const parsed = req.query.clientId ? parseInt(req.query.clientId, 10) : null;
    req.scope = { isSuperadmin: true, clientId: Number.isInteger(parsed) && parsed > 0 ? parsed : null };
  } else {
    if (!req.user.client_id) return res.status(403).json({ error: 'Forbidden: admin account is not assigned to a client' });
    req.scope = { isSuperadmin: false, clientId: req.user.client_id };
  }
  next();
}

module.exports = { authMiddleware, superadminMiddleware, scopeMiddleware };