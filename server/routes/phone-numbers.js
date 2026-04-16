const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET all phone numbers
router.get('/', authMiddleware, (req, res) => {
  const numbers = db.prepare('SELECT * FROM phone_numbers ORDER BY is_default DESC, created_at ASC').all();
  res.json(numbers);
});

// POST add a new phone number
router.post('/', authMiddleware, (req, res) => {
  const { label, number, provider = 'signalwire', is_default = 0 } = req.body;
  if (!label || !number) return res.status(400).json({ error: 'label and number are required' });

  // Format number: ensure it starts with +1 for US
  let formatted = number.replace(/\D/g, '');
  if (formatted.length === 10) formatted = '1' + formatted;
  if (!formatted.startsWith('+')) formatted = '+' + formatted;

  try {
    // If setting as default, clear other defaults first
    if (is_default) {
      db.prepare('UPDATE phone_numbers SET is_default = 0').run();
    }

    const result = db.prepare(
      'INSERT INTO phone_numbers (label, number, provider, is_default) VALUES (?, ?, ?, ?)'
    ).run(label, formatted, provider, is_default ? 1 : 0);

    res.json({ id: result.lastInsertRowid, label, number: formatted, provider, is_default });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'This phone number is already added' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH update a phone number
router.patch('/:id', authMiddleware, (req, res) => {
  const { label, number, provider, is_default } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  let formatted = number || existing.number;
  if (number) {
    formatted = number.replace(/\D/g, '');
    if (formatted.length === 10) formatted = '1' + formatted;
    if (!formatted.startsWith('+')) formatted = '+' + formatted;
  }

  if (is_default) {
    db.prepare('UPDATE phone_numbers SET is_default = 0').run();
  }

  db.prepare(
    'UPDATE phone_numbers SET label = ?, number = ?, provider = ?, is_default = ? WHERE id = ?'
  ).run(
    label ?? existing.label,
    formatted,
    provider ?? existing.provider,
    is_default !== undefined ? (is_default ? 1 : 0) : existing.is_default,
    id
  );

  res.json({ success: true });
});

// DELETE a phone number
router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM phone_numbers WHERE id = ?').run(id);
  res.json({ success: true });
});

// SET default phone number
router.post('/:id/set-default', authMiddleware, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE phone_numbers SET is_default = 0').run();
  db.prepare('UPDATE phone_numbers SET is_default = 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
