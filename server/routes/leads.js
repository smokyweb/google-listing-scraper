const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /leads — paginated list with optional filters.
// • Salesperson: sees only their own leads (assigned to them OR from their scrapes).
// • Admin:       sees all leads; may additionally filter by salesperson_id query param.
// Both roles receive an `assigned_user_name` field for each lead (null if unassigned).
router.get('/', authMiddleware, (req, res) => {
  const { page = 1, limit = 50, keyword, city, state, search, scrape_id, salesperson_id, source } = req.query;
  const isSalesperson = req.user?.role === 'salesperson';
  const isAdmin       = req.user?.role === 'admin';
  const userId        = req.user?.userId;
  const offset        = (page - 1) * limit;

  const where  = [];
  const params = [];

  if (scrape_id) {
    where.push('leads.scrape_id = ?');
    params.push(Number(scrape_id));
  }
  if (source === 'manual') where.push("leads.source = 'manual'");
  if (source === 'scraped') where.push("COALESCE(leads.source, 'scraped') = 'scraped'");

  // Salesperson: restrict to leads assigned to them OR from scrapes they created.
  if (isSalesperson && userId) {
    where.push(
      '(leads.assigned_user_id = ? OR leads.scrape_id IN (SELECT id FROM scrapes WHERE created_by_user_id = ?))'
    );
    params.push(userId, userId);
  }

  // Admin-only: filter by assigned salesperson.
  //   salesperson_id = ''           → All (no filter)
  //   salesperson_id = 'unassigned' → leads with no assigned user
  //   salesperson_id = '<number>'   → leads assigned to that user id
  if (isAdmin && salesperson_id !== undefined && salesperson_id !== '') {
    if (salesperson_id === 'unassigned') {
      where.push('leads.assigned_user_id IS NULL');
    } else {
      const spId = parseInt(salesperson_id, 10);
      if (!isNaN(spId)) {
        where.push('leads.assigned_user_id = ?');
        params.push(spId);
      }
    }
  }

  if (keyword) { where.push('leads.keyword LIKE ?'); params.push(`%${keyword}%`); }
  if (city)    { where.push('leads.city LIKE ?');    params.push(`%${city}%`); }
  if (state)   { where.push('leads.state LIKE ?');   params.push(`%${state}%`); }
  if (search) {
    where.push(
      '(leads.name LIKE ? OR leads.first_name LIKE ? OR leads.last_name LIKE ? OR leads.company LIKE ? OR leads.email LIKE ? OR leads.phone LIKE ?)'
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // COUNT: single-table query (no JOIN needed, WHERE uses leads.* columns).
  const total = db.prepare(
    `SELECT COUNT(*) as count FROM leads ${whereClause}`
  ).get(...params).count;

  // Main SELECT: LEFT JOIN sales_users to resolve assigned salesperson name.
  const leads = db.prepare(`
    SELECT leads.*, su.name AS assigned_user_name
    FROM leads
    LEFT JOIN sales_users su ON su.id = leads.assigned_user_id
    ${whereClause}
    ORDER BY leads.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  res.json({ leads, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) });
});

// GET /leads/export — CSV download, salesperson-scoped.
router.get('/export', authMiddleware, (req, res) => {
  const isSalesperson = req.user?.role === 'salesperson';
  const userId        = req.user?.userId;

  let exportQuery  = 'SELECT * FROM leads';
  const exportParams = [];
  if (isSalesperson && userId) {
    exportQuery += ' WHERE (assigned_user_id = ? OR scrape_id IN (SELECT id FROM scrapes WHERE created_by_user_id = ?))';
    exportParams.push(userId, userId);
  }
  exportQuery += ' ORDER BY id DESC';

  const leads = db.prepare(exportQuery).all(...exportParams);
  const headers = [
    'id', 'first_name', 'last_name', 'company', 'phone', 'email',
    'website', 'address', 'city', 'state', 'keyword',
    'scraped_at', 'email_status', 'call_status', 'sms_status',
  ];

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

// POST /leads — create a lead manually.
router.post('/', authMiddleware, (req, res) => {
  const {
    first_name, last_name, name, company,
    phone, email, website, address, city, state,
    keyword, scrape_id, assigned_user_id,
  } = req.body;

  if (!name && !first_name) return res.status(400).json({ error: 'name or first_name is required' });
  const fullName     = name || `${first_name || ''} ${last_name || ''}`.trim();
  const assignedUserId = assigned_user_id
    ? (parseInt(assigned_user_id, 10) || null)
    : (req.user?.role === 'salesperson' ? req.user.userId : null);

  const result = db.prepare(`
    INSERT INTO leads (name, first_name, last_name, company, phone, email, website, address, city, state, keyword, scrape_id, source, assigned_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fullName, first_name || '', last_name || '', company || '',
    phone || '', email || '', website || '', address || '',
    city || '', state || '', keyword || '',
    scrape_id || null, 'manual', assignedUserId,
  );

  res.status(201).json({
    id: result.lastInsertRowid,
    name: fullName,
    first_name: first_name || '', last_name: last_name || '',
    company: company || '', phone, email, website,
    address, city, state, keyword,
    source: 'manual', assigned_user_id: assignedUserId,
  });
});

// PATCH /leads/:id — update a lead.
// • assigned_user_id may only be changed by an admin.
router.patch('/:id', authMiddleware, (req, res) => {
  const {
    name, first_name, last_name, company,
    phone, email, website, address, city, state,
    keyword, unsubscribed, status, assigned_user_id, notes,
  } = req.body;

  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Only admins may re-assign a lead.
  let resolvedAssignedUserId = existing.assigned_user_id;
  if (assigned_user_id !== undefined) {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: only admins can change lead assignment' });
    }
    resolvedAssignedUserId =
      assigned_user_id === null
        ? null
        : (parseInt(assigned_user_id, 10) || null);
  }

  const fn       = (first_name != null ? first_name : existing.first_name) || '';
  const ln       = (last_name  != null ? last_name  : existing.last_name)  || '';
  const fullName = name != null ? name : ((fn + ' ' + ln).trim() || existing.name);

  db.prepare(`
    UPDATE leads
    SET name=?, first_name=?, last_name=?, company=?, phone=?, email=?, website=?,
        address=?, city=?, state=?, keyword=?, unsubscribed=?, status=?,
        assigned_user_id=?, notes=?
    WHERE id=?
  `).run(
    fullName, fn, ln,
    company    !== undefined ? company    : (existing.company || ''),
    phone      != null       ? phone      : existing.phone,
    email      != null       ? email      : existing.email,
    website    != null       ? website    : existing.website,
    address    != null       ? address    : existing.address,
    city       != null       ? city       : existing.city,
    state      != null       ? state      : existing.state,
    keyword    != null       ? keyword    : existing.keyword,
    unsubscribed != null     ? unsubscribed : existing.unsubscribed,
    status     != null       ? status      : (existing.status || 'new'),
    resolvedAssignedUserId,
    notes      !== undefined ? notes      : (existing.notes || ''),
    req.params.id,
  );

  res.json({ success: true });
});

// DELETE /leads/:id
router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
