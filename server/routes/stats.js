const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const isSalesperson = req.user?.role === 'salesperson';
  const userId = req.user?.userId;

  // For salesperson logins, scope all lead counts to leads that belong to them:
  //   - assigned to them (assigned_user_id = userId)  OR
  //   - scraped by them  (scrape_id from a scrape they created)
  // Using OR in a single WHERE clause avoids any double-counting.
  let baseWhere = '';
  const baseParams = [];
  if (isSalesperson && userId) {
    baseWhere = `WHERE (assigned_user_id = ? OR scrape_id IN (
      SELECT id FROM scrapes WHERE created_by_user_id = ?
    ))`;
    baseParams.push(userId, userId);
  }

  const and = baseWhere ? 'AND' : 'WHERE';

  const totalLeads  = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere}`).get(...baseParams).count;
  const emailsSent  = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere} ${and} email_status = 'sent'`).get(...baseParams).count;
  const callsMade   = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere} ${and} call_status = 'called'`).get(...baseParams).count;
  const smsSent     = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere} ${and} sms_status = 'sent'`).get(...baseParams).count;

  // Meetings booked is campaign-level — remains global for all roles.
  const meetingsBooked = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE type = 'meeting'").get().count;

  res.json({ totalLeads, emailsSent, callsMade, smsSent, meetingsBooked });
});

module.exports = router;
