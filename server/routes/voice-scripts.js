const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function getMode(req) {
  const mode = req.query.mode || req.body?.mode || 'live';
  return ['live', 'voicemail'].includes(mode) ? mode : null;
}

function getUserFilter(req, mode) {
  const isSalesperson = req.user?.role === 'salesperson';
  const userId = req.user?.userId;
  if (!mode) return { where: 'WHERE 1 = 0', params: [] };
  if (isSalesperson && userId) {
    return { where: 'WHERE mode = ? AND (created_by_user_id = ? OR created_by_user_id IS NULL)', params: [mode, userId] };
  }
  return { where: 'WHERE mode = ?', params: [mode] };
}

router.get('/', authMiddleware, (req, res) => {
  const { where, params } = getUserFilter(req, getMode(req));
  res.json(db.prepare(`SELECT * FROM voice_scripts ${where} ORDER BY created_at DESC`).all(...params));
});

router.get('/active', (req, res) => {
  const mode = getMode(req);
  const script = mode ? db.prepare('SELECT * FROM voice_scripts WHERE mode = ? AND is_active = 1 LIMIT 1').get(mode) : null;
  res.json(script || null);
});

router.post('/', authMiddleware, (req, res) => {
  const { name, script } = req.body;
  const mode = getMode(req);
  if (!mode) return res.status(400).json({ error: 'mode must be live or voicemail' });
  if (!name || !script) return res.status(400).json({ error: 'name and script required' });
  const userId = req.user?.userId || null;
  const r = db.prepare('INSERT INTO voice_scripts (name, script, mode, created_by_user_id) VALUES (?, ?, ?, ?)').run(name, script, mode, userId);
  res.status(201).json({ id: r.lastInsertRowid, name, script, mode, is_active: 0 });
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
    db.prepare('UPDATE voice_scripts SET is_active = 0 WHERE mode = ? AND created_by_user_id = ?').run(existing.mode, userId);
  } else {
    db.prepare('UPDATE voice_scripts SET is_active = 0 WHERE mode = ?').run(existing.mode);
  }
  db.prepare('UPDATE voice_scripts SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM voice_scripts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
