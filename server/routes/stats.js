const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, (req, res) => {
  const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  const emailsSent = db.prepare("SELECT COUNT(*) as count FROM leads WHERE email_status = 'sent'").get().count;
  const callsMade = db.prepare("SELECT COUNT(*) as count FROM leads WHERE call_status = 'called'").get().count;
  const smsSent = db.prepare("SELECT COUNT(*) as count FROM leads WHERE sms_status = 'sent'").get().count;

  // Meetings booked = campaigns of type 'meeting' or we estimate from calendar
  const meetingsBooked = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE type = 'meeting'").get().count;

  res.json({
    totalLeads,
    emailsSent,
    callsMade,
    smsSent,
    meetingsBooked,
  });
});

module.exports = router;
