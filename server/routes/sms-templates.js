const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function getUserFilter(req) {
  const isSalesperson = req.user?.role === 'salesperson';
  const userId = req.user?.userId;
  if (isSalesperson && userId) {
    return { where: 'WHERE (created_by_user_id = ? OR created_by_user_id IS NULL)', params: [userId] };
  }
  return { where: '', params: [] };
}

router.get('/', authMiddleware, (req, res) => {
  const { where, params } = getUserFilter(req);
  res.json(db.prepare(`SELECT * FROM sms_templates ${where} ORDER BY created_at DESC`).all(...params));
});

router.post('/', authMiddleware, (req, res) => {
  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });
  const userId = req.user?.userId || null;
  const r = db.prepare('INSERT INTO sms_templates (name, message, created_by_user_id) VALUES (?, ?, ?)').run(name, message, userId);
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
