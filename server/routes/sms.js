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
  if (phoneNumberId) { const r = db.prepare('SELECT number FROM phone_numbers WHERE id=?').get(phoneNumberId); if (r) return r.number; }
  const def = db.prepare('SELECT number FROM phone_numbers WHERE is_default=1 LIMIT 1').get();
  return def?.number || fallback;
}
function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/\D/g, '').slice(-10);
}
function findLeadByPhone(phone) {
  const n = normalizePhone(phone);
  if (!n) return null;
  return db.prepare("SELECT * FROM leads WHERE replace(replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ',''),'+','') LIKE ?").get('%' + n) ||
    db.prepare("SELECT * FROM leads WHERE replace(replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ',''),'+1','') LIKE ?").get('%' + n);
}

const UNSUB_WORDS = ['stop','unsubscribe','quit','cancel','end','optout','opt out','opt-out'];

// ─── INCOMING SMS WEBHOOK (no auth — SignalWire) ───────────────────────────────
router.post('/incoming', (req, res) => {
  const from = req.body.From || '';
  const to = req.body.To || '';
  const body = (req.body.Body || '').trim();

  const lead = findLeadByPhone(from);
  const isUnsub = UNSUB_WORDS.includes(body.toLowerCase());

  db.prepare('INSERT INTO sms_inbox (lead_id, from_number, to_number, message, direction) VALUES (?,?,?,?,?)')
    .run(lead?.id || null, from, to, body, 'inbound');

  if (isUnsub) {
    if (lead) db.prepare('UPDATE leads SET unsubscribed=1 WHERE id=?').run(lead.id);
    return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been unsubscribed. Reply START to resubscribe.</Message></Response>');
  }

  if (body.toLowerCase() === 'start' && lead) {
    db.prepare('UPDATE leads SET unsubscribed=0 WHERE id=?').run(lead.id);
    return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been resubscribed.</Message></Response>');
  }

  return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
});

// ─── SEND OUTBOUND SMS ─────────────────────────────────────────────────────────
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { message, leadIds, phoneNumberId } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    const config = getSignalWireConfig();
    const fromNumber = resolvePhoneNumber(phoneNumberId, config.phoneNumber);
    const isMock = !config.projectId || !config.token;

    let leads;
    if (leadIds?.length > 0) {
      const ph = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM leads WHERE id IN (${ph}) AND phone != '' AND phone IS NOT NULL AND unsubscribed != 1`).all(...leadIds);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE phone != '' AND phone IS NOT NULL AND unsubscribed != 1").all();
    }
    if (leads.length === 0) return res.json({ sent: 0, message: 'No eligible leads' });

    db.prepare('INSERT INTO campaigns (type, template, sent_count) VALUES (?,?,?)').run('sms', message, leads.length);
    const updateLead = db.prepare("UPDATE leads SET sms_status='sent', sms_sent_at=datetime('now') WHERE id=?");

    let sentCount = 0;
    for (const lead of leads) {
      const personalized = message
        .replace(/{business_name}/g, lead.name || '').replace(/{company_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '').replace(/{state}/g, lead.state || '');

      if (isMock) {
        console.log(`[MOCK SMS] To: ${lead.phone}: ${personalized}`);
        updateLead.run(lead.id); sentCount++;
      } else {
        try {
          const authHeader = Buffer.from(`${config.projectId}:${config.token}`).toString('base64');
          const r = await fetch(`https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Messages.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ From: fromNumber, To: lead.phone, Body: personalized }),
          });
          if (r.ok) { updateLead.run(lead.id); sentCount++; }
        } catch (err) { console.error(`SMS error ${lead.phone}:`, err.message); }
      }
    }
    res.json({ sent: sentCount, total: leads.length, mock: isMock });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SMS INBOX ─────────────────────────────────────────────────────────────────
router.get('/inbox', authMiddleware, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, l.name as lead_name, l.unsubscribed as lead_unsubscribed
    FROM sms_inbox m
    LEFT JOIN leads l ON l.id = m.lead_id
    ORDER BY m.created_at DESC
    LIMIT 500
  `).all();
  res.json(messages);
});

// ─── REPLY TO INCOMING SMS ─────────────────────────────────────────────────────
router.post('/reply', authMiddleware, async (req, res) => {
  try {
    const { to, message, phoneNumberId } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });

    const config = getSignalWireConfig();
    const fromNumber = resolvePhoneNumber(phoneNumberId, config.phoneNumber);
    const isMock = !config.projectId || !config.token;

    // Save outbound to inbox
    const lead = findLeadByPhone(to);
    db.prepare('INSERT INTO sms_inbox (lead_id, from_number, to_number, message, direction) VALUES (?,?,?,?,?)')
      .run(lead?.id || null, fromNumber, to, message, 'outbound');

    // Mark previous inbound as read
    db.prepare("UPDATE sms_inbox SET read_at=datetime('now') WHERE from_number=? AND direction='inbound' AND read_at IS NULL")
      .run(to);

    if (isMock) {
      console.log(`[MOCK REPLY] To: ${to}: ${message}`);
      return res.json({ sent: true, mock: true });
    }

    const authHeader = Buffer.from(`${config.projectId}:${config.token}`).toString('base64');
    const r = await fetch(`https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: fromNumber, To: to, Body: message }),
    });
    res.json({ sent: r.ok, status: r.status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
