/**
 * voice-drop.js — Per-lead (or manual number) voice drop — two modes
 *
 * ─── MODE: voicemail ─────────────────────────────────────────────────────────
 *  "Voicemail Drop"
 *  System calls the recipient directly — no salesperson leg at all.
 *  Audio is generated first (ElevenLabs or <Say> fallback), then the call is
 *  placed with inline TwiML that auto-plays the message on connect.
 *  After the message, the standard IVR menu plays (Press 1/2/3/4).
 *  Works whether a human answers or voicemail picks up.
 *  Salesperson leg is never created.
 *
 * ─── MODE: agent ─────────────────────────────────────────────────────────────
 *  "Live Voice Message"
 *  Requires the salesperson to have a forward_number set.
 *  1. Calls salesperson's forward_number first → they join a conference MUTED
 *     (they can hear but the recipient CANNOT hear them).
 *  2. System then calls the recipient → recipient joins same conference.
 *  3. Salesperson hears the recipient live (listen-only).
 *  4. Salesperson manually clicks "Drop Voice Message" to play the script.
 *  5. Audio plays to recipient only; salesperson leg is immediately hung up.
 *  6. After playback, recipient hears IVR menu (Press 1/2/3/4).
 *
 * API:
 *   POST /api/voice-drop/start
 *     Body: { leadId?, targetPhone?, scriptText?, voiceScriptId?, mode }
 *     Either leadId OR targetPhone is required.
 *     targetPhone: E.164 or 10-digit US number — used when there is no lead row.
 *
 *   GET  /api/voice-drop/session/:id           — poll state
 *   POST /api/voice-drop/drop-message          — (agent mode only) manual drop
 *   POST /api/voice-drop/cancel                — hang up all legs
 *   POST /api/voice-drop/webhook/call-status   — SignalWire status callback
 *   POST /api/voice-drop/cleanup               — admin: prune old sessions
 */

'use strict';

const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Public host used by SignalWire callbacks and generated audio URLs.
// Keep calls functional when BASE_URL is omitted from Coolify environment.
const PUBLIC_BASE_URL = process.env.BASE_URL || 'https://listing-scraper.bluesapps.com';

const AUDIO_DIR = path.join(__dirname, '..', '..', 'data', 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Config helpers ──────────────────────────────────────────────────────────

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
    voiceId:
      process.env.ELEVENLABS_VOICE_ID ||
      getSetting('elevenlabs_voice_id') ||
      '21m00Tcm4TlvDq8ikWAM',
  };
}

function swAuthHeader(config) {
  return 'Basic ' + Buffer.from(`${config.projectId}:${config.token}`).toString('base64');
}

/**
 * Normalize a raw phone string to E.164 (+1XXXXXXXXXX for US numbers).
 * Returns '' if the input is empty/null.
 */
function normalizePhone(raw) {
  if (!raw) return '';
  let n = raw.replace(/\D/g, '');
  if (n.length === 10) n = '1' + n;
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}

/**
 * Validate that a normalized phone number looks like a valid E.164 string.
 * Accepts +10000000000 to +199999999999999 (ITU: 1–15 digits after +).
 */
function isValidE164(normalized) {
  return /^\+\d{10,15}$/.test(normalized);
}

// ── ElevenLabs TTS ──────────────────────────────────────────────────────────

async function generateElevenLabsAudio(text, baseUrl) {
  const config = getElevenLabsConfig();
  if (!config.apiKey) return null;
  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          speed: 0.85,
        }),
      }
    );
    if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const filename = `vd_${uuidv4()}.mp3`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), buffer);
    setTimeout(() => {
      try { fs.unlinkSync(path.join(AUDIO_DIR, filename)); } catch {}
    }, SESSION_TTL_MS);
    const url = `${baseUrl}/audio/${filename}`;
    console.log(`[VoiceDrop] ElevenLabs audio: ${url}`);
    return url;
  } catch (err) {
    console.error('[VoiceDrop] ElevenLabs error:', err.message);
    return null;
  }
}

// ── SignalWire REST ──────────────────────────────────────────────────────────

async function placeCall(config, { from, to, twiml, statusCallback, statusCallbackEvent }) {
  const body = new URLSearchParams({ From: from, To: to, Twiml: twiml });
  if (statusCallback) {
    body.append('StatusCallback', statusCallback);
    body.append('StatusCallbackMethod', 'POST');
    if (statusCallbackEvent) {
      // SignalWire's Compatibility API expects callback events as one
      // space-delimited value. Live Voice only passes `answered`; completed
      // and failed are delivered by the provider defaults.
      body.append(
        'StatusCallbackEvent',
        Array.isArray(statusCallbackEvent)
          ? statusCallbackEvent.join(' ')
          : String(statusCallbackEvent).trim()
      );
    }
  }
  const resp = await fetch(
    `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: swAuthHeader(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || `SignalWire ${resp.status}`);
  return data;
}

async function updateCall(config, callSid, { twiml, status }) {
  const body = new URLSearchParams();
  if (twiml) body.append('Twiml', twiml);
  if (status) body.append('Status', status);
  const resp = await fetch(
    `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Calls/${callSid}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: swAuthHeader(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok)
    console.warn(`[VoiceDrop] updateCall ${callSid} failed:`, data.message || resp.status);
  return data;
}

async function fetchCallStatus(config, callSid) {
  if (!config.projectId || !config.token || !callSid) return null;
  try {
    const resp = await fetch(
      `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Calls/${callSid}.json`,
      { headers: { Authorization: swAuthHeader(config) } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status || null;
  } catch {
    return null;
  }
}

// ── TwiML builders ──────────────────────────────────────────────────────────

function xmlEscape(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Standard IVR menu that plays after the voice message.
 * Recipients can press 1-4 — handled by the existing /api/calls/ivr-handler.
 */
function ivrMenuTwiml(baseUrl) {
  return (
    `<Gather numDigits="1" action="${baseUrl}/api/calls/ivr-handler" method="POST" timeout="15">` +
    `<Say voice="alice">Press 1 to connect to a live staff member. ` +
    `Press 2 to set a call back time. ` +
    `Press 3 to schedule a virtual meeting. ` +
    `Press 4 to be removed from our list.</Say>` +
    `</Gather>` +
    `<Say voice="alice">We did not receive your input. Goodbye.</Say>` +
    `<Hangup/>`
  );
}

// Empty conference wait music can fall back to provider ringback on some
// Compatibility API accounts. Return explicit silence while the lead leg is
// being connected so the salesperson hears only the live conference audio.
router.all('/silence', (req, res) => {
  res.type('text/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="60"/></Response>'
  );
});

/**
 * Build the complete playback TwiML:
 *   <Play> or <Say> the message, then optionally drop into the IVR menu.
 */
function buildPlaybackTwiml(audioUrl, scriptText, baseUrl, includeIvr = true) {
  const messageEl = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : `<Say voice="alice">${xmlEscape(scriptText || 'Thank you for your time.')}</Say>`;
  const nextStep = includeIvr ? ivrMenuTwiml(baseUrl) : '<Hangup/>';
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messageEl}${nextStep}</Response>`;
}

/**
 * Conference TwiML for the AGENT (salesperson) leg.
 * muted="true" — agent can HEAR the recipient but the recipient cannot hear the agent.
 * This is the listen-only / monitoring leg.
 */
function agentConferenceTwiml(confName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="alice">Lead is connecting. You are in listen-only mode — your microphone is muted. Click Drop Voice Message in the app when you are ready.</Say>` +
    `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="${PUBLIC_BASE_URL}/api/voice-drop/silence" muted="true">${xmlEscape(confName)}</Conference></Dial>` +
    `</Response>`
  );
}

/**
 * Conference TwiML for the RECIPIENT (lead) leg.
 * The recipient joins normally — they will hear whatever is played to the conference.
 * No audio is played until the agent triggers the drop.
 */
function leadConferenceTwiml(confName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="${PUBLIC_BASE_URL}/api/voice-drop/silence">${xmlEscape(confName)}</Conference></Dial>` +
    `</Response>`
  );
}

// ── Session helpers ──────────────────────────────────────────────────────────

function getSession(id) {
  return db.prepare('SELECT * FROM voice_drop_sessions WHERE id = ?').get(id);
}

function updateSession(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE voice_drop_sessions SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}

function canAccessSession(session, user) {
  if (!session) return false;
  if (user.role === 'admin') return true;
  return session.salesperson_id === user.userId;
}

function cleanupExpiredSessions() {
  try {
    db.prepare("DELETE FROM voice_drop_sessions WHERE expires_at < datetime('now')").run();
  } catch {}
}

function validateWebhook(req) {
  const config = getSignalWireConfig();
  if (!config.projectId) return true; // dev — unconfigured
  const accountSid = req.body?.AccountSid || req.body?.account_sid;
  if (!accountSid) return false;
  return accountSid === config.projectId;
}

// Resolve salesperson numbers
function resolveSalespersonNumbers(userId) {
  const sp = db.prepare('SELECT forward_number, phone_number_id FROM sales_users WHERE id = ?').get(userId);
  if (!sp) return { forwardNumber: null, fromNumber: null };
  let fromNumber = null;
  if (sp.phone_number_id) {
    const pn = db.prepare('SELECT number FROM phone_numbers WHERE id = ?').get(sp.phone_number_id);
    if (pn) fromNumber = pn.number;
  }
  return { forwardNumber: sp.forward_number || null, fromNumber };
}

function resolveAdminFromNumber(config) {
  const def = db.prepare('SELECT number FROM phone_numbers WHERE is_default=1 LIMIT 1').get();
  if (def?.number) return def.number;
  // Older/imported databases may have valid SignalWire numbers but no default flag.
  const firstConfigured = db.prepare("SELECT number FROM phone_numbers WHERE provider = 'signalwire' AND number IS NOT NULL AND number != '' ORDER BY id LIMIT 1").get();
  return firstConfigured?.number || config.phoneNumber;
}

/**
 * Start the recipient leg for a live-voice session.  This is intentionally
 * idempotent: recent SignalWire accounts do not consistently deliver the
 * agent answered callback, so the recipient must not depend on that callback
 * before entering the conference.
 */
async function startRecipientLeg(config, session, baseUrl) {
  const current = getSession(session.id);
  if (current?.recipient_call_sid) return current.recipient_call_sid;
  const leadCall = await placeCall(config, {
    from: session.from_number,
    to: session.lead_phone,
    twiml: leadConferenceTwiml(session.conference_name),
    statusCallback: `${baseUrl}/api/voice-drop/webhook/call-status?sid=${session.id}&leg=lead`,
    statusCallbackEvent: 'answered',
  });
  updateSession(session.id, { recipient_call_sid: leadCall.sid });
  console.log(`[VoiceDrop][agent] Lead call to ${session.lead_phone} SID=${leadCall.sid}`);
  return leadCall.sid;
}

function personalizeScript(scriptText, lead) {
  if (!lead) return scriptText || '';
  return (scriptText || '')
    .replace(/{company_name}/g, lead.name || '')
    .replace(/{business_name}/g, lead.name || '')
    .replace(/{city}/g, lead.city || '')
    .replace(/{state}/g, lead.state || '')
    .replace(/{keyword}/g, lead.keyword || '')
    .replace(/{phone}/g, lead.phone || '')
    .replace(/{email}/g, lead.email || '');
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/voice-drop/start
 *
 * Body: { leadId?, targetPhone?, scriptText?, voiceScriptId?, mode }
 *   mode = 'voicemail' (default) | 'agent'
 *
 * EITHER leadId OR targetPhone is required.
 *   leadId      — drops to a lead row; assignment/permission is checked.
 *   targetPhone — manual target (E.164 or 10-digit US); no lead row needed.
 *                 Used by the manual Dialer page. Salesperson's assigned
 *                 SignalWire number / forward number rules still apply.
 *
 * voicemail: generates audio, calls recipient directly, auto-plays + IVR menu.
 * agent:     calls salesperson forward_number first (MUTED/listen-only),
 *            then recipient; manual "Drop" button triggers audio.
 */
router.post('/start', authMiddleware, async (req, res) => {
  try {
    cleanupExpiredSessions();

    const { leadId, targetPhone, scriptText, voiceScriptId, mode = 'voicemail' } = req.body;

    // Require leadId OR targetPhone (not both required, but at least one)
    if (!leadId && !targetPhone) {
      return res.status(400).json({ error: 'leadId or targetPhone is required' });
    }
    if (!['voicemail', 'agent'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "voicemail" or "agent"' });
    }

    const baseUrl = PUBLIC_BASE_URL;
    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;

    // ── Lead / manual target resolution ────────────────────────────────────
    let lead = null;
    let leadPhone;

    if (leadId) {
      lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      if (!lead.phone) return res.status(400).json({ error: 'Lead has no phone number' });

      if (req.user.role === 'salesperson') {
        if (lead.assigned_user_id && lead.assigned_user_id !== req.user.userId) {
          return res.status(403).json({ error: 'This lead is not assigned to you' });
        }
      }
      leadPhone = normalizePhone(lead.phone);
      if (!isValidE164(leadPhone)) {
        return res.status(400).json({
          error: `Lead phone number "${lead.phone}" is not a valid E.164 number. Please correct it in the lead record.`,
        });
      }
    } else {
      // Manual targetPhone — validate
      leadPhone = normalizePhone(targetPhone);
      if (!isValidE164(leadPhone)) {
        return res.status(400).json({
          error:
            'Invalid phone number. Provide a valid US number (10 digits) or E.164 format (+1XXXXXXXXXX).',
        });
      }
    }

    // ── Resolve outbound caller-ID number ───────────────────────────────────
    let fromNumber;
    if (req.user.role === 'salesperson' && req.user.userId) {
      const { fromNumber: fn } = resolveSalespersonNumbers(req.user.userId);
      fromNumber = fn;
      if (!fromNumber) {
        return res.status(400).json({
          error: 'No SignalWire phone number assigned to your account.',
        });
      }
    } else {
      fromNumber = resolveAdminFromNumber(config);
    }
    // Normalize and validate the From/caller-ID before any call is placed
    fromNumber = normalizePhone(fromNumber);
    if (!isValidE164(fromNumber)) {
      return res.status(400).json({
        error: `Configured caller-ID "${fromNumber}" is not a valid E.164 number. ` +
               'Please set a valid SignalWire phone number in Settings.',
      });
    }

    // ── Resolve agent forward number (agent mode only) ───────────────────────
    let agentPhone = null;
    if (mode === 'agent') {
      if (req.user.role === 'salesperson' && req.user.userId) {
        const { forwardNumber } = resolveSalespersonNumbers(req.user.userId);
        if (!forwardNumber) {
          return res.status(400).json({
            error:
              'Live Voice Message requires a forward number on your account. ' +
              'Ask your admin to set your forward number, or use Voicemail Drop instead.',
          });
        }
        agentPhone = normalizePhone(forwardNumber);
        if (!isValidE164(agentPhone)) {
          return res.status(400).json({
            error: `Your forward number "${forwardNumber}" is not a valid E.164 number. ` +
                   'Please update it in your profile.',
          });
        }
      } else {
        const transfer =
          getSetting('transfer_phone_number') || process.env.TRANSFER_PHONE_NUMBER;
        if (!transfer) {
          return res.status(400).json({
            error:
              'Live Voice Message requires transfer_phone_number in Settings, or use Voicemail Drop instead.',
          });
        }
        agentPhone = normalizePhone(transfer);
        if (!isValidE164(agentPhone)) {
          return res.status(400).json({
            error: `Transfer phone number "${transfer}" in Settings is not a valid E.164 number. ` +
                   'Please correct it in Settings.',
          });
        }
      }
    }

    // ── Resolve script ───────────────────────────────────────────────────────
    let resolvedScript = scriptText || '';
    if (!resolvedScript && voiceScriptId) {
      const scriptMode = mode === 'agent' ? 'live' : 'voicemail';
      const vs = db.prepare('SELECT script FROM voice_scripts WHERE id = ? AND mode = ?').get(voiceScriptId, scriptMode);
      if (vs) resolvedScript = vs.script;
    }
    if (!resolvedScript) {
      const scriptMode = mode === 'agent' ? 'live' : 'voicemail';
      const ownActive = req.user?.role === 'salesperson'
        ? db.prepare('SELECT script FROM voice_scripts WHERE mode = ? AND created_by_user_id = ? AND is_active = 1 LIMIT 1').get(scriptMode, req.user.userId)
        : null;
      const active = ownActive || db.prepare('SELECT script FROM voice_scripts WHERE mode = ? AND created_by_user_id IS NULL AND is_active = 1 LIMIT 1').get(scriptMode);
      resolvedScript =
        active?.script ||
        'Hello, this is an important message for your business. Thank you for your time.';
    }
    resolvedScript = personalizeScript(resolvedScript, lead);

    // ── Create session ───────────────────────────────────────────────────────
    const sessionId = uuidv4();
    const confName = `vd-${sessionId}`;
    const salespersonId = req.user.role === 'salesperson' ? req.user.userId : null;
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);

    db.prepare(`
      INSERT INTO voice_drop_sessions
        (id, salesperson_id, lead_id, lead_phone, conference_name, from_number,
         agent_phone, script_text, mode, state, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?)
    `).run(
      sessionId,
      salespersonId,
      lead ? lead.id : null,   // NULL for manual targetPhone sessions
      leadPhone,
      confName,
      fromNumber,
      agentPhone,
      resolvedScript,
      mode,
      expiresAt
    );

    // ── Mock mode ────────────────────────────────────────────────────────────
    if (isMock) {
      updateSession(sessionId, { state: 'mock' });
      return res.json({
        sessionId,
        mock: true,
        mode,
        state: 'mock',
        message: '[MOCK] Voice drop session created — SignalWire not configured.',
      });
    }

    // ── VOICEMAIL MODE ───────────────────────────────────────────────────────
    if (mode === 'voicemail') {
      // Generate audio first so it is ready when the call connects
      const audioUrl = await generateElevenLabsAudio(resolvedScript, baseUrl);
      if (audioUrl) updateSession(sessionId, { audio_url: audioUrl });

      const callTwiml = buildPlaybackTwiml(audioUrl, resolvedScript, baseUrl, false);
      const leadCall = await placeCall(config, {
        from: fromNumber,
        to: leadPhone,
        twiml: callTwiml,
        statusCallback: `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=lead`,
        statusCallbackEvent: 'answered',
      });
      updateSession(sessionId, { recipient_call_sid: leadCall.sid });
      console.log(
        `[VoiceDrop][voicemail] Session ${sessionId}: calling ${leadPhone} SID=${leadCall.sid}`
      );
      return res.json({ sessionId, mode: 'voicemail', state: 'initiated' });
    }

    // ── AGENT MODE (Live Voice Message) ─────────────────────────────────────
    // Call agent first — MUTED so they can hear but recipient cannot hear them.
    // Lead call is placed from the webhook when agent answers.
    // Also pre-generate audio in background.
    const agentCall = await placeCall(config, {
      from: fromNumber,
      to: agentPhone,
      twiml: agentConferenceTwiml(confName),
      statusCallback: `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=agent`,
      statusCallbackEvent: 'answered',
    });
    updateSession(sessionId, { agent_call_sid: agentCall.sid });
    console.log(
      `[VoiceDrop][agent] Session ${sessionId}: calling agent ${agentPhone} SID=${agentCall.sid}`
    );

    // Do not wait for SignalWire's agent answered callback to create the lead
    // leg. Both legs can safely wait in the same conference until the other
    // joins, but the session must remain initiated until the salesperson
    // actually answers.
    await startRecipientLeg(config, getSession(sessionId), baseUrl);

    // Pre-generate audio in background
    generateElevenLabsAudio(resolvedScript, baseUrl)
      .then(url => { if (url) updateSession(sessionId, { audio_url: url }); })
      .catch(() => {});

    return res.json({
      sessionId,
      mode: 'agent',
      state: 'initiated',
      agentCallSid: agentCall.sid,
    });
  } catch (err) {
    console.error('[VoiceDrop] start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /session/:id — poll ──────────────────────────────────────────────────

router.get('/session/:id', authMiddleware, async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });

  // Reconcile from SignalWire when a provider callback was dropped. The
  // salesperson leg is checked first; otherwise the session could expose
  // lead-drop controls even though the salesperson never received the call.
  if (session.mode === 'agent' && session.agent_call_sid && session.state === 'initiated') {
    const agentStatus = await fetchCallStatus(getSignalWireConfig(), session.agent_call_sid);
    if (agentStatus === 'answered') {
      updateSession(session.id, { state: 'agent_answered' });
      session.state = 'agent_answered';
    } else if (['no-answer', 'busy', 'failed', 'canceled', 'completed'].includes(agentStatus)) {
      updateSession(session.id, { state: 'failed', error_msg: `Salesperson call ${agentStatus}` });
      session.state = 'failed';
      session.error_msg = `Salesperson call ${agentStatus}`;
    }
  }

  if (
    session.mode === 'agent' &&
    session.recipient_call_sid &&
    session.state === 'agent_answered'
  ) {
    const leadStatus = await fetchCallStatus(getSignalWireConfig(), session.recipient_call_sid);
    // REST status can report in-progress while the outbound leg is still
    // being established on some Compatibility API accounts. Only the
    // explicit answered callback is safe for enabling the salesperson's
    // drop controls; otherwise the UI can claim the lead answered early.
    if (leadStatus === 'answered') {
      updateSession(session.id, { state: 'recipient_answered' });
      session.state = 'recipient_answered';
    } else if (['no-answer', 'busy', 'failed', 'canceled', 'completed'].includes(leadStatus)) {
      updateSession(session.id, { state: 'failed', error_msg: `Lead call ${leadStatus}` });
      session.state = 'failed';
      session.error_msg = `Lead call ${leadStatus}`;
    }
  }
  res.json({
    id: session.id,
    mode: session.mode || 'voicemail',
    state: session.state,
    error: session.error_msg,
    leadId: session.lead_id,
    leadPhone: session.lead_phone,
    hasAudio: !!session.audio_url,
    createdAt: session.created_at,
  });
});

// ── POST /drop-message — agent mode only ────────────────────────────────────

/**
 * POST /api/voice-drop/drop-message
 * AGENT MODE ("Live Voice Message") ONLY.
 * Plays audio to recipient leg only, hangs up agent immediately,
 * then serves the standard IVR menu to recipient.
 *
 * Idempotent: if already in 'dropping' state, returns success without re-triggering.
 */
router.post('/drop-message', authMiddleware, async (req, res) => {
  try {
    const { sessionId, scriptText, voiceScriptId, dropMode = 'live' } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });

    if (session.mode === 'voicemail') {
      return res.status(409).json({
        error: 'drop-message is not applicable for Voicemail Drop — audio plays automatically.',
      });
    }

    // Idempotent: already dropping/completed
    if (session.state === 'dropping') {
      return res.json({ success: true, state: 'dropping', idempotent: true });
    }
    if (session.state === 'completed') {
      return res.json({ success: true, state: 'completed', idempotent: true });
    }

    if (session.state === 'mock') {
      updateSession(sessionId, { state: 'completed' });
      return res.json({ success: true, state: 'completed', mock: true });
    }
    if (session.state !== 'recipient_answered') {
      return res.status(409).json({
        error: `Cannot drop in state "${session.state}". Recipient must be connected first.`,
      });
    }
    if (!session.recipient_call_sid) {
      return res.status(409).json({ error: 'Recipient call SID missing.' });
    }

    const baseUrl = PUBLIC_BASE_URL;
    const config = getSignalWireConfig();

    // A Live Voice session can use either script library after the recipient
    // answers: live-person message or voicemail message. Resolve the choice
    // here so the Leads page cannot accidentally play its initial script.
    let selectedDropScript = scriptText || session.script_text;
    if (voiceScriptId) {
      const selected = db.prepare(
        "SELECT script, mode FROM voice_scripts WHERE id = ? AND mode IN ('live', 'voicemail')"
      ).get(voiceScriptId);
      if (selected) {
        selectedDropScript = selected.script;
      }
    }
    if (session.lead_id && selectedDropScript) {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(session.lead_id);
      selectedDropScript = personalizeScript(selectedDropScript, lead);
    }

    // Use pre-generated audio or generate now
    // The pre-generated audio belongs to the initial Live Voice script. If
    // the salesperson selected a different (for example voicemail) script,
    // force fresh audio for that selection.
    let audioUrl = selectedDropScript === session.script_text ? session.audio_url : null;
    if (!audioUrl && selectedDropScript) {
      console.log('[VoiceDrop] Generating audio on-demand for agent drop...');
      audioUrl = await generateElevenLabsAudio(selectedDropScript, baseUrl);
      if (audioUrl) updateSession(sessionId, { audio_url: audioUrl });
    }

    updateSession(sessionId, { state: 'dropping' });

    // Play message to recipient then IVR menu — agent is NOT in this TwiML
    // The action the salesperson chose controls the call flow.  A script can
    // come from either library, but the normal "Drop Voice Message" action
    // must always leave the lead in the response menu.  Previously we also
    // used the selected script's library mode here, which silently removed
    // the lead controls when a voicemail-library script was selected from
    // the live call flow.
    const playTwiml = buildPlaybackTwiml(
      audioUrl,
      selectedDropScript,
      baseUrl,
      dropMode !== 'voicemail'
    );

    // Redirect recipient call (kicks them out of conference to play message)
    await updateCall(config, session.recipient_call_sid, { twiml: playTwiml });
    console.log(
      `[VoiceDrop][agent] Session ${sessionId}: dropping to recipient ${session.recipient_call_sid}`
    );

    // Hang up agent immediately — they are done
    if (session.agent_call_sid) {
      updateCall(config, session.agent_call_sid, { status: 'completed' }).catch(e => {
        console.warn('[VoiceDrop] Agent hangup warning:', e.message);
      });
    }

    res.json({ success: true, state: 'dropping', usedElevenLabs: !!audioUrl });
  } catch (err) {
    console.error('[VoiceDrop] drop-message error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cancel ─────────────────────────────────────────────────────────────

router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });

    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;

    if (!isMock) {
      if (session.agent_call_sid) {
        updateCall(config, session.agent_call_sid, { status: 'completed' }).catch(() => {});
      }
      if (session.recipient_call_sid) {
        updateCall(config, session.recipient_call_sid, { status: 'completed' }).catch(() => {});
      }
    }

    updateSession(sessionId, { state: 'cancelled' });
    res.json({ success: true, state: 'cancelled' });
  } catch (err) {
    console.error('[VoiceDrop] cancel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cleanup (admin) ─────────────────────────────────────────────────────

router.post('/cleanup', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const result = db
    .prepare(
      "DELETE FROM voice_drop_sessions WHERE expires_at < datetime('now') OR (state IN ('completed','cancelled','failed') AND created_at < datetime('now', '-1 day'))"
    )
    .run();
  res.json({ success: true, deleted: result.changes });
});

// ── POST /webhook/call-status ─────────────────────────────────────────────────

/**
 * SignalWire status callback for both agent and lead legs.
 * Query params: sid (sessionId), leg ('agent' | 'lead')
 * Responds 204 immediately so SignalWire doesn't retry on our processing time.
 */
router.post('/webhook/call-status', async (req, res) => {
  res.status(204).send();

  const { sid: sessionId, leg } = req.query;
  const { CallStatus, CallSid } = req.body;
  // Only an explicit `answered` callback confirms that the remote party has
  // answered. `in-progress` is also used for an outbound leg that is still
  // being established by some Compatibility API accounts.
  const callAnswered = CallStatus === 'answered';

  if (!sessionId || !leg) {
    console.warn('[VoiceDrop webhook] Missing sid or leg');
    return;
  }
  if (!validateWebhook(req)) {
    console.warn('[VoiceDrop webhook] Invalid AccountSid — ignoring');
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    console.warn('[VoiceDrop webhook] Session not found:', sessionId);
    return;
  }

  console.log(
    `[VoiceDrop webhook] sid=${sessionId} mode=${session.mode} leg=${leg} status=${CallStatus}`
  );

  const baseUrl = PUBLIC_BASE_URL;
  const config = getSignalWireConfig();

  try {
    // ── Voicemail mode: only 'lead' leg ──────────────────────────────────────
    if (session.mode === 'voicemail') {
      if (leg !== 'lead') return;
      if (callAnswered) {
        updateSession(sessionId, { state: 'active', recipient_call_sid: CallSid });
      } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(CallStatus)) {
        updateSession(sessionId, { state: 'failed', error_msg: `Call ${CallStatus}` });
      } else if (CallStatus === 'completed') {
        const cur = getSession(sessionId);
        if (cur && !['completed', 'failed', 'cancelled'].includes(cur.state)) {
          updateSession(sessionId, { state: 'completed' });
        }
      }
      return;
    }

    // ── Agent mode: two legs ──────────────────────────────────────────────────
    if (leg === 'agent') {
      if (callAnswered) {
        updateSession(sessionId, { state: 'agent_answered', agent_call_sid: CallSid });
        // Compatibility API accounts may send this callback late.  The lead
        // leg is normally already started by /start; this remains a safe
        // fallback for sessions created by an older revision.
        try {
          await startRecipientLeg(config, getSession(sessionId), baseUrl);
        } catch (err) {
          console.error(`[VoiceDrop][agent] Failed to call lead:`, err.message);
          updateSession(sessionId, {
            state: 'failed',
            error_msg: `Failed to call lead: ${err.message}`,
          });
          updateCall(config, CallSid, { status: 'completed' }).catch(() => {});
        }
      } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(CallStatus)) {
        updateSession(sessionId, {
          state: 'failed',
          error_msg: `Agent call ${CallStatus} — check your forward number`,
        });
      } else if (CallStatus === 'completed') {
        const cur = getSession(sessionId);
        if (cur && !['completed', 'failed', 'cancelled', 'dropping'].includes(cur.state)) {
          updateSession(sessionId, {
            state: 'failed',
            error_msg: 'Agent disconnected before message was dropped',
          });
          if (cur.recipient_call_sid) {
            updateCall(config, cur.recipient_call_sid, { status: 'completed' }).catch(() => {});
          }
        }
      }
    } else if (leg === 'lead') {
      if (callAnswered) {
        const cur = getSession(sessionId);
        // The lead can answer before the salesperson callback arrives because
        // both legs are started in parallel. Preserve the SID, but do not
        // expose drop controls until the salesperson is confirmed connected.
        if (cur?.state === 'initiated') {
          updateSession(sessionId, { recipient_call_sid: CallSid });
          console.log(`[VoiceDrop][agent] Lead answered while salesperson is still connecting`);
        } else {
          updateSession(sessionId, { state: 'recipient_answered', recipient_call_sid: CallSid });
          console.log(`[VoiceDrop][agent] Lead answered — ready to drop`);
        }
      } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(CallStatus)) {
        updateSession(sessionId, { state: 'failed', error_msg: `Lead call ${CallStatus}` });
        const cur = getSession(sessionId);
        if (cur?.agent_call_sid) {
          updateCall(config, cur.agent_call_sid, { status: 'completed' }).catch(() => {});
        }
      } else if (CallStatus === 'completed') {
        const cur = getSession(sessionId);
        if (!cur) return;
        if (['dropping', 'recipient_answered'].includes(cur.state)) {
          // Lead hung up after IVR interaction or message ended — session complete
          updateSession(sessionId, { state: 'completed' });
        } else if (!['completed', 'failed', 'cancelled'].includes(cur.state)) {
          updateSession(sessionId, {
            state: 'failed',
            error_msg: 'Lead disconnected unexpectedly',
          });
          if (cur.agent_call_sid) {
            updateCall(config, cur.agent_call_sid, { status: 'completed' }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error('[VoiceDrop webhook] Processing error:', err.message);
  }
});

module.exports = router;
