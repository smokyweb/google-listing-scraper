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
    ORDER BY u.id ASC
  `).all().map(u => ({ ...u, password_hash: undefined }));
  res.json(users);
});

router.post('/', authMiddleware, (req, res) => {
  const { name, email, password, states = [], cities = [], phone_number_id, forward_number } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

  // Enforce phone number exclusivity: check if this number is already assigned to another user
  if (phone_number_id) {
    const conflict = db.prepare('SELECT id, name FROM sales_users WHERE phone_number_id = ?').get(phone_number_id);
    if (conflict) return res.status(409).json({ error: `Phone number is already assigned to ${conflict.name}. Each phone number may only be assigned to one salesperson.` });
  }

  try {
    const r = db.prepare('INSERT INTO sales_users (name, email, password_hash, states, cities, phone_number_id, forward_number) VALUES (?,?,?,?,?,?,?)')
      .run(name, email, hashPassword(password), JSON.stringify(states), JSON.stringify(cities), phone_number_id || null, forward_number || null);
    res.status(201).json({ id: r.lastInsertRowid, name, email, states, cities, phone_number_id, forward_number });
  } catch (e) {
    if (e.message.includes('UNIQUE') && e.message.includes('phone_number_id')) return res.status(409).json({ error: 'Phone number is already assigned to another salesperson.' });
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { name, email, password, states, cities, phone_number_id, is_active, forward_number } = req.body;
  const existing = db.prepare('SELECT * FROM sales_users WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const pwHash = password ? hashPassword(password) : existing.password_hash;
  // Validate phone_number_id exists (may have been deleted during sync)
  let validPhoneId = phone_number_id !== undefined ? (phone_number_id || null) : existing.phone_number_id;
  if (validPhoneId) {
    const phoneExists = db.prepare('SELECT id FROM phone_numbers WHERE id = ?').get(validPhoneId);
    if (!phoneExists) validPhoneId = null;
  }

  // Enforce phone number exclusivity: new assignment must not be taken by another user
  if (validPhoneId !== null && validPhoneId !== existing.phone_number_id) {
    const conflict = db.prepare('SELECT id, name FROM sales_users WHERE phone_number_id = ? AND id != ?').get(validPhoneId, req.params.id);
    if (conflict) return res.status(409).json({ error: `Phone number is already assigned to ${conflict.name}. Each phone number may only be assigned to one salesperson.` });
  }

  try {
    db.prepare('UPDATE sales_users SET name=?, email=?, password_hash=?, states=?, cities=?, phone_number_id=?, is_active=?, forward_number=? WHERE id=?')
      .run(
        name !== undefined ? name : existing.name,
        email !== undefined ? email : existing.email,
        pwHash,
        states ? JSON.stringify(states) : existing.states,
        cities ? JSON.stringify(cities) : existing.cities,
        validPhoneId,
        is_active !== undefined ? is_active : existing.is_active,
        forward_number !== undefined ? (forward_number || null) : existing.forward_number,
        req.params.id
      );
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE') && e.message.includes('phone_number_id')) return res.status(409).json({ error: 'Phone number is already assigned to another salesperson.' });
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sales_users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
