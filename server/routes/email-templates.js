const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM email_templates ORDER BY created_at DESC').all());
});
router.post('/', authMiddleware, (req, res) => {
  const { name, subject, body } = req.body;
  if (!name || !subject || !body) return res.status(400).json({ error: 'name, subject, and body required' });
  const r = db.prepare('INSERT INTO email_templates (name, subject, body) VALUES (?, ?, ?)').run(name, subject, body);
  res.status(201).json({ id: r.lastInsertRowid, name, subject, body });
});
router.patch('/:id', authMiddleware, (req, res) => {
  const { name, subject, body } = req.body;
  const e = db.prepare('SELECT * FROM email_templates WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE email_templates SET name=?, subject=?, body=? WHERE id=?').run(name??e.name, subject??e.subject, body??e.body, req.params.id);
  res.json({ success: true });
});
router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id=?').run(req.params.id);
  res.json({ success: true });
});
module.exports = router;
