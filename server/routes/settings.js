const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const SETTING_KEYS = [
  'gemini_api_key',
  'google_places_api_key',
  'signalwire_project_id',
  'signalwire_token',
  'signalwire_space_url',
  'signalwire_phone_number',
  'transfer_phone_number',
  'elevenlabs_api_key',
  'elevenlabs_voice_id',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'google_calendar_client_id',
  'google_calendar_client_secret',
  'admin_password',
];

router.get('/', authMiddleware, (req, res) => {
  const settings = {};
  for (const key of SETTING_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    // Mask sensitive values
    if (row?.value && ['signalwire_token', 'elevenlabs_api_key', 'smtp_pass', 'google_calendar_client_secret', 'admin_password'].includes(key)) {
      settings[key] = row.value.length > 4 ? '****' + row.value.slice(-4) : '****';
    } else {
      settings[key] = row?.value || '';
    }
  }
  res.json(settings);
});

router.post('/', authMiddleware, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((entries) => {
    for (const [key, value] of entries) {
      if (SETTING_KEYS.includes(key) && value !== undefined) {
        // Skip masked values (don't overwrite with ****)
        if (typeof value === 'string' && value.startsWith('****')) continue;
        upsert.run(key, value);
      }
    }
  });

  updateMany(Object.entries(req.body));
  res.json({ success: true });
});

module.exports = router;
