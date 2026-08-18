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
  // Salesperson sees leads assigned to them OR from scrapes they created
  if (isSalesperson && userId) {
    where.push('(leads.assigned_user_id = ? OR leads.scrape_id IN (SELECT id FROM scrapes WHERE created_by_user_id = ?))');
    params.push(userId, userId);
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
  const leads = db.prepare(`SELECT leads.* FROM leads ${whereClause} ORDER BY leads.id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));

  res.json({ leads, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) });
});

router.get('/export', authMiddleware, (req, res) => {
  const isSalesperson = req.user?.role === 'salesperson';
  const userId = req.user?.userId;
  let exportQuery = 'SELECT * FROM leads';
  const exportParams = [];
  if (isSalesperson && userId) {
    exportQuery += ' WHERE (assigned_user_id = ? OR scrape_id IN (SELECT id FROM scrapes WHERE created_by_user_id = ?))';
    exportParams.push(userId, userId);
  }
  exportQuery += ' ORDER BY id DESC';
  const leads = db.prepare(exportQuery).all(...exportParams);
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
  // Coerce assigned_user_id to a positive integer or null
  const assignedUserId = assigned_user_id ? (parseInt(assigned_user_id, 10) || null) : null;
  const result = db.prepare(`
    INSERT INTO leads (name, first_name, last_name, company, phone, email, website, address, city, state, keyword, scrape_id, source, assigned_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fullName, first_name||'', last_name||'', company||'', phone||'', email||'', website||'', address||'', city||'', state||'', keyword||'', scrape_id||null, 'manual', assignedUserId);
  res.status(201).json({ id: result.lastInsertRowid, name: fullName, first_name: first_name||'', last_name: last_name||'', company: company||'', phone, email, website, address, city, state, keyword, source: 'manual', assigned_user_id: assignedUserId });
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

