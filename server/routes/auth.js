const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { getSecret } = require('../middleware/auth');

const DEFAULT_PASSWORD = 'admin';

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'gls-salt-2026').digest('hex');
}

// Admin login (password only)
router.post('/login', (req, res) => {
  const { password } = req.body;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
  const storedPassword = row?.value || process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

  if (password !== storedPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = jwt.sign({ role: 'admin' }, getSecret(), { expiresIn: '24h' });
  res.json({ token, role: 'admin' });
});

// Salesperson login (email + password)
router.post('/salesperson-login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM sales_users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const hashed = hashPassword(password);
  if (hashed !== user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({
    role: 'salesperson',
    userId: user.id,
    name: user.name,
    email: user.email,
    states: user.states,
    phone_number_id: user.phone_number_id,
  }, getSecret(), { expiresIn: '24h' });

  res.json({
    token,
    role: 'salesperson',
    user: { id: user.id, name: user.name, email: user.email, states: JSON.parse(user.states || '[]'), phone_number_id: user.phone_number_id },
  });
});

// Verify token (works for both admin and salesperson)
router.get('/verify', (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ valid: false });
  try {
    const payload = jwt.verify(header.split(' ')[1], getSecret());
    res.json({ valid: true, role: payload.role, user: payload.role === 'salesperson' ? { id: payload.userId, name: payload.name, email: payload.email } : null });
  } catch {
    res.status(401).json({ valid: false });
  }
});

module.exports = router;
