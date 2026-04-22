const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET all scrapes (history) â€” salespersons only see their own
router.get('/', authMiddleware, (req, res) => {
  const { filterUser } = req.query; // admin can pass ?filterUser=userId to filter
  const isSalesperson = req.user?.role === 'salesperson';
  const userId = req.user?.userId;

  let where = '';
  let params = [];
  if (isSalesperson && userId) {
    // Salesperson: only their scrapes
    where = 'WHERE s.created_by_user_id = ?';
    params = [userId];
  } else if (filterUser) {
    // Admin filtering by specific user
    where = 'WHERE s.created_by_user_id = ?';
    params = [parseInt(filterUser)];
  }

  const rawSort = req.query.sortBy || 'created_at';
  const rawDir = req.query.sortDir || 'desc';
  const allowedSort = { created_at: 's.created_at', name: 's.name', created_by_name: 's.created_by_name', lead_count: 'lead_count' };
  const orderCol = allowedSort[rawSort] || 's.created_at';
  const orderDir = rawDir === 'asc' ? 'ASC' : 'DESC';

  const sql = `SELECT s.*, COUNT(l.id) as lead_count, SUM(CASE WHEN l.email != '' AND l.email IS NOT NULL THEN 1 ELSE 0 END) as emails_found FROM scrapes s LEFT JOIN leads l ON l.scrape_id = s.id ${where} GROUP BY s.id ORDER BY ${orderCol} ${orderDir}`;
  const scrapes = db.prepare(sql).all(...params);
  res.json(scrapes);
});

// GET leads for a specific scrape
router.get('/:id/leads', authMiddleware, (req, res) => {
  const { id } = req.params;
  const scrape = db.prepare('SELECT * FROM scrapes WHERE id = ?').get(id);
  if (!scrape) return res.status(404).json({ error: 'Scrape not found' });

  const leads = db.prepare('SELECT * FROM leads WHERE scrape_id = ? ORDER BY id ASC').all(id);
  res.json({ scrape, leads });
});

// GET export CSV for a specific scrape
router.get('/:id/export', authMiddleware, (req, res) => {
  const { id } = req.params;
  const scrape = db.prepare('SELECT * FROM scrapes WHERE id = ?').get(id);
  if (!scrape) return res.status(404).json({ error: 'Scrape not found' });

  const leads = db.prepare('SELECT * FROM leads WHERE scrape_id = ? ORDER BY id ASC').all(id);
  const headers = ['id', 'name', 'phone', 'email', 'website', 'address', 'city', 'state', 'keyword', 'scraped_at', 'email_status', 'call_status', 'sms_status'];

  let csv = headers.join(',') + '\n';
  for (const lead of leads) {
    csv += headers.map(h => {
      const val = (lead[h] ?? '').toString().replace(/"/g, '""');
      return `"${val}"`;
    }).join(',') + '\n';
  }

  const filename = `${scrape.name.replace(/[^a-z0-9]/gi, '_')}_leads.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(csv);
});

// DELETE a scrape and its leads
router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM leads WHERE scrape_id = ?').run(id);
  db.prepare('DELETE FROM scrapes WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;

