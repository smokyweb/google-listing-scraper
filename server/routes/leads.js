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

router.post('/', authMiddleware, (req, res) => {
  const { name, phone, email, website, address, city, state, keyword, scrape_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare(`
    INSERT INTO leads (name, phone, email, website, address, city, state, keyword, scrape_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `).run(name, phone||'', email||'', website||'', address||'', city||'', state||'', keyword||'', scrape_id||null);
  res.status(201).json({ id: result.lastInsertRowid, name, phone, email, website, address, city, state, keyword, source: 'manual' });
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { name, phone, email, website, address, city, state, keyword, unsubscribed, status, assigned_user_id, notes } = req.body;
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE leads SET name=?, phone=?, email=?, website=?, address=?, city=?, state=?, keyword=?, unsubscribed=?, status=?, assigned_user_id=?, notes=? WHERE id=?`)
    .run(name??existing.name, phone??existing.phone, email??existing.email, website??existing.website,
         address??existing.address, city??existing.city, state??existing.state, keyword??existing.keyword,
         unsubscribed??existing.unsubscribed, status??existing.status??'new',
         assigned_user_id!==undefined ? assigned_user_id : existing.assigned_user_id,
         notes!==undefined ? notes : (existing.notes||''),
         req.params.id);
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
