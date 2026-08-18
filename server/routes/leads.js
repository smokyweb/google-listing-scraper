const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const { page = 1, limit = 50, keyword, city, state, search, scrape_id } = req.query;
  const isSalesperson = req.user?.role === 'salesperson';
  const userId = req.user?.userId;
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];

  if (scrape_id) { where.push('scrape_id = ?'); params.push(Number(scrape_id)); }
  // Salesperson only sees their own leads (from their scrapes)
  if (isSalesperson && userId) {
    where.push("(scrape_id IN (SELECT id FROM scrapes WHERE created_by_user_id = ?) OR (source = 'manual' AND id IN (SELECT id FROM leads WHERE scrape_id IS NULL)))");
    params.push(userId);
  }
  if (keyword) { where.push('keyword LIKE ?'); params.push(`%${keyword}%`); }
  if (city) { where.push('city LIKE ?'); params.push(`%${city}%`); }
  if (state) { where.push('state LIKE ?'); params.push(`%${state}%`); }
  if (search) {
    where.push('(name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM leads ${whereClause}`).get(...params).count;
  const leads = db.prepare(`SELECT * FROM leads ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));

  res.json({ leads, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) });
});

router.get('/export', authMiddleware, (req, res) => {
  const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  const headers = ['id', 'first_name', 'last_name', 'company', 'phone', 'email', 'website', 'address', 'city', 'state', 'keyword', 'scraped_at', 'email_status', 'call_status', 'sms_status'];

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
  const { first_name, last_name, name, company, phone, email, website, address, city, state, keyword, scrape_id, assigned_user_id } = req.body;
  if (!name && !first_name) return res.status(400).json({ error: 'name or first_name is required' });
  const fullName = name || `${first_name||''} ${last_name||''}`.trim();
  const result = db.prepare(`
    INSERT INTO leads (name, first_name, last_name, company, phone, email, website, address, city, state, keyword, scrape_id, source, assigned_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fullName, first_name||'', last_name||'', company||'', phone||'', email||'', website||'', address||'', city||'', state||'', keyword||'', scrape_id||null, 'manual', assigned_user_id||null);
  res.status(201).json({ id: result.lastInsertRowid, name: fullName, first_name: first_name||'', last_name: last_name||'', company: company||'', phone, email, website, address, city, state, keyword, source: 'manual' });
});

router.patch('/:id', authMiddleware, (req, res) => {
  const { name, first_name, last_name, company, phone, email, website, address, city, state, keyword, unsubscribed, status, assigned_user_id, notes } = req.body;
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const fn = (first_name != null ? first_name : existing.first_name) || '';
  const ln = (last_name != null ? last_name : existing.last_name) || '';
  const fullName = name != null ? name : ((fn + ' ' + ln).trim() || existing.name);
  db.prepare(`UPDATE leads SET name=?, first_name=?, last_name=?, company=?, phone=?, email=?, website=?, address=?, city=?, state=?, keyword=?, unsubscribed=?, status=?, assigned_user_id=?, notes=? WHERE id=?`)
    .run(
      fullName,
      fn, ln,
      company !== undefined ? company : (existing.company || ''),
      phone != null ? phone : existing.phone,
      email != null ? email : existing.email,
      website != null ? website : existing.website,
      address != null ? address : existing.address,
      city != null ? city : existing.city,
      state != null ? state : existing.state,
      keyword != null ? keyword : existing.keyword,
      unsubscribed != null ? unsubscribed : existing.unsubscribed,
      status != null ? status : (existing.status || 'new'),
      assigned_user_id !== undefined ? assigned_user_id : existing.assigned_user_id,
      notes !== undefined ? notes : (existing.notes || ''),
      req.params.id
    );
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

