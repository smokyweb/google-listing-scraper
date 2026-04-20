const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/reports/email-opens
router.get('/email-opens', authMiddleware, (req, res) => {
  const { scrapeId, dateFrom, dateTo } = req.query;

  let where = [];
  let params = [];
  if (scrapeId) { where.push('l.scrape_id = ?'); params.push(Number(scrapeId)); }
  if (dateFrom) { where.push('l.scraped_at >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('l.scraped_at <= ?'); params.push(dateTo + 'T23:59:59'); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      l.id, l.name, l.email, l.email_opens,
      l.email_status, l.email_sent_at,
      l.city, l.state, l.keyword,
      s.name as scrape_name, s.created_at as scrape_date
    FROM leads l
    LEFT JOIN scrapes s ON s.id = l.scrape_id
    ${whereClause}
    ORDER BY l.email_opens DESC, l.email_sent_at DESC
  `).all(...params);

  res.json(rows);
});

// GET /api/reports/call-outcomes
router.get('/call-outcomes', authMiddleware, (req, res) => {
  const { scrapeId, dateFrom, dateTo } = req.query;

  let where = [];
  let params = [];
  if (scrapeId) { where.push('cl.scrape_id = ?'); params.push(Number(scrapeId)); }
  if (dateFrom) { where.push('cl.called_at >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('cl.called_at <= ?'); params.push(dateTo + 'T23:59:59'); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      cl.*,
      l.email as lead_email, l.city, l.state, l.keyword,
      s.name as scrape_name, s.created_at as scrape_date
    FROM call_logs cl
    LEFT JOIN leads l ON l.id = cl.lead_id
    LEFT JOIN scrapes s ON s.id = cl.scrape_id
    ${whereClause}
    ORDER BY cl.called_at DESC
  `).all(...params);

  // Also include leads that were called but have no call_log entry (older calls)
  const outcomesSummary = db.prepare(`
    SELECT outcome, COUNT(*) as count
    FROM call_logs cl
    ${whereClause}
    GROUP BY outcome
    ORDER BY count DESC
  `).all(...params);

  res.json({ logs: rows, summary: outcomesSummary });
});

// GET /api/reports/overview
router.get('/overview', authMiddleware, (req, res) => {
  const stats = {
    total_leads: db.prepare('SELECT COUNT(*) as c FROM leads WHERE unsubscribed != 1').get().c,
    emails_sent: db.prepare("SELECT COUNT(*) as c FROM leads WHERE email_status = 'sent'").get().c,
    emails_opened: db.prepare('SELECT SUM(email_opens) as c FROM leads').get().c || 0,
    calls_made: db.prepare("SELECT COUNT(*) as c FROM leads WHERE call_status = 'called'").get().c,
    sms_sent: db.prepare("SELECT COUNT(*) as c FROM leads WHERE sms_status = 'sent'").get().c,
    callbacks_pending: db.prepare("SELECT COUNT(*) as c FROM callbacks WHERE status = 'pending'").get().c,
    meetings_scheduled: db.prepare("SELECT COUNT(*) as c FROM call_logs WHERE outcome = 'meeting_scheduled'").get().c,
    unsubscribed: db.prepare('SELECT COUNT(*) as c FROM leads WHERE unsubscribed = 1').get().c,
    call_outcomes: db.prepare('SELECT outcome, COUNT(*) as count FROM call_logs GROUP BY outcome ORDER BY count DESC').all(),
  };
  res.json(stats);
});

module.exports = router;
