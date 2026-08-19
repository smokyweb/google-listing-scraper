/**
 * voice-drop.js — Per-lead voice drop (two modes)
 *
 * ─── MODE: voicemail (default, primary) ──────────────────────────────────────
 *  System calls the recipient directly — no salesperson leg at all.
 *  Audio is generated first (ElevenLabs or <Say> fallback), then the call is
 *  placed with inline TwiML that auto-plays the message on connect.
 *  After the message, the standard IVR menu plays (Press 1/2/3/4).
 *  Works whether a human answers or voicemail picks up.
 *
 * ─── MODE: agent (optional, clearly labeled) ─────────────────────────────────
 *  Requires the salesperson to have a forward_number set.
 *  1. Calls salesperson's forward_number first → they join a conference.
 *  2. System then calls the lead → lead joins same conference.
 *  3. Salesperson hears the lead live.
 *  4. Salesperson manually clicks "Drop Voice Message" to play the script.
 *  5. Audio plays to lead only; salesperson leg is immediately hung up.
 *  6. After playback, lead hears IVR menu (Press 1/2/3/4).
 *
 * API:
 *   POST /api/voice-drop/start                 — start session (mode required)
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

function normalizePhone(raw) {
  if (!raw) return '';
  let n = raw.replace(/\D/g, '');
  if (n.length === 10) n = '1' + n;
  if (!n.startsWith('+')) n = '+' + n;
  return n;
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
    if (statusCallbackEvent) body.append('StatusCallbackEvent', statusCallbackEvent);
  }
  const resp = await fetch(
    `https://${config.spaceUrl}/api/laml/2010-04-01/Accounts/${config.projectId}/Calls.json`,
    {
      method: 'POST',
      headers: { Authorization: swAuthHeader(config), 'Content-Type': 'application/x-www-form-urlencoded' },
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
      headers: { Authorization: swAuthHeader(config), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) console.warn(`[VoiceDrop] updateCall ${callSid} failed:`, data.message || resp.status);
  return data;
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

/**
 * Build the complete playback TwiML:
 *   <Play> or <Say> the message, then drop into the IVR menu.
 */
function buildPlaybackTwiml(audioUrl, scriptText, baseUrl) {
  const messageEl = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : `<Say voice="alice">${xmlEscape(scriptText || 'Thank you for your time.')}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messageEl}${ivrMenuTwiml(baseUrl)}</Response>`;
}

// Conference TwiML for agent-mode legs
function agentConferenceTwiml(confName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="alice">Lead is connecting. Please hold.</Say>` +
    `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="">${xmlEscape(confName)}</Conference></Dial>` +
    `</Response>`
  );
}

function leadConferenceTwiml(confName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">${xmlEscape(confName)}</Conference></Dial>` +
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
  return def?.number || config.phoneNumber;
}

function personalizeScript(scriptText, lead) {
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
 * Body: { leadId, scriptText?, voiceScriptId?, mode }
 *   mode = 'voicemail' (default) | 'agent'
 *
 * voicemail: generates audio, calls lead directly, auto-plays + IVR menu.
 * agent:     calls salesperson forward_number first, then lead; manual drop.
 */
router.post('/start', authMiddleware, async (req, res) => {
  try {
    cleanupExpiredSessions();

    const { leadId, scriptText, voiceScriptId, mode = 'voicemail' } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });
    if (!['voicemail', 'agent'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "voicemail" or "agent"' });
    }

    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;

    // ── Lead validation ──────────────────────────────────────────────────────
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.phone) return res.status(400).json({ error: 'Lead has no phone number' });

    if (req.user.role === 'salesperson') {
      if (lead.assigned_user_id && lead.assigned_user_id !== req.user.userId) {
        return res.status(403).json({ error: 'This lead is not assigned to you' });
      }
    }

    // ── Resolve outbound caller-ID number ───────────────────────────────────
    let fromNumber;
    if (req.user.role === 'salesperson' && req.user.userId) {
      const { fromNumber: fn } = resolveSalespersonNumbers(req.user.userId);
      fromNumber = fn;
      if (!fromNumber) {
        return res.status(400).json({ error: 'No SignalWire phone number assigned to your account.' });
      }
    } else {
      fromNumber = resolveAdminFromNumber(config);
    }

    // ── Resolve agent forward number (agent mode only) ───────────────────────
    let agentPhone = null;
    if (mode === 'agent') {
      if (req.user.role === 'salesperson' && req.user.userId) {
        const { forwardNumber } = resolveSalespersonNumbers(req.user.userId);
        if (!forwardNumber) {
          return res.status(400).json({
            error:
              'Agent-Audio mode requires a forward number on your account. ' +
              'Ask your admin to set your forward number, or use Voicemail Drop instead.',
          });
        }
        agentPhone = normalizePhone(forwardNumber);
      } else {
        const transfer =
          getSetting('transfer_phone_number') || process.env.TRANSFER_PHONE_NUMBER;
        if (!transfer) {
          return res.status(400).json({
            error:
              'Agent-Audio mode requires transfer_phone_number in Settings, or use Voicemail Drop instead.',
          });
        }
        agentPhone = normalizePhone(transfer);
      }
    }

    // ── Resolve script ───────────────────────────────────────────────────────
    let resolvedScript = scriptText || '';
    if (!resolvedScript && voiceScriptId) {
      const vs = db.prepare('SELECT script FROM voice_scripts WHERE id = ?').get(voiceScriptId);
      if (vs) resolvedScript = vs.script;
    }
    if (!resolvedScript) {
      const active = db.prepare('SELECT script FROM voice_scripts WHERE is_active=1 LIMIT 1').get();
      resolvedScript =
        active?.script ||
        'Hello, this is an important message for your business. Thank you for your time.';
    }
    resolvedScript = personalizeScript(resolvedScript, lead);

    // ── Create session ───────────────────────────────────────────────────────
    const sessionId = uuidv4();
    const confName = `vd-${sessionId}`;
    const leadPhone = normalizePhone(lead.phone);
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
      sessionId, salespersonId, leadId, leadPhone, confName,
      fromNumber, agentPhone, resolvedScript, mode, expiresAt
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
      // Generate audio first so it's ready when the call connects
      const audioUrl = await generateElevenLabsAudio(resolvedScript, baseUrl);
      if (audioUrl) updateSession(sessionId, { audio_url: audioUrl });

      const callTwiml = buildPlaybackTwiml(audioUrl, resolvedScript, baseUrl);
      const leadCall = await placeCall(config, {
        from: fromNumber,
        to: leadPhone,
        twiml: callTwiml,
        statusCallback: `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=lead`,
        statusCallbackEvent: 'initiated ringing answered completed',
      });
      updateSession(sessionId, { recipient_call_sid: leadCall.sid });
      console.log(`[VoiceDrop][voicemail] Session ${sessionId}: calling ${leadPhone} SID=${leadCall.sid}`);
      return res.json({ sessionId, mode: 'voicemail', state: 'initiated' });
    }

    // ── AGENT MODE ───────────────────────────────────────────────────────────
    // Call agent first; lead call is placed from the webhook when agent answers.
    // Also pre-generate audio in background.
    const agentCall = await placeCall(config, {
      from: fromNumber,
      to: agentPhone,
      twiml: agentConferenceTwiml(confName),
      statusCallback: `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=agent`,
      statusCallbackEvent: 'initiated ringing answered completed',
    });
    updateSession(sessionId, { agent_call_sid: agentCall.sid });
    console.log(`[VoiceDrop][agent] Session ${sessionId}: calling agent ${agentPhone} SID=${agentCall.sid}`);

    // Pre-generate audio in background
    generateElevenLabsAudio(resolvedScript, baseUrl)
      .then(url => { if (url) updateSession(sessionId, { audio_url: url }); })
      .catch(() => {});

    return res.json({ sessionId, mode: 'agent', state: 'initiated', agentCallSid: agentCall.sid });
  } catch (err) {
    console.error('[VoiceDrop] start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /session/:id — poll ──────────────────────────────────────────────────

router.get('/session/:id', authMiddleware, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });
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
 * AGENT MODE ONLY. Plays audio to recipient leg only, hangs up agent,
 * then serves the standard IVR menu to recipient.
 */
router.post('/drop-message', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });

    if (session.mode === 'voicemail') {
      return res.status(409).json({
        error: 'drop-message is not applicable for voicemail mode — audio plays automatically.',
      });
    }
    if (session.state === 'mock') {
      updateSession(sessionId, { state: 'completed' });
      return res.json({ success: true, state: 'completed', mock: true });
    }
    if (session.state !== 'recipient_answered') {
      return res.status(409).json({
        error: `Cannot drop in state "${session.state}". Lead must be connected first.`,
      });
    }
    if (!session.recipient_call_sid) {
      return res.status(409).json({ error: 'Recipient call SID missing.' });
    }

    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
    const config = getSignalWireConfig();

    // Use pre-generated audio or generate now
    let audioUrl = session.audio_url;
    if (!audioUrl && session.script_text) {
      console.log('[VoiceDrop] Generating audio on-demand for agent drop...');
      audioUrl = await generateElevenLabsAudio(session.script_text, baseUrl);
      if (audioUrl) updateSession(sessionId, { audio_url: audioUrl });
    }

    updateSession(sessionId, { state: 'dropping' });

    // Play message to recipient then IVR menu — agent is NOT in this TwiML
    const playTwiml = buildPlaybackTwiml(audioUrl, session.script_text, baseUrl);

    // Redirect recipient call (kicks them out of conference to play message)
    await updateCall(config, session.recipient_call_sid, { twiml: playTwiml });
    console.log(`[VoiceDrop][agent] Session ${sessionId}: dropping to recipient ${session.recipient_call_sid}`);

    // Hang up agent immediately — they've done their job
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

  console.log(`[VoiceDrop webhook] sid=${sessionId} mode=${session.mode} leg=${leg} status=${CallStatus}`);

  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
  const config = getSignalWireConfig();

  try {
    // ── Voicemail mode: only 'lead' leg ──────────────────────────────────────
    if (session.mode === 'voicemail') {
      if (leg !== 'lead') return; // shouldn't happen
      if (CallStatus === 'in-progress') {
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
      if (CallStatus === 'in-progress') {
        updateSession(sessionId, { state: 'agent_answered', agent_call_sid: CallSid });
        // Now call the lead
        try {
          const leadCall = await placeCall(config, {
            from: session.from_number,
            to: session.lead_phone,
            twiml: leadConferenceTwiml(session.conference_name),
            statusCallback: `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=lead`,
            statusCallbackEvent: 'initiated ringing answered completed',
          });
          updateSession(sessionId, { recipient_call_sid: leadCall.sid });
          console.log(`[VoiceDrop][agent] Lead call to ${session.lead_phone} SID=${leadCall.sid}`);
        } catch (err) {
          console.error(`[VoiceDrop][agent] Failed to call lead:`, err.message);
          updateSession(sessionId, { state: 'failed', error_msg: `Failed to call lead: ${err.message}` });
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
      if (CallStatus === 'in-progress') {
        updateSession(sessionId, { state: 'recipient_answered', recipient_call_sid: CallSid });
        console.log(`[VoiceDrop][agent] Lead answered — ready to drop`);
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
          updateSession(sessionId, { state: 'failed', error_msg: 'Lead disconnected unexpectedly' });
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
