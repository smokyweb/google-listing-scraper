/**
 * voice-drop.js — Agent-assisted voice message drop
 *
 * Flow:
 *   1. POST /start          → create session, call agent's forward_number
 *   2. POST /webhook/call-status?sid=&leg=agent   → agent picked up → call lead
 *   3. POST /webhook/call-status?sid=&leg=lead    → lead picked up → state = recipient_answered
 *   4. GET  /session/:id    → UI polls state
 *   5. POST /drop-message   → redirect recipient call to play audio, hang up agent
 *   6. POST /cancel         → hang up all legs
 *
 * Conference room: both legs join "vd-{sessionId}" so the agent hears the lead.
 * Drop: REST-redirect recipient's call SID to play audio, then hang agent up.
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
    voiceId: process.env.ELEVENLABS_VOICE_ID || getSetting('elevenlabs_voice_id') || '21m00Tcm4TlvDq8ikWAM',
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
    // Auto-cleanup after SESSION_TTL_MS
    setTimeout(() => {
      try { fs.unlinkSync(path.join(AUDIO_DIR, filename)); } catch {}
    }, SESSION_TTL_MS);
    const audioUrl = `${baseUrl}/audio/${filename}`;
    console.log(`[VoiceDrop] ElevenLabs audio ready: ${audioUrl}`);
    return audioUrl;
  } catch (err) {
    console.error('[VoiceDrop] ElevenLabs error:', err.message);
    return null;
  }
}

// ── SignalWire REST helpers ──────────────────────────────────────────────────

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
      headers: {
        Authorization: swAuthHeader(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || `SignalWire error ${resp.status}`);
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
  if (!resp.ok) {
    console.warn(`[VoiceDrop] updateCall ${callSid} failed:`, data.message || resp.status);
  }
  return data;
}

// ── Session helpers ──────────────────────────────────────────────────────────

function getSession(id) {
  return db.prepare('SELECT * FROM voice_drop_sessions WHERE id = ?').get(id);
}

function updateSession(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = Object.values(fields);
  db.prepare(`UPDATE voice_drop_sessions SET ${sets} WHERE id = ?`).run(...vals, id);
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

// Validate SignalWire webhook by checking AccountSid matches our project
function validateWebhook(req) {
  const config = getSignalWireConfig();
  if (!config.projectId) return true; // dev/unconfigured — allow
  const accountSid = req.body?.AccountSid || req.body?.account_sid;
  if (!accountSid) return false;
  return accountSid === config.projectId;
}

// Resolve salesperson's forward number and from (outbound caller-ID) number
function resolveSalespersonNumbers(userId) {
  const sp = db.prepare('SELECT forward_number, phone_number_id FROM sales_users WHERE id = ?').get(userId);
  if (!sp) return { forwardNumber: null, fromNumber: null };

  let fromNumber = null;
  if (sp.phone_number_id) {
    const pn = db.prepare('SELECT number FROM phone_numbers WHERE id = ?').get(sp.phone_number_id);
    if (pn) fromNumber = pn.number;
  }

  // forward_number is how we reach the salesperson's real phone
  return { forwardNumber: sp.forward_number || null, fromNumber };
}

// Build personalized script text
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

// ── TwiML helpers ────────────────────────────────────────────────────────────

function xmlEscape(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function agentConferenceTwiml(confName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Lead is connecting. Please hold.</Say>
  <Dial>
    <Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="">${xmlEscape(confName)}</Conference>
  </Dial>
</Response>`;
}

function leadConferenceTwiml(confName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">${xmlEscape(confName)}</Conference>
  </Dial>
</Response>`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/voice-drop/twiml/hold
 * Silent hold TwiML (returned as waitUrl for conferences)
 */
router.get('/twiml/hold', (req, res) => {
  res.type('text/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="600"/></Response>'
  );
});

/**
 * POST /api/voice-drop/start
 * Initiates an agent-assisted voice drop session.
 */
router.post('/start', authMiddleware, async (req, res) => {
  try {
    cleanupExpiredSessions();

    const { leadId, scriptText, voiceScriptId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
    const config = getSignalWireConfig();
    const isMock = !config.projectId || !config.token;

    // Resolve lead
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.phone) return res.status(400).json({ error: 'Lead has no phone number' });

    // Check lead access
    if (req.user.role === 'salesperson') {
      if (lead.assigned_user_id && lead.assigned_user_id !== req.user.userId) {
        return res.status(403).json({ error: 'This lead is not assigned to you' });
      }
    }

    // Resolve numbers
    let agentForwardNumber;
    let fromNumber;

    if (req.user.role === 'salesperson' && req.user.userId) {
      const nums = resolveSalespersonNumbers(req.user.userId);
      agentForwardNumber = nums.forwardNumber;
      fromNumber = nums.fromNumber;
      if (!agentForwardNumber) {
        return res.status(400).json({
          error: 'No forward number configured on your account. Ask your admin to set your forward number in your profile.',
        });
      }
      if (!fromNumber) {
        return res.status(400).json({
          error: 'No SignalWire phone number assigned to your account.',
        });
      }
    } else {
      // Admin: forward to transfer_phone_number setting
      agentForwardNumber =
        getSetting('transfer_phone_number') || process.env.TRANSFER_PHONE_NUMBER || null;
      const defPn = db.prepare('SELECT number FROM phone_numbers WHERE is_default=1 LIMIT 1').get();
      fromNumber = defPn?.number || config.phoneNumber;
      if (!agentForwardNumber) {
        return res.status(400).json({
          error: 'No transfer_phone_number configured in Settings. Set it under Settings → Transfer Phone Number.',
        });
      }
    }

    // Resolve script text
    let resolvedScript = scriptText || '';
    if (!resolvedScript && voiceScriptId) {
      const vs = db.prepare('SELECT script FROM voice_scripts WHERE id = ?').get(voiceScriptId);
      if (vs) resolvedScript = vs.script;
    }
    if (!resolvedScript) {
      const active = db.prepare('SELECT script FROM voice_scripts WHERE is_active=1 LIMIT 1').get();
      resolvedScript = active?.script || 'Hello, this is an important message for your business. Thank you for your time.';
    }
    resolvedScript = personalizeScript(resolvedScript, lead);

    // Create session
    const sessionId = uuidv4();
    const confName = `vd-${sessionId}`;
    const agentPhone = normalizePhone(agentForwardNumber);
    const leadPhone = normalizePhone(lead.phone);
    const salespersonId = req.user.role === 'salesperson' ? req.user.userId : null;
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);

    db.prepare(`
      INSERT INTO voice_drop_sessions
        (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, state, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?)
    `).run(sessionId, salespersonId, leadId, leadPhone, confName, fromNumber, agentPhone, resolvedScript, expiresAt);

    if (isMock) {
      updateSession(sessionId, { state: 'mock' });
      return res.json({
        sessionId,
        mock: true,
        state: 'mock',
        message: '[MOCK] Voice drop session created — SignalWire not configured. Session will progress automatically in mock mode.',
      });
    }

    // Call agent first
    const statusCallbackUrl = `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=agent`;
    const agentTwiml = agentConferenceTwiml(confName);

    const agentCall = await placeCall(config, {
      from: fromNumber,
      to: agentPhone,
      twiml: agentTwiml,
      statusCallback: statusCallbackUrl,
      statusCallbackEvent: 'initiated ringing answered completed',
    });

    updateSession(sessionId, { agent_call_sid: agentCall.sid });
    console.log(`[VoiceDrop] Session ${sessionId}: agent call to ${agentPhone}, SID=${agentCall.sid}`);

    // Pre-generate ElevenLabs audio in background (don't await — fire and forget)
    generateElevenLabsAudio(resolvedScript, baseUrl)
      .then(url => {
        if (url) updateSession(sessionId, { audio_url: url });
      })
      .catch(() => {});

    res.json({ sessionId, state: 'initiated', agentCallSid: agentCall.sid });
  } catch (err) {
    console.error('[VoiceDrop] start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/voice-drop/session/:id
 * Poll session state.
 */
router.get('/session/:id', authMiddleware, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });

  res.json({
    id: session.id,
    state: session.state,
    error: session.error_msg,
    leadId: session.lead_id,
    leadPhone: session.lead_phone,
    hasAudio: !!session.audio_url,
    createdAt: session.created_at,
  });
});

/**
 * POST /api/voice-drop/drop-message
 * Drop the voice message to the recipient leg.
 * Plays audio to recipient and immediately hangs up agent.
 */
router.post('/drop-message', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canAccessSession(session, req.user)) return res.status(403).json({ error: 'Forbidden' });

    if (session.state === 'mock') {
      // Mock mode: simulate drop
      updateSession(sessionId, { state: 'completed' });
      return res.json({ success: true, state: 'completed', mock: true });
    }

    if (session.state !== 'recipient_answered') {
      return res.status(409).json({
        error: `Cannot drop in state "${session.state}". Lead must be connected first.`,
      });
    }
    if (!session.recipient_call_sid) {
      return res.status(409).json({ error: 'Recipient call SID missing — internal error.' });
    }

    const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
    const config = getSignalWireConfig();

    // Use pre-generated audio or generate now
    let audioUrl = session.audio_url;
    if (!audioUrl && session.script_text) {
      console.log('[VoiceDrop] Generating audio on-demand...');
      audioUrl = await generateElevenLabsAudio(session.script_text, baseUrl);
      if (audioUrl) updateSession(sessionId, { audio_url: audioUrl });
    }

    updateSession(sessionId, { state: 'dropping' });

    // Build playback TwiML — use ElevenLabs audio if available, else SignalWire TTS
    const playbackDoneUrl = `${baseUrl}/api/voice-drop/webhook/playback-completed?sid=${encodeURIComponent(sessionId)}`;
    const playTwiml = audioUrl
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${xmlEscape(audioUrl)}</Play><Redirect method="POST">${xmlEscape(playbackDoneUrl)}</Redirect></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${xmlEscape(session.script_text || 'Thank you for your time. Goodbye.')}</Say><Redirect method="POST">${xmlEscape(playbackDoneUrl)}</Redirect></Response>`;

    // Redirect recipient call to play audio (kicks them out of conference)
    await updateCall(config, session.recipient_call_sid, { twiml: playTwiml });
    console.log(`[VoiceDrop] Session ${sessionId}: dropping message to recipient ${session.recipient_call_sid}`);

    // Hang up agent immediately
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

/**
 * POST /api/voice-drop/cancel
 * Cancel and hang up all active legs.
 */
router.post('/cleanup', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const result = db.prepare("DELETE FROM voice_drop_sessions WHERE expires_at < datetime('now') OR state IN ('completed','cancelled','failed') AND created_at < datetime('now', '-1 day')").run();
  res.json({ success: true, deleted: result.changes });
});

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

/**
 * POST /api/voice-drop/webhook/playback-completed
 * Redirect target after the recipient has heard the entire message.
 */
router.post('/webhook/playback-completed', (req, res) => {
  const sessionId = req.query.sid;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session && ['dropping', 'recipient_answered'].includes(session.state)) {
      updateSession(sessionId, { state: 'completed' });
    }
  }
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});

/**
 * POST /api/voice-drop/webhook/call-status
 * SignalWire status callback for agent and lead calls.
 * Query params: sid (sessionId), leg (agent | lead)
 *
 * IMPORTANT: Responds 204 immediately before async processing
 * so SignalWire doesn't retry on timeout.
 */
router.post('/webhook/call-status', async (req, res) => {
  // Acknowledge immediately
  res.status(204).send();

  const { sid: sessionId, leg } = req.query;
  const { CallStatus, CallSid } = req.body;

  if (!sessionId || !leg) {
    console.warn('[VoiceDrop webhook] Missing sid or leg query param');
    return;
  }

  // Validate the webhook came from our SignalWire account
  if (!validateWebhook(req)) {
    console.warn('[VoiceDrop webhook] Invalid AccountSid — ignoring');
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    console.warn('[VoiceDrop webhook] Session not found:', sessionId);
    return;
  }

  console.log(`[VoiceDrop webhook] sid=${sessionId} leg=${leg} status=${CallStatus} callSid=${CallSid}`);

  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
  const config = getSignalWireConfig();

  try {
    if (leg === 'agent') {
      if (CallStatus === 'in-progress') {
        // Agent answered — update state and call the lead
        updateSession(sessionId, { state: 'agent_answered', agent_call_sid: CallSid });

        const leadTwiml = leadConferenceTwiml(session.conference_name);
        const leadStatusUrl = `${baseUrl}/api/voice-drop/webhook/call-status?sid=${sessionId}&leg=lead`;

        try {
          const leadCall = await placeCall(config, {
            from: session.from_number,
            to: session.lead_phone,
            twiml: leadTwiml,
            statusCallback: leadStatusUrl,
            statusCallbackEvent: 'initiated ringing answered completed',
          });
          updateSession(sessionId, { recipient_call_sid: leadCall.sid });
          console.log(`[VoiceDrop] Session ${sessionId}: lead call to ${session.lead_phone}, SID=${leadCall.sid}`);
        } catch (err) {
          console.error(`[VoiceDrop] Session ${sessionId}: failed to call lead:`, err.message);
          updateSession(sessionId, { state: 'failed', error_msg: `Failed to call lead: ${err.message}` });
          // Hang up agent since we can't connect lead
          updateCall(config, CallSid, { status: 'completed' }).catch(() => {});
        }
      } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(CallStatus)) {
        updateSession(sessionId, {
          state: 'failed',
          error_msg: `Agent call ${CallStatus} — check your forward number`,
        });
      } else if (CallStatus === 'completed') {
        // Agent hung up on their own
        const current = getSession(sessionId);
        if (current && !['completed', 'failed', 'cancelled', 'dropping'].includes(current.state)) {
          updateSession(sessionId, {
            state: 'failed',
            error_msg: 'Agent disconnected before message was dropped',
          });
          // Hang up lead too if connected
          if (current.recipient_call_sid) {
            updateCall(config, current.recipient_call_sid, { status: 'completed' }).catch(() => {});
          }
        }
      }
    } else if (leg === 'lead') {
      if (CallStatus === 'in-progress') {
        // Lead answered — UI can now show "Drop Voice Message"
        updateSession(sessionId, { state: 'recipient_answered', recipient_call_sid: CallSid });
        console.log(`[VoiceDrop] Session ${sessionId}: lead answered! Ready to drop.`);
      } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(CallStatus)) {
        updateSession(sessionId, {
          state: 'failed',
          error_msg: `Lead call ${CallStatus}`,
        });
        // Hang up agent
        const current = getSession(sessionId);
        if (current?.agent_call_sid) {
          updateCall(config, current.agent_call_sid, { status: 'completed' }).catch(() => {});
        }
      } else if (CallStatus === 'completed') {
        const current = getSession(sessionId);
        if (!current) return;
        if (current.state === 'dropping') {
          // Playback finished + lead hung up — success!
          updateSession(sessionId, { state: 'completed' });
        } else if (!['completed', 'failed', 'cancelled'].includes(current.state)) {
          updateSession(sessionId, {
            state: 'failed',
            error_msg: 'Lead disconnected unexpectedly',
          });
          if (current.agent_call_sid) {
            updateCall(config, current.agent_call_sid, { status: 'completed' }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error('[VoiceDrop webhook] Processing error:', err.message);
  }
});

module.exports = router;
