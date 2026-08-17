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
function resolveFromNumber(phoneNumberId) {
  if (phoneNumberId) {
    const r = db.prepare('SELECT number FROM phone_numbers WHERE id=?').get(phoneNumberId);
    if (r) return r.number;
  }
  const def = db.prepare('SELECT number FROM phone_numbers WHERE is_default=1 LIMIT 1').get();
  if (def) return def.number;
  return getSignalWireConfig().phoneNumber;
}
function normalizePhone(raw) {
  if (!raw) return '';
  let n = raw.replace(/\D/g, '');
  if (n.length === 10) n = '1' + n;
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}
function authHeader(config) {
  return 'Basic ' + Buffer.from(`${config.projectId}:${config.token}`).toString('base64');
}

// POST /api/dialer/call
// Agent-first flow: calls the agent's number first, when they pick up it bridges to the lead
// body: { toNumber, fromNumberId?, agentNumber?, leadId? }
router.post('/call', authMiddleware, async (req, res) => {
  try {
    const { toNumber, fromNumberId, agentNumber, leadId } = req.body;
    if (!toNumber) return res.status(400).json({ error: 'toNumber is required' });

    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;

    const fromNumber = resolveFromNumber(fromNumberId);
    const toNormalized = normalizePhone(toNumber);
    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';

    // Get lead info if leadId provided
    let lead = null;
    if (leadId) lead = db.prepare('SELECT * FROM leads WHERE id=?').get(leadId);

    if (isMock) {
      return res.json({ success: true, mock: true, message: `[MOCK] Would call ${toNormalized} from ${fromNumber}` });
    }

    // Agent-first: if agentNumber provided, call agent first then bridge to lead
    // Otherwise: direct call to toNumber with IVR
    let twiml;
    if (agentNumber) {
      const agentNorm = normalizePhone(agentNumber);
      // Call the agent first, when they answer connect them to the lead
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting you to ${lead ? lead.name || 'your lead' : 'the number'} at ${toNormalized.replace('+1','')}. Press any key to connect.</Say>
  <Gather numDigits="1" timeout="10">
    <Pause length="1"/>
  </Gather>
  <Dial callerId="${fromNumber}">${toNormalized}</Dial>
</Response>`;

      // Call the agent's number first
      const resp = await fetch(`https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Calls.json`, {
        method: 'POST',
        headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: fromNumber, To: agentNorm, Twiml: twiml }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(400).json({ error: data.message || 'Call failed', detail: data });
      if (leadId) db.prepare("UPDATE leads SET call_status='called', called_at=datetime('now') WHERE id=?").run(leadId);
      return res.json({ success: true, sid: data.sid, mode: 'agent-first' });
    } else {
      // Direct call to lead number with simple greeting
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${lead ? `Hello, this is a call for ${lead.name}.` : 'Hello, this is a manual call.'} Please hold while we connect you.</Say>
  <Pause length="1"/>
</Response>`;

      const resp = await fetch(`https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Calls.json`, {
        method: 'POST',
        headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: fromNumber, To: toNormalized, Twiml: twiml }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(400).json({ error: data.message || 'Call failed', detail: data });
      if (leadId) db.prepare("UPDATE leads SET call_status='called', called_at=datetime('now') WHERE id=?").run(leadId);
      return res.json({ success: true, sid: data.sid, mode: 'direct' });
    }
  } catch (err) {
    console.error('Dialer call error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dialer/sms
// Send a manual SMS to any number
// body: { toNumber, message, fromNumberId? }
router.post('/sms', authMiddleware, async (req, res) => {
  try {
    const { toNumber, message, fromNumberId, leadId } = req.body;
    if (!toNumber || !message) return res.status(400).json({ error: 'toNumber and message are required' });

    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;
    const fromNumber = resolveFromNumber(fromNumberId);
    const toNormalized = normalizePhone(toNumber);

    if (isMock) {
      return res.json({ success: true, mock: true, message: `[MOCK] Would send SMS to ${toNormalized}` });
    }

    const resp = await fetch(`https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': authHeader(config), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: fromNumber, To: toNormalized, Body: message }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(400).json({ error: data.message || 'SMS failed', detail: data });

    // Log to sms_inbox
    const lead = leadId ? db.prepare('SELECT * FROM leads WHERE id=?').get(leadId) : null;
    db.prepare('INSERT INTO sms_inbox (lead_id, from_number, to_number, message, direction) VALUES (?,?,?,?,?)').run(lead?.id||null, fromNumber, toNormalized, message, 'outbound');
    if (leadId) db.prepare("UPDATE leads SET sms_status='sent', sms_sent_at=datetime('now') WHERE id=?").run(leadId);

    return res.json({ success: true, sid: data.sid });
  } catch (err) {
    console.error('Dialer SMS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dialer/email
// Send a manual email to any address
router.post('/email', authMiddleware, async (req, res) => {
  try {
    const { toEmail, subject, body, senderId, leadId, replyToEmail } = req.body;
    if (!toEmail || !subject || !body) return res.status(400).json({ error: 'toEmail, subject, and body are required' });

    const smtpHost = process.env.SMTP_HOST || getSetting('smtp_host');
    const smtpUser = process.env.SMTP_USER || getSetting('smtp_user');
    const smtpPass = process.env.SMTP_PASS || getSetting('smtp_pass');
    const smtpPort = Number(process.env.SMTP_PORT || getSetting('smtp_port') || 587);
    const isMock = !smtpHost;

    // Resolve from address
    let fromAddr = process.env.SMTP_FROM || getSetting('smtp_from') || 'noreply@example.com';
    if (senderId) {
      const sender = db.prepare('SELECT * FROM email_senders WHERE id=?').get(senderId);
      if (sender) fromAddr = sender.name ? `${sender.name} <${sender.email}>` : sender.email;
    } else {
      const def = db.prepare('SELECT * FROM email_senders WHERE is_default=1 LIMIT 1').get();
      if (def) fromAddr = def.name ? `${def.name} <${def.email}>` : def.email;
    }

    if (isMock) return res.json({ success: true, mock: true, message: `[Mock] Email would be sent to ${toEmail} from ${fromAddr}` });

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, auth: { user: smtpUser, pass: smtpPass } });
    await transporter.sendMail({ from: fromAddr, to: toEmail, subject, html: body, ...(replyToEmail ? { replyTo: replyToEmail } : {}) });

    if (leadId) db.prepare("UPDATE leads SET email_status='sent', email_sent_at=datetime('now') WHERE id=?").run(leadId);
    return res.json({ success: true });
  } catch (err) {
    console.error('Dialer email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
