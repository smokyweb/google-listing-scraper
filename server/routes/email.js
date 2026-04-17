const router = require('express').Router();
const nodemailer = require('nodemailer');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}
function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || getSetting('smtp_host'),
    port: Number(process.env.SMTP_PORT || getSetting('smtp_port') || 587),
    auth: { user: process.env.SMTP_USER || getSetting('smtp_user'), pass: process.env.SMTP_PASS || getSetting('smtp_pass') },
  };
}

// Email open tracking pixel
router.get('/track/:trackingId', (req, res) => {
  const { trackingId } = req.params;
  const campaign = db.prepare('SELECT * FROM campaigns WHERE tracking_id=?').get(trackingId);
  if (campaign) {
    // Try to find lead from tracking (stored in template JSON)
    db.prepare('INSERT INTO email_opens (campaign_id, ip) VALUES (?,?)').run(campaign.id, req.ip);
    // Update lead email_opens count if we can find lead
    try {
      const meta = JSON.parse(campaign.template || '{}');
      if (meta.leadId) {
        db.prepare('UPDATE leads SET email_opens = COALESCE(email_opens, 0) + 1 WHERE id=?').run(meta.leadId);
      }
    } catch {}
  }
  // Return 1x1 transparent pixel
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(pixel);
});

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { subject, body, leadIds } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required' });

    const smtpFrom = process.env.SMTP_FROM || getSetting('smtp_from') || 'noreply@example.com';
    const config = getSmtpConfig();
    const isMock = !config.host;
    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';

    let leads;
    if (leadIds?.length > 0) {
      const ph = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM leads WHERE id IN (${ph}) AND email != '' AND email IS NOT NULL AND unsubscribed != 1`).all(...leadIds);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE email != '' AND email IS NOT NULL AND unsubscribed != 1").all();
    }
    if (leads.length === 0) return res.json({ sent: 0, message: 'No leads with email addresses found' });

    let transporter = null;
    if (!isMock) transporter = nodemailer.createTransport(config);

    const updateLead = db.prepare("UPDATE leads SET email_status='sent', email_sent_at=datetime('now') WHERE id=?");
    let sentCount = 0;
    const errors = [];

    for (const lead of leads) {
      const personalizedBody = body
        .replace(/{business_name}/g, lead.name || '').replace(/{company_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '').replace(/{state}/g, lead.state || '')
        .replace(/{keyword}/g, lead.keyword || '');

      const personalizedSubject = subject
        .replace(/{business_name}/g, lead.name || '').replace(/{company_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '').replace(/{state}/g, lead.state || '');

      // Create per-lead campaign with tracking
      const trackingId = uuidv4();
      const campaign = db.prepare('INSERT INTO campaigns (type, template, sent_count, tracking_id) VALUES (?,?,?,?)')
        .run('email', JSON.stringify({ subject, leadId: lead.id }), 1, trackingId);

      // Inject tracking pixel
      const trackPixel = `<img src="${baseUrl}/api/email/track/${trackingId}" width="1" height="1" style="display:none" alt="">`;
      const htmlWithTracking = personalizedBody.includes('</body>')
        ? personalizedBody.replace('</body>', `${trackPixel}</body>`)
        : personalizedBody + trackPixel;

      if (isMock) {
        console.log(`[MOCK EMAIL] To: ${lead.email}, Subject: ${personalizedSubject}`);
        updateLead.run(lead.id);
        sentCount++;
      } else {
        try {
          await transporter.sendMail({ from: smtpFrom, to: lead.email, subject: personalizedSubject, html: htmlWithTracking });
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
