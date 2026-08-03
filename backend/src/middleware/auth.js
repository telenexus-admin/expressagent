const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

function superadminMiddleware(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden: superadmin access required' });
  }
  next();
}

// Resolves the effective client_id for a request:
//   - Regular admins: locked to their own client_id (query param is ignored).
//   - Superadmins: may pass ?clientId= to scope to a specific client; otherwise null = all clients.
// Sets req.scope = { clientId: number | null, isSuperadmin: boolean }
function scopeMiddleware(req, res, next) {
  const isSuperadmin = req.user.role === 'superadmin';
  if (isSuperadmin) {
    const raw = req.query.clientId;
    const parsed = raw ? parseInt(raw, 10) : null;
    req.scope = {
      isSuperadmin: true,
      clientId: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    };
  } else {
    if (!req.user.client_id) {
      return res.status(403).json({ error: 'Forbidden: admin account is not assigned to a client' });
    }
    req.scope = { isSuperadmin: false, clientId: req.user.client_id };
  }
  next();
}

module.exports = { authMiddleware, superadminMiddleware, scopeMiddleware };
