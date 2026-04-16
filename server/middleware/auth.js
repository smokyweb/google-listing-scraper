const jwt = require('jsonwebtoken');
const db = require('../db');

function getSecret() {
  return process.env.JWT_SECRET || 'default-jwt-secret-change-me';
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.split(' ')[1];
    jwt.verify(token, getSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authMiddleware, getSecret };
