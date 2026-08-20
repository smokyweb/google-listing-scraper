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

function decorate(script, req) {
  const isOwner = req.user?.role === 'salesperson'
    ? script.created_by_user_id === req.user.userId
    : script.created_by_user_id == null;
  return {
    ...script,
    is_admin_script: script.created_by_user_id == null,
    can_edit: isOwner,
  };
}

router.get('/', authMiddleware, (req, res) => {
  const { where, params } = getUserFilter(req, getMode(req));
  res.json(db.prepare(`SELECT * FROM voice_scripts ${where} ORDER BY created_at DESC`).all(...params).map(s => decorate(s, req)));
});

router.get('/active', authMiddleware, (req, res) => {
  const mode = getMode(req);
  if (!mode) return res.json(null);
  const own = req.user?.role === 'salesperson'
    ? db.prepare('SELECT * FROM voice_scripts WHERE mode = ? AND created_by_user_id = ? AND is_active = 1 LIMIT 1').get(mode, req.user.userId)
    : null;
  const script = own || db.prepare('SELECT * FROM voice_scripts WHERE mode = ? AND created_by_user_id IS NULL AND is_active = 1 LIMIT 1').get(mode);
  res.json(script ? decorate(script, req) : null);
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
  if (req.user.role === 'salesperson' && existing.created_by_user_id !== req.user.userId) {
    return res.status(403).json({ error: 'Admin scripts are read-only. Create your own script to edit it.' });
  }
  if (req.user.role === 'admin' && existing.created_by_user_id != null) {
    return res.status(403).json({ error: 'Salesperson scripts are owned by their salesperson.' });
  }
  db.prepare('UPDATE voice_scripts SET name=?, script=? WHERE id=?').run(name ?? existing.name, script ?? existing.script, req.params.id);
  res.json({ success: true });
});

router.post('/:id/activate', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM voice_scripts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const isOwner = req.user.role === 'salesperson'
    ? existing.created_by_user_id === req.user.userId
    : existing.created_by_user_id == null;
  if (!isOwner) return res.status(403).json({ error: 'You can only activate your own scripts.' });
  if (req.user.role === 'salesperson') {
    db.prepare('UPDATE voice_scripts SET is_active = 0 WHERE mode = ? AND created_by_user_id = ?').run(existing.mode, req.user.userId);
  } else {
    db.prepare('UPDATE voice_scripts SET is_active = 0 WHERE mode = ? AND created_by_user_id IS NULL').run(existing.mode);
  }
  db.prepare('UPDATE voice_scripts SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  const existing = db.prepare('SELECT * FROM voice_scripts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const isOwner = req.user.role === 'salesperson'
    ? existing.created_by_user_id === req.user.userId
    : existing.created_by_user_id == null;
  if (!isOwner) return res.status(403).json({ error: 'You can only delete your own scripts.' });
  db.prepare('DELETE FROM voice_scripts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
