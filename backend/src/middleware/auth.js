const jwt = require('jsonwebtoken');
const db = require('../db');
const {
  authenticateAccessCookie,
  verifyCsrf,
} = require('../security/adminSessions');

async function legacyBearer(req) {
  if (String(process.env.ALLOW_LEGACY_BEARER || 'false').toLowerCase() !== 'true') return null;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  const result = await db.query(`
    SELECT a.session_version, a.role, a.client_id, c.status AS client_status
      FROM admins a LEFT JOIN clients c ON c.id=a.client_id
     WHERE a.id=$1 LIMIT 1`, [payload.id]);
  const current = result.rows[0];
  if (!current || Number(current.session_version) !== Number(payload.session_version || 1)) return null;
  if (current.role !== 'superadmin' && current.client_status === 'suspended') return null;
  return payload;
}

async function authMiddleware(req, res, next) {
  try {
    const cookieAuth = await authenticateAccessCookie(req);
    if (cookieAuth) {
      if (!verifyCsrf(req, cookieAuth)) {
        return res.status(403).json({ error: 'Security validation failed. Refresh the page and try again.' });
      }
      req.user = cookieAuth.user;
      req.authMode = 'secure_cookie';
      req.authSessionId = cookieAuth.row.auth_session_id;
      req.authRow = cookieAuth.row;
      return next();
    }

    const legacy = await legacyBearer(req);
    if (legacy) {
      req.user = legacy;
      req.authMode = 'legacy_bearer';
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: session is missing or expired' });
  } catch (error) {
    if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') {
      console.error('Authentication middleware error:', error.message);
    }
    return res.status(401).json({ error: 'Unauthorized: invalid or expired session' });
  }
}

function superadminMiddleware(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden: superadmin access required' });
  }
  return next();
}

function scopeMiddleware(req, res, next) {
  const isSuperadmin = req.user.role === 'superadmin';
  if (isSuperadmin) {
    const parsed = req.query.clientId ? Number.parseInt(req.query.clientId, 10) : null;
    req.scope = {
      isSuperadmin: true,
      clientId: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    };
  } else {
    if (!req.user.client_id) {
      return res.status(403).json({ error: 'Forbidden: administrator is not assigned to a billing account' });
    }
    req.scope = { isSuperadmin: false, clientId: Number(req.user.client_id) };
  }
  return next();
}

module.exports = { authMiddleware, superadminMiddleware, scopeMiddleware };
