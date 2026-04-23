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
  res.json(db.prepare(`SELECT * FROM voice_scripts ${where} ORDER BY created_at DESC`).all(...params));
});

router.get('/active', (req, res) => {
  const script = db.prepare('SELECT * FROM voice_scripts WHERE is_active = 1 LIMIT 1').get();
  res.json(script || null);
});

router.post('/', authMiddleware, (req, res) => {
  const { name, script } = req.body;
  if (!name || !script) return res.status(400).json({ error: 'name and script required' });
  const userId = req.user?.userId || null;
  const r = db.prepare('INSERT INTO voice_scripts (name, script, created_by_user_id) VALUES (?, ?, ?)').run(name, script, userId);
  res.status(201).json({ id: r.lastInsertRowid, name, script, is_active: 0 });
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { name, script } = req.body;
  const existing = db.prepare('SELECT * FROM voice_scripts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE voice_scripts SET name=?, script=? WHERE id=?').run(name ?? existing.name, script ?? existing.script, req.params.id);
  res.json({ success: true });
});

router.post('/:id/activate', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM voice_scripts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // Only clear active for this user's scripts
  const userId = req.user?.userId || null;
  if (userId) {
    db.prepare('UPDATE voice_scripts SET is_active = 0 WHERE created_by_user_id = ?').run(userId);
  } else {
    db.prepare('UPDATE voice_scripts SET is_active = 0').run();
  }
  db.prepare('UPDATE voice_scripts SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM voice_scripts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
