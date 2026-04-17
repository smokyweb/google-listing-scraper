const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Ensure audio directory exists for ElevenLabs pre-generated files
const AUDIO_DIR = path.join(__dirname, '..', '..', 'data', 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Generate ElevenLabs TTS and save to a file, return public URL
async function generateElevenLabsAudio(text, config, baseUrl) {
  if (!config.apiKey) return null;
  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': config.apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 }, speed: 0.85 }),
    });
    if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const filename = `call_${uuidv4()}.mp3`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), buffer);
    setTimeout(() => { try { fs.unlinkSync(path.join(AUDIO_DIR, filename)); } catch {} }, 3600000);
    const audioUrl = `${baseUrl}/audio/${filename}`;
    console.log(`[ElevenLabs] Audio ready (${buffer.length} bytes): ${audioUrl}`);
    return audioUrl;
  } catch (err) {
    console.error('[ElevenLabs] Error:', err.message);
    return null;
  }
}

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
function getElevenLabsConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY || getSetting('elevenlabs_api_key'),
    voiceId: process.env.ELEVENLABS_VOICE_ID || getSetting('elevenlabs_voice_id') || '21m00Tcm4TlvDq8ikWAM',
  };
}
function resolvePhoneNumber(phoneNumberId, fallback) {
  if (phoneNumberId) {
    const row = db.prepare('SELECT number FROM phone_numbers WHERE id = ?').get(phoneNumberId);
    if (row) return row.number;
  }
  const def = db.prepare('SELECT number FROM phone_numbers WHERE is_default = 1 LIMIT 1').get();
  return def?.number || fallback;
}

// Normalize phone: last 10 digits
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

function getIvrSession(callSid) {
  let session = db.prepare('SELECT * FROM ivr_sessions WHERE call_sid = ?').get(callSid);
  if (!session) {
    db.prepare('INSERT INTO ivr_sessions (call_sid, step, data) VALUES (?, ?, ?)').run(callSid, 'menu', '{}');
    session = db.prepare('SELECT * FROM ivr_sessions WHERE call_sid = ?').get(callSid);
  }
  session.dataObj = JSON.parse(session.data || '{}');
  return session;
}

function updateIvrSession(callSid, step, data) {
  db.prepare("UPDATE ivr_sessions SET step=?, data=?, updated_at=datetime('now') WHERE call_sid=?")
    .run(step, JSON.stringify(data), callSid);
}

function twiml(content) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}
function say(text) {
  return `<Say voice="alice">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Say>`;
}

// Parse spoken date to a JS Date
function parseSpeechDate(text) {
  if (!text) return null;
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const t = text.toLowerCase().trim();
  const now = new Date();

  // Check for day name
  for (let i = 0; i < days.length; i++) {
    if (t.includes(days[i])) {
      const d = new Date(now);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      d.setHours(9,0,0,0);
      return d;
    }
  }
  // Check for "tomorrow"
  if (t.includes('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9,0,0,0);
    return d;
  }
  // Check for "Month Day" pattern
  for (let i = 0; i < months.length; i++) {
    if (t.includes(months[i])) {
      const match = t.match(/(\d{1,2})/);
      if (match) {
        const d = new Date(now.getFullYear(), i, parseInt(match[1]), 9, 0, 0, 0);
        if (d < now) d.setFullYear(d.getFullYear() + 1);
        return d;
      }
    }
  }
  return null;
}

// Get available 30-min slots between 9am-5pm for a given date
async function getAvailableSlots(date) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || getSetting('google_calendar_client_id');
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || getSetting('google_calendar_client_secret');
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || getSetting('google_calendar_refresh_token') || getSetting('google_calendar_refresh_token');
  if (!clientId || !clientSecret || !refreshToken) return [];

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth });

  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(date);
  end.setHours(17, 0, 0, 0);

  try {
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: 'primary' }],
      },
    });
    const busy = (fb.data.calendars?.primary?.busy) || [];
    const slots = [];
    for (let hour = 9; hour < 17; hour++) {
      for (let min of [0, 30]) {
        const slotStart = new Date(date);
        slotStart.setHours(hour, min, 0, 0);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + 30);
        const conflict = busy.some(b => {
          const bs = new Date(b.start), be = new Date(b.end);
          return slotStart < be && slotEnd > bs;
        });
        if (!conflict) slots.push(slotStart);
        if (slots.length >= 5) break;
      }
      if (slots.length >= 5) break;
    }
    return slots;
  } catch (e) {
    console.error('freebusy error', e.message);
    return [];
  }
}

async function createCalendarEvent(lead, slotDate, email) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || getSetting('google_calendar_client_id');
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || getSetting('google_calendar_client_secret');
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || getSetting('google_calendar_refresh_token');
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Calendar not configured');

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth });

  const end = new Date(slotDate);
  end.setMinutes(end.getMinutes() + 30);

  const event = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Meeting with ${lead.name || lead.phone}`,
      description: `Scheduled via phone call. Business: ${lead.name}, City: ${lead.city}, State: ${lead.state}`,
      start: { dateTime: slotDate.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: email ? [{ email }] : [],
      conferenceData: {
        createRequest: { requestId: uuidv4(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      reminders: { useDefault: true },
    },
  });
  return event.data;
}

function formatSlotLabel(slot) {
  return slot.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}
function formatTime(slot) {
  return slot.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function formatDate(slot) {
  return slot.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// â”€â”€â”€ TTS PREVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/tts-preview', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const config = getElevenLabsConfig();
    if (!config.apiKey) return res.json({ mock: true, message: 'ElevenLabs not configured' });
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': config.apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 }, speed: 0.85 }),
    });
    if (!resp.ok) throw new Error(`ElevenLabs error: ${resp.status}`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(await resp.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ TRIGGER OUTBOUND CALLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/trigger', authMiddleware, async (req, res) => {
  try {
    const { script, leadIds, phoneNumberId } = req.body;
    const activeScript = db.prepare('SELECT * FROM voice_scripts WHERE is_active = 1 LIMIT 1').get();
    const callScript = script || activeScript?.script || 'Hello {company_name}, this is a business outreach call.';
    const swConfig = getSignalWireConfig();
    const transferNumber = process.env.TRANSFER_PHONE_NUMBER || getSetting('transfer_phone_number') || '+15551234567';
    const fromNumber = resolvePhoneNumber(phoneNumberId, swConfig.phoneNumber);
    const isMock = !swConfig.projectId || !swConfig.token;
    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';

    let leads;
    if (leadIds?.length > 0) {
      const ph = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM leads WHERE id IN (${ph}) AND phone != '' AND phone IS NOT NULL AND unsubscribed != 1`).all(...leadIds);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE phone != '' AND phone IS NOT NULL AND unsubscribed != 1").all();
    }
    if (leads.length === 0) return res.json({ called: 0, message: 'No eligible leads' });

    const campaign = db.prepare('INSERT INTO campaigns (type, template, sent_count) VALUES (?, ?, ?)').run('call', callScript, leads.length);
    const updateLead = db.prepare("UPDATE leads SET call_status='called', called_at=datetime('now') WHERE id=?");

    let calledCount = 0;
    const elevenLabsConfig = getElevenLabsConfig();
    // Note: Menu uses SignalWire <Say> to preserve ElevenLabs credits for personalized scripts

    const errors = [];
    for (const lead of leads) {
      const personalized = callScript
        .replace(/{company_name}/g, lead.name || '')
        .replace(/{business_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '')
        .replace(/{state}/g, lead.state || '')
        .replace(/{keyword}/g, lead.keyword || '')
        .replace(/{phone}/g, lead.phone || '')
        .replace(/{email}/g, lead.email || '');

      // Normalize phone to E.164
      let toPhone = (lead.phone || '').replace(/\D/g, '');
      if (toPhone.length === 10) toPhone = '1' + toPhone;
      if (!toPhone.startsWith('+')) toPhone = '+' + toPhone;

      if (isMock) {
        console.log(`[MOCK CALL] To: ${toPhone}, Script: ${personalized.substring(0, 80)}`);
        updateLead.run(lead.id);
        calledCount++;
      } else {
        try {
          // Generate per-lead ElevenLabs audio for the personalized script
          const scriptAudioUrl = await generateElevenLabsAudio(personalized, elevenLabsConfig, baseUrl);

          const scriptPart = scriptAudioUrl
            ? `<Play>${scriptAudioUrl}</Play>`
            : say(personalized);
          // Menu always uses SignalWire Say to save ElevenLabs credits
          const menuPart = say('Press 1 to connect to a live staff member. Press 2 to set a call back time. Press 3 to schedule a virtual meeting. Press 4 to be removed from our list.');

          // Voicemail fallback: if no answer, leave a message after the beep
          const voicemailScript = personalized + ' Please leave a message after the beep and we will get back to you.';
          const ivrTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response>
  ${scriptPart}
  <Gather numDigits="1" action="${baseUrl}/api/calls/ivr-handler" method="POST" timeout="15">
    ${menuPart}
  </Gather>
  ${say('We did not receive your input.')} ${say('Please leave a message after the beep.')} <Record maxLength="30" action="${baseUrl}/api/calls/recording-done" />
</Response>`;
          const authHeader = Buffer.from(`${swConfig.projectId}:${swConfig.token}`).toString('base64');
          const callResp = await fetch(`https://${swConfig.spaceUrl}/api/laml/2010-04-01/Accounts/${swConfig.projectId}/Calls.json`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ From: fromNumber, To: toPhone, Twiml: ivrTwiml }),
          });
          if (callResp.ok) {
            updateLead.run(lead.id);
            calledCount++;
          } else {
            const errBody = await callResp.text();
            const errMsg = `${lead.name} (${toPhone}): HTTP ${callResp.status} â€” ${errBody.substring(0, 200)}`;
            errors.push(errMsg);
            console.error('[CALL FAILED]', errMsg);
          }
        } catch (err) {
          errors.push(`${lead.name}: ${err.message}`);
          console.error(`Call error for ${toPhone}:`, err.message);
        }
      }
    }
    res.json({ called: calledCount, total: leads.length, mock: isMock, errors: errors.length > 0 ? errors : undefined });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€â”€ IVR HANDLER (DTMF from outbound call) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/ivr-handler', async (req, res) => {
  const digit = req.body.Digits;
  const callSid = req.body.CallSid || 'unknown';
  const fromPhone = req.body.To || req.body.From || '';
  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
  const transferNumber = process.env.TRANSFER_PHONE_NUMBER || getSetting('transfer_phone_number') || '+15551234567';

  const lead = findLeadByPhone(fromPhone);
  if (lead && callSid !== 'unknown') {
    db.prepare("INSERT OR REPLACE INTO ivr_sessions (call_sid, lead_id, lead_phone, step, data, updated_at) VALUES (?, ?, ?, 'menu', '{}', datetime('now'))")
      .run(callSid, lead.id, fromPhone);
  }

  if (digit === '1') {
    return res.type('text/xml').send(twiml(`${say('Connecting you to a live staff member. Please hold.')} <Dial>${transferNumber}</Dial>`));
  }
  if (digit === '2') {
    return res.type('text/xml').send(twiml(`
      <Gather input="speech" finishOnKey="#" action="${baseUrl}/api/calls/ivr-callback" method="POST" language="en-US" timeout="10">
        ${say('Please state the day and time you would like us to call you back, then press the pound key.')}
      </Gather>
      ${say('We did not receive your input. Goodbye.')} <Hangup/>`));
  }
  if (digit === '3') {
    if (callSid !== 'unknown') updateIvrSession(callSid, 'calendar_ask_day', {});
    return res.type('text/xml').send(twiml(`
      <Gather input="speech" action="${baseUrl}/api/calls/ivr-calendar-day" method="POST" language="en-US" timeout="10">
        ${say('What day would you like to schedule a virtual meeting? Please say a date like Monday or April twenty first.')}
      </Gather>
      ${say('We did not receive your input. Goodbye.')} <Hangup/>`));
  }
  if (digit === '4') {
    if (lead) {
      db.prepare("UPDATE leads SET unsubscribed=1 WHERE id=?").run(lead.id);
    }
    return res.type('text/xml').send(twiml(`${say('You have been removed from our list. Thank you. Goodbye.')} <Hangup/>`));
  }
  // Default: replay menu
  return res.type('text/xml').send(twiml(`
    <Gather numDigits="1" action="${baseUrl}/api/calls/ivr-handler" method="POST" timeout="10">
      ${say('Press 1 to connect to a live staff member. Press 2 to set a call back time. Press 3 to schedule a virtual meeting. Press 4 to be removed from our list.')}
    </Gather>
    ${say('Goodbye.')} <Hangup/>`));
});

// â”€â”€â”€ IVR CALLBACK (spoken callback time) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/ivr-callback', (req, res) => {
  const speech = req.body.SpeechResult || 'not provided';
  const fromPhone = req.body.To || req.body.From || '';
  const lead = findLeadByPhone(fromPhone);
  db.prepare('INSERT INTO callbacks (lead_id, lead_name, phone, raw_speech, status) VALUES (?, ?, ?, ?, ?)')
    .run(lead?.id || null, lead?.name || fromPhone, fromPhone, speech, 'pending');
  return res.type('text/xml').send(twiml(`${say(`Thank you. We will call you back ${speech}. Goodbye.`)} <Hangup/>`));
});

// â”€â”€â”€ IVR CALENDAR: ask day â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/ivr-calendar-day', async (req, res) => {
  const speech = req.body.SpeechResult || '';
  const callSid = req.body.CallSid || 'unknown';
  const fromPhone = req.body.To || req.body.From || '';
  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';

  const date = parseSpeechDate(speech);
  if (!date) {
    return res.type('text/xml').send(twiml(`
      <Gather input="speech" action="${baseUrl}/api/calls/ivr-calendar-day" method="POST" language="en-US" timeout="10">
        ${say("I'm sorry, I didn't understand that date. Please say a day like Monday or a date like April twentieth.")}
      </Gather>
      ${say('Goodbye.')} <Hangup/>`));
  }

  const slots = await getAvailableSlots(date);
  if (slots.length === 0) {
    return res.type('text/xml').send(twiml(`
      <Gather input="speech" action="${baseUrl}/api/calls/ivr-calendar-day" method="POST" language="en-US" timeout="10">
        ${say(`I'm sorry, we have no availability on ${formatDate(date)}. Please say another day.`)}
      </Gather>
      ${say('Goodbye.')} <Hangup/>`));
  }

  // Save slots and date in session
  const sessionData = { date: date.toISOString(), slots: slots.map(s => s.toISOString()) };
  if (callSid !== 'unknown') updateIvrSession(callSid, 'calendar_pick_slot', sessionData);

  const slotOptions = slots.map((s, i) => `Press ${i + 1} for ${formatTime(s)}.`).join(' ');
  return res.type('text/xml').send(twiml(`
    <Gather numDigits="1" action="${baseUrl}/api/calls/ivr-calendar-slot" method="POST" timeout="10">
      ${say(`We have availability on ${formatDate(date)} at the following times. ${slotOptions}`)}
    </Gather>
    ${say('Goodbye.')} <Hangup/>`));
});

// â”€â”€â”€ IVR CALENDAR: pick slot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/ivr-calendar-slot', (req, res) => {
  const digit = req.body.Digits;
  const callSid = req.body.CallSid || 'unknown';
  const fromPhone = req.body.To || req.body.From || '';
  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';

  const session = getIvrSession(callSid);
  const slots = (session.dataObj.slots || []).map(s => new Date(s));
  const idx = parseInt(digit) - 1;
  const selectedSlot = slots[idx];

  if (!selectedSlot) {
    return res.type('text/xml').send(twiml(`${say('Invalid selection. Goodbye.')} <Hangup/>`));
  }

  const lead = findLeadByPhone(fromPhone) || (session.lead_id ? db.prepare('SELECT * FROM leads WHERE id=?').get(session.lead_id) : null);
  const newData = { ...session.dataObj, selectedSlot: selectedSlot.toISOString(), leadPhone: fromPhone, leadId: lead?.id };
  if (callSid !== 'unknown') updateIvrSession(callSid, 'calendar_email', newData);

  if (lead?.email) {
    return res.type('text/xml').send(twiml(`
      <Gather numDigits="1" action="${baseUrl}/api/calls/ivr-calendar-email-confirm" method="POST" timeout="10">
        ${say(`We have your email address as ${lead.email.split('').join(' ')}. Press 1 to confirm, press 2 to provide a different email address.`)}
      </Gather>
      ${say('Goodbye.')} <Hangup/>`));
  } else {
    return res.type('text/xml').send(twiml(`
      <Gather input="speech" action="${baseUrl}/api/calls/ivr-calendar-email-new" method="POST" language="en-US" timeout="15">
        ${say('Please say your email address so we can send you the meeting invite.')}
      </Gather>
      ${say('Goodbye.')} <Hangup/>`));
  }
});

// â”€â”€â”€ IVR CALENDAR: confirm email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/ivr-calendar-email-confirm', async (req, res) => {
  const digit = req.body.Digits;
  const callSid = req.body.CallSid || 'unknown';
  const fromPhone = req.body.To || req.body.From || '';
  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';

  const session = getIvrSession(callSid);
  const lead = session.dataObj.leadId ? db.prepare('SELECT * FROM leads WHERE id=?').get(session.dataObj.leadId) : findLeadByPhone(fromPhone);

  if (digit === '2') {
    return res.type('text/xml').send(twiml(`
      <Gather input="speech" action="${baseUrl}/api/calls/ivr-calendar-email-new" method="POST" language="en-US" timeout="15">
        ${say('Please say your new email address.')}
      </Gather>
      ${say('Goodbye.')} <Hangup/>`));
  }
  // digit === '1' or default: use existing email
  await finishCalendarBooking(res, session, lead, lead?.email);
});

// â”€â”€â”€ IVR CALENDAR: new email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/ivr-calendar-email-new', async (req, res) => {
  const speech = req.body.SpeechResult || '';
  const callSid = req.body.CallSid || 'unknown';
  const fromPhone = req.body.To || req.body.From || '';
  const session = getIvrSession(callSid);
  const lead = session.dataObj.leadId ? db.prepare('SELECT * FROM leads WHERE id=?').get(session.dataObj.leadId) : findLeadByPhone(fromPhone);

  // Clean up spoken email (e.g. "john at gmail dot com" -> "john@gmail.com")
  let email = speech.toLowerCase()
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s/g, '');

  // Update lead email if we have a lead
  if (lead && email) {
    db.prepare('UPDATE leads SET email=? WHERE id=?').run(email, lead.id);
  }
  await finishCalendarBooking(res, session, lead, email);
});

async function finishCalendarBooking(res, session, lead, email) {
  const selectedSlot = session.dataObj.selectedSlot ? new Date(session.dataObj.selectedSlot) : null;
  if (!selectedSlot) {
    return res.type('text/xml').send(twiml(`${say('Something went wrong. Please call back to schedule your meeting. Goodbye.')} <Hangup/>`));
  }
  try {
    const event = await createCalendarEvent(lead || { name: session.lead_phone, phone: session.lead_phone, city: '', state: '', keyword: '' }, selectedSlot, email);
    const meetLink = event?.hangoutLink || event?.conferenceData?.entryPoints?.[0]?.uri || '';
    const confirmation = `Your meeting has been scheduled for ${formatSlotLabel(selectedSlot)}. ${email ? `A Google Meet link has been sent to ${email}.` : 'Check your calendar for the Google Meet link.'} Goodbye.`;
    return res.type('text/xml').send(twiml(`${say(confirmation)} <Hangup/>`));
  } catch (err) {
    console.error('Calendar create error:', err.message);
    return res.type('text/xml').send(twiml(`${say(`Your meeting has been reserved for ${formatSlotLabel(selectedSlot)}. We will follow up with a calendar invite. Goodbye.`)} <Hangup/>`));
  }
}

// â”€â”€â”€ RECORDING DONE (voicemail) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/recording-done', (req, res) => {
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thank you for your message. We will call you back shortly. Goodbye.</Say><Hangup/></Response>');
});

// â”€â”€â”€ EMAIL SCRAPER REFRESH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/refresh-emails/:scrapeId', authMiddleware, async (req, res) => {
  try {
    const leads = db.prepare('SELECT * FROM leads WHERE scrape_id = ? AND website != ""').all(req.params.scrapeId);
    let updated = 0;
    for (const lead of leads) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const r = await fetch(lead.website, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(t);
        if (r.ok) {
          const html = await r.text();
          const emails = (html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).filter(e => !e.includes('example.com') && e.length < 80);
          if (emails[0]) { db.prepare('UPDATE leads SET email=?, email_scraped=1 WHERE id=?').run(emails[0], lead.id); updated++; }
        }
      } catch {}
    }
    res.json({ updated, total: leads.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;


