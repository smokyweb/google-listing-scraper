const router = require('express').Router();
const nodemailer = require('nodemailer');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || getSetting('smtp_host'),
    port: Number(process.env.SMTP_PORT || getSetting('smtp_port') || 587),
    auth: {
      user: process.env.SMTP_USER || getSetting('smtp_user'),
      pass: process.env.SMTP_PASS || getSetting('smtp_pass'),
    },
  };
}

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { subject, body, leadIds } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }

    const smtpFrom = process.env.SMTP_FROM || getSetting('smtp_from') || 'noreply@example.com';
    const config = getSmtpConfig();
    const isMock = !config.host;

    let leads;
    if (leadIds && leadIds.length > 0) {
      const placeholders = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders}) AND email != '' AND email IS NOT NULL`).all(...leadIds);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE email != '' AND email IS NOT NULL").all();
    }

    if (leads.length === 0) {
      return res.json({ sent: 0, message: 'No leads with email addresses found' });
    }

    let transporter = null;
    if (!isMock) {
      transporter = nodemailer.createTransport(config);
    }

    // Record campaign
    const campaign = db.prepare('INSERT INTO campaigns (type, template, sent_count) VALUES (?, ?, ?)').run('email', JSON.stringify({ subject, body }), leads.length);

    const updateLead = db.prepare("UPDATE leads SET email_status = 'sent', email_sent_at = datetime('now') WHERE id = ?");

    let sentCount = 0;
    const errors = [];

    for (const lead of leads) {
      const personalizedBody = body
        .replace(/{business_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '')
        .replace(/{state}/g, lead.state || '');

      const personalizedSubject = subject
        .replace(/{business_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '')
        .replace(/{state}/g, lead.state || '');

      if (isMock) {
        console.log(`[MOCK EMAIL] To: ${lead.email}, Subject: ${personalizedSubject}`);
        updateLead.run(lead.id);
        sentCount++;
      } else {
        try {
          await transporter.sendMail({
            from: smtpFrom,
            to: lead.email,
            subject: personalizedSubject,
            html: personalizedBody,
          });
          updateLead.run(lead.id);
          sentCount++;
        } catch (err) {
          errors.push({ leadId: lead.id, email: lead.email, error: err.message });
        }
      }
    }

    res.json({ sent: sentCount, total: leads.length, errors, mock: isMock });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
