const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getSignalWireConfig() {
  return {
    projectId: process.env.SIGNALWIRE_PROJECT_ID || getSetting('signalwire_project_id'),
    token: process.env.SIGNALWIRE_TOKEN || getSetting('signalwire_token'),
    spaceUrl: process.env.SIGNALWIRE_SPACE_URL || getSetting('signalwire_space_url'),
    phoneNumber: process.env.SIGNALWIRE_PHONE_NUMBER || getSetting('signalwire_phone_number'),
  };
}

function resolvePhoneNumber(phoneNumberId, fallback) {
  if (phoneNumberId) {
    const row = db.prepare('SELECT number FROM phone_numbers WHERE id = ?').get(phoneNumberId);
    if (row) return row.number;
  }
  const defaultRow = db.prepare('SELECT number FROM phone_numbers WHERE is_default = 1 LIMIT 1').get();
  if (defaultRow) return defaultRow.number;
  return fallback;
}

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { message, leadIds, phoneNumberId } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;

    let leads;
    if (leadIds && leadIds.length > 0) {
      const placeholders = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders}) AND phone != '' AND phone IS NOT NULL`).all(...leadIds);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE phone != '' AND phone IS NOT NULL").all();
    }

    if (leads.length === 0) {
      return res.json({ sent: 0, message: 'No leads with phone numbers found' });
    }

    const campaign = db.prepare('INSERT INTO campaigns (type, template, sent_count) VALUES (?, ?, ?)').run('sms', message, leads.length);
    const updateLead = db.prepare("UPDATE leads SET sms_status = 'sent', sms_sent_at = datetime('now') WHERE id = ?");

    let sentCount = 0;

    for (const lead of leads) {
      const personalizedMessage = message
        .replace(/{business_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '')
        .replace(/{state}/g, lead.state || '');

      if (isMock) {
        console.log(`[MOCK SMS] To: ${lead.phone}, Message: ${personalizedMessage}`);
        updateLead.run(lead.id);
        sentCount++;
      } else {
        try {
          const authHeader = Buffer.from(`${config.projectId}:${config.token}`).toString('base64');
          const fromNumber = resolvePhoneNumber(phoneNumberId, config.phoneNumber);
          const smsResp = await fetch(`https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Messages.json`, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${authHeader}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: lead.phone,
              Body: personalizedMessage,
            }),
          });

          if (smsResp.ok) {
            updateLead.run(lead.id);
            sentCount++;
          }
        } catch (err) {
          console.error(`SMS error for ${lead.phone}:`, err.message);
        }
      }
    }

    res.json({ sent: sentCount, total: leads.length, mock: isMock });
  } catch (err) {
    console.error('SMS send error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
