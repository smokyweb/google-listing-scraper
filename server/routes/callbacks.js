const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const callbacks = db.prepare(`
    SELECT c.*, l.name as lead_name_resolved, l.email as lead_email
    FROM callbacks c
    LEFT JOIN leads l ON l.id = c.lead_id
    ORDER BY c.created_at DESC
  `).all();
  res.json(callbacks);
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { status, notes } = req.body;
  const existing = db.prepare('SELECT * FROM callbacks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE callbacks SET status=?, notes=? WHERE id=?')
    .run(status ?? existing.status, notes ?? existing.notes, req.params.id);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM callbacks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
