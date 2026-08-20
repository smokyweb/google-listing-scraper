const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const crypto = require('crypto');

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'gls-salt-2026').digest('hex');
}

// Admin-only middleware: only admin tokens may manage the sales-user list.
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

router.get('/', authMiddleware, (req, res) => {
  const users = req.user.role === 'admin'
    ? db.prepare(`
        SELECT u.*, pn.number as phone_number_label
        FROM sales_users u
        LEFT JOIN phone_numbers pn ON pn.id = u.phone_number_id
        ORDER BY u.id ASC
      `).all()
    : db.prepare(`
        SELECT u.*, pn.number as phone_number_label
        FROM sales_users u
        LEFT JOIN phone_numbers pn ON pn.id = u.phone_number_id
        WHERE u.id = ?
      `).all(req.user.userId);
  const safeUsers = users.map(u => ({ ...u, password_hash: undefined }));
  res.json(safeUsers);
});

router.post('/', authMiddleware, adminOnly, (req, res) => {
  const { name, email, password, states = [], cities = [], phone_number_id, forward_number } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

  // Normalize phone_number_id: must be a positive integer or null
  const phoneId = phone_number_id ? parseInt(phone_number_id, 10) : null;
  if (phoneId) {
    // Validate the phone number exists in the phone_numbers table
    const phoneRow = db.prepare('SELECT id FROM phone_numbers WHERE id = ?').get(phoneId);
    if (!phoneRow) return res.status(400).json({ error: 'Invalid phone_number_id: phone number does not exist.' });
    // Enforce exclusivity: reject if ANY user (active or inactive) already holds this number
    const conflict = db.prepare('SELECT id, name FROM sales_users WHERE phone_number_id = ?').get(phoneId);
    if (conflict) return res.status(409).json({ error: `Phone number is already assigned to ${conflict.name}. Each phone number may only be assigned to one salesperson.` });
  }

  try {
    const r = db.prepare('INSERT INTO sales_users (name, email, password_hash, states, cities, phone_number_id, forward_number) VALUES (?,?,?,?,?,?,?)')
      .run(name, email, hashPassword(password), JSON.stringify(states), JSON.stringify(cities), phoneId, forward_number || null);
    res.status(201).json({ id: r.lastInsertRowid, name, email, states, cities, phone_number_id: phoneId, forward_number });
  } catch (e) {
    if (e.message.includes('UNIQUE') && e.message.includes('phone_number_id')) return res.status(409).json({ error: 'Phone number is already assigned to another salesperson.' });
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { name, email, password, states, cities, phone_number_id, is_active, forward_number } = req.body;
  const userId = parseInt(req.params.id, 10);
  if (req.user.role === 'salesperson') {
    if (userId !== req.user.userId) return res.status(403).json({ error: 'You may only update your own profile.' });
    const allowed = ['forward_number'];
    const unexpected = Object.keys(req.body).some(key => !allowed.includes(key));
    if (unexpected) return res.status(403).json({ error: 'Salespersons may only update their forwarded number.' });
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const existing = db.prepare('SELECT * FROM sales_users WHERE id=?').get(userId);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const pwHash = password ? hashPassword(password) : existing.password_hash;

  // Normalize phone_number_id: always compare as integers to avoid type-mismatch bugs
  // (body sends strings, SQLite stores integers).
  let validPhoneId;
  if (phone_number_id !== undefined) {
    // Explicit value sent: normalize to int or null
    validPhoneId = phone_number_id ? (parseInt(phone_number_id, 10) || null) : null;
  } else {
    // Not sent at all: keep existing assignment
    validPhoneId = existing.phone_number_id ? parseInt(existing.phone_number_id, 10) : null;
  }

  // Validate phone_number_id exists in phone_numbers (guards against deleted numbers)
  if (validPhoneId !== null) {
    const phoneExists = db.prepare('SELECT id FROM phone_numbers WHERE id = ?').get(validPhoneId);
    if (!phoneExists) validPhoneId = null;
  }

  // Enforce exclusivity: only check conflict when assigning a DIFFERENT number.
  // Compare as integers to avoid "5" !== 5 false mismatches.
  const existingPhoneId = existing.phone_number_id ? parseInt(existing.phone_number_id, 10) : null;
  if (validPhoneId !== null && validPhoneId !== existingPhoneId) {
    // Reject if any user (active or inactive) already holds this number
    const conflict = db.prepare('SELECT id, name FROM sales_users WHERE phone_number_id = ? AND id != ?').get(validPhoneId, userId);
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
        userId
      );
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE') && e.message.includes('phone_number_id')) return res.status(409).json({ error: 'Phone number is already assigned to another salesperson.' });
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authMiddleware, adminOnly, (req, res) => {
  db.prepare('DELETE FROM sales_users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
