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

function getElevenLabsConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY || getSetting('elevenlabs_api_key'),
    voiceId: process.env.ELEVENLABS_VOICE_ID || getSetting('elevenlabs_voice_id') || '21m00Tcm4TlvDq8ikWAM',
  };
}

// Generate TTS audio via ElevenLabs (or return mock)
async function generateTTS(text, config) {
  if (!config.apiKey) {
    console.log(`[MOCK TTS] Text: ${text.substring(0, 100)}...`);
    return { mock: true, audioUrl: null };
  }

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.5 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`ElevenLabs API error: ${resp.status}`);
  }

  // In production, you'd save this audio and host it for SignalWire
  const audioBuffer = await resp.arrayBuffer();
  return { mock: false, audioSize: audioBuffer.byteLength };
}

// TTS Preview endpoint
router.post('/tts-preview', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const config = getElevenLabsConfig();
    if (!config.apiKey) {
      return res.json({ mock: true, message: 'ElevenLabs API key not configured. TTS preview is mocked.' });
    }

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.5 },
      }),
    });

    if (!resp.ok) throw new Error(`ElevenLabs error: ${resp.status}`);

    res.setHeader('Content-Type', 'audio/mpeg');
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to resolve which phone number to use
function resolvePhoneNumber(phoneNumberId, fallback) {
  if (phoneNumberId) {
    const row = db.prepare('SELECT number FROM phone_numbers WHERE id = ?').get(phoneNumberId);
    if (row) return row.number;
  }
  // Try default phone number from DB
  const defaultRow = db.prepare('SELECT number FROM phone_numbers WHERE is_default = 1 LIMIT 1').get();
  if (defaultRow) return defaultRow.number;
  return fallback;
}

// Trigger outbound calls
router.post('/trigger', authMiddleware, async (req, res) => {
  try {
    const { script, leadIds, phoneNumberId } = req.body;
    if (!script) return res.status(400).json({ error: 'script is required' });

    const swConfig = getSignalWireConfig();
    const transferNumber = process.env.TRANSFER_PHONE_NUMBER || getSetting('transfer_phone_number') || '+15551234567';
    const isMock = !swConfig.projectId || !swConfig.token;

    let leads;
    if (leadIds && leadIds.length > 0) {
      const placeholders = leadIds.map(() => '?').join(',');
      leads = db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders}) AND phone != '' AND phone IS NOT NULL`).all(...leadIds);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE phone != '' AND phone IS NOT NULL").all();
    }

    if (leads.length === 0) {
      return res.json({ called: 0, message: 'No leads with phone numbers found' });
    }

    const campaign = db.prepare('INSERT INTO campaigns (type, template, sent_count) VALUES (?, ?, ?)').run('call', script, leads.length);
    const updateLead = db.prepare("UPDATE leads SET call_status = 'called', called_at = datetime('now') WHERE id = ?");

    let calledCount = 0;

    for (const lead of leads) {
      const personalizedScript = script
        .replace(/{business_name}/g, lead.name || '')
        .replace(/{city}/g, lead.city || '')
        .replace(/{state}/g, lead.state || '');

      if (isMock) {
        console.log(`[MOCK CALL] To: ${lead.phone}, Script: ${personalizedScript.substring(0, 80)}...`);
        updateLead.run(lead.id);
        calledCount++;
      } else {
        try {
          // SignalWire REST API call with TwiML for IVR
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${personalizedScript}</Say>
  <Gather numDigits="1" action="/api/calls/ivr-handler" method="POST">
    <Say>Press 1 to speak with a representative. Press 2 to receive a text with our scheduling link.</Say>
  </Gather>
  <Say>We didn't receive any input. Goodbye.</Say>
</Response>`;

          const authHeader = Buffer.from(`${swConfig.projectId}:${swConfig.token}`).toString('base64');
          const fromNumber = resolvePhoneNumber(phoneNumberId, swConfig.phoneNumber);
          const callResp = await fetch(`https://${swConfig.spaceUrl}/api/laml/2010-04-01/Accounts/${swConfig.projectId}/Calls.json`, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${authHeader}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: lead.phone,
              Twiml: twiml,
            }),
          });

          if (callResp.ok) {
            updateLead.run(lead.id);
            calledCount++;
          }
        } catch (err) {
          console.error(`Call error for ${lead.phone}:`, err.message);
        }
      }
    }

    res.json({ called: calledCount, total: leads.length, mock: isMock });
  } catch (err) {
    console.error('Call trigger error:', err);
    res.status(500).json({ error: err.message });
  }
});

// IVR handler for SignalWire callback
router.post('/ivr-handler', (req, res) => {
  const digit = req.body.Digits;
  const transferNumber = process.env.TRANSFER_PHONE_NUMBER || '+15551234567';

  let twiml;
  if (digit === '1') {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you now. Please hold.</Say>
  <Dial>${transferNumber}</Dial>
</Response>`;
  } else if (digit === '2') {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We'll send you a text message with our scheduling link shortly. Thank you!</Say>
</Response>`;
    // TODO: trigger SMS with scheduling link here
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Invalid option. Goodbye.</Say>
</Response>`;
  }

  res.type('text/xml').send(twiml);
});

module.exports = router;
