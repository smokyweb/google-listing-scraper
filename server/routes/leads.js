const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const { page = 1, limit = 50, keyword, city, state, search, scrape_id } = req.query;
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];

  if (scrape_id) { where.push('scrape_id = ?'); params.push(Number(scrape_id)); }
  if (keyword) { where.push('keyword LIKE ?'); params.push(`%${keyword}%`); }
  if (city) { where.push('city LIKE ?'); params.push(`%${city}%`); }
  if (state) { where.push('state LIKE ?'); params.push(`%${state}%`); }
  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM leads ${whereClause}`).get(...params).count;
  const leads = db.prepare(`SELECT * FROM leads ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));

  res.json({ leads, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) });
});

router.get('/export', authMiddleware, (req, res) => {
  const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  const headers = ['id', 'name', 'phone', 'email', 'website', 'address', 'city', 'state', 'keyword', 'scraped_at', 'email_status', 'call_status', 'sms_status'];

  let csv = headers.join(',') + '\n';
  for (const lead of leads) {
    csv += headers.map(h => {
      const val = (lead[h] ?? '').toString().replace(/"/g, '""');
      return `"${val}"`;
    }).join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
  res.send(csv);
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
