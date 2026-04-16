const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET all scrapes (history)
router.get('/', authMiddleware, (req, res) => {
  const scrapes = db.prepare(`
    SELECT s.*,
      COUNT(l.id) as lead_count,
      SUM(CASE WHEN l.email != '' AND l.email IS NOT NULL THEN 1 ELSE 0 END) as emails_found
    FROM scrapes s
    LEFT JOIN leads l ON l.scrape_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all();
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
