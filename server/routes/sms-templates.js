const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM sms_templates ORDER BY created_at DESC').all());
});
router.post('/', authMiddleware, (req, res) => {
  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });
  const r = db.prepare('INSERT INTO sms_templates (name, message) VALUES (?, ?)').run(name, message);
  res.status(201).json({ id: r.lastInsertRowid, name, message });
});
router.patch('/:id', authMiddleware, (req, res) => {
  const { name, message } = req.body;
  const e = db.prepare('SELECT * FROM sms_templates WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE sms_templates SET name=?, message=? WHERE id=?').run(name??e.name, message??e.message, req.params.id);
  res.json({ success: true });
});
router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sms_templates WHERE id=?').run(req.params.id);
  res.json({ success: true });
});
module.exports = router;
