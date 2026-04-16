const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { getSecret } = require('../middleware/auth');

const DEFAULT_PASSWORD = 'admin';

router.post('/login', (req, res) => {
  const { password } = req.body;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
  const storedPassword = row?.value || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

  if (password !== storedPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = jwt.sign({ role: 'admin' }, getSecret(), { expiresIn: '24h' });
  res.json({ token });
});

router.get('/verify', (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false });
  }
  try {
    jwt.verify(header.split(' ')[1], getSecret());
    res.json({ valid: true });
  } catch {
    res.status(401).json({ valid: false });
  }
});

module.exports = router;
