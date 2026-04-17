const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM email_senders ORDER BY is_default DESC, created_at ASC').all());
});

router.post('/', authMiddleware, (req, res) => {
  const { label, email, name, is_default = 0 } = req.body;
  if (!label || !email) return res.status(400).json({ error: 'label and email required' });
  try {
    if (is_default) db.prepare('UPDATE email_senders SET is_default = 0').run();
    const r = db.prepare('INSERT INTO email_senders (label, email, name, is_default) VALUES (?, ?, ?, ?)').run(label, email, name || '', is_default ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid, label, email, name, is_default });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { label, email, name, is_default } = req.body;
  const e = db.prepare('SELECT * FROM email_senders WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  if (is_default) db.prepare('UPDATE email_senders SET is_default = 0').run();
  db.prepare('UPDATE email_senders SET label=?, email=?, name=?, is_default=? WHERE id=?')
    .run(label??e.label, email??e.email, name??e.name, is_default!==undefined?(is_default?1:0):e.is_default, req.params.id);
  res.json({ success: true });
});

router.post('/:id/set-default', authMiddleware, (req, res) => {
  db.prepare('UPDATE email_senders SET is_default = 0').run();
  db.prepare('UPDATE email_senders SET is_default = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM email_senders WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
