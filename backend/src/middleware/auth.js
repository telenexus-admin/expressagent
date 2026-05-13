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

module.exports = { authMiddleware, superadminMiddleware };
