const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'gls-salt-2026').digest('hex');
}

router.get('/', authMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT u.*, pn.number as phone_number_label
    FROM sales_users u
    LEFT JOIN phone_numbers pn ON pn.id = u.phone_number_id
    ORDER BY u.created_at DESC
  `).all().map(u => ({ ...u, password_hash: undefined }));
  res.json(users);
});

router.post('/', authMiddleware, (req, res) => {
  const { name, email, password, states = [], cities = [], phone_number_id } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  try {
    const r = db.prepare('INSERT INTO sales_users (name, email, password_hash, states, cities, phone_number_id) VALUES (?,?,?,?,?,?)')
      .run(name, email, hashPassword(password), JSON.stringify(states), JSON.stringify(cities), phone_number_id || null);
    res.status(201).json({ id: r.lastInsertRowid, name, email, states, cities, phone_number_id });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { name, email, password, states, cities, phone_number_id, is_active } = req.body;
  const existing = db.prepare('SELECT * FROM sales_users WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const pwHash = password ? hashPassword(password) : existing.password_hash;
  db.prepare('UPDATE sales_users SET name=?, email=?, password_hash=?, states=?, cities=?, phone_number_id=?, is_active=? WHERE id=?')
    .run(
      name ?? existing.name,
      email ?? existing.email,
      pwHash,
      states ? JSON.stringify(states) : existing.states,
      cities ? JSON.stringify(cities) : existing.cities,
      phone_number_id ?? existing.phone_number_id,
      is_active ?? existing.is_active,
      req.params.id
    );
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sales_users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
