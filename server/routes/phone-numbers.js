const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/phone-numbers/my — returns the current user's assigned phone number
router.get('/my', authMiddleware, (req, res) => {
  if (req.user?.role === 'salesperson' && req.user?.userId) {
    const user = db.prepare('SELECT * FROM sales_users WHERE id = ?').get(req.user.userId);
    if (user?.phone_number_id) {
      const num = db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(user.phone_number_id);
      return res.json(num || null);
    }
  }
  // Admin or no assigned number: return SignalWire default
  const def = db.prepare("SELECT * FROM phone_numbers WHERE is_default = 1 AND provider = 'signalwire' LIMIT 1").get();
  res.json(def || null);
});

// GET all phone numbers (only SignalWire numbers)
router.get('/', authMiddleware, (req, res) => {
  const numbers = db.prepare("SELECT * FROM phone_numbers WHERE provider = 'signalwire' ORDER BY is_default DESC, created_at ASC").all();
  res.json(numbers);
});

// POST add a new phone number
router.post('/', authMiddleware, (req, res) => {
  const { label, number, provider = 'signalwire', is_default = 0 } = req.body;
  if (!label || !number) return res.status(400).json({ error: 'label and number are required' });

  // Format number: ensure it starts with +1 for US
  let formatted = number.replace(/\D/g, '');
  if (formatted.length === 10) formatted = '1' + formatted;
  if (!formatted.startsWith('+')) formatted = '+' + formatted;

  try {
    // If setting as default, clear other defaults first
    if (is_default) {
      db.prepare('UPDATE phone_numbers SET is_default = 0').run();
    }

    const result = db.prepare(
      'INSERT INTO phone_numbers (label, number, provider, is_default) VALUES (?, ?, ?, ?)'
    ).run(label, formatted, provider, is_default ? 1 : 0);

    res.json({ id: result.lastInsertRowid, label, number: formatted, provider, is_default });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'This phone number is already added' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH update a phone number
router.patch('/:id', authMiddleware, (req, res) => {
  const { label, number, provider, is_default } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  let formatted = number || existing.number;
  if (number) {
    formatted = number.replace(/\D/g, '');
    if (formatted.length === 10) formatted = '1' + formatted;
    if (!formatted.startsWith('+')) formatted = '+' + formatted;
  }

  if (is_default) {
    db.prepare('UPDATE phone_numbers SET is_default = 0').run();
  }

  db.prepare(
    'UPDATE phone_numbers SET label = ?, number = ?, provider = ?, is_default = ? WHERE id = ?'
  ).run(
    label ?? existing.label,
    formatted,
    provider ?? existing.provider,
    is_default !== undefined ? (is_default ? 1 : 0) : existing.is_default,
    id
  );

  res.json({ success: true });
});

// DELETE a phone number
router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM phone_numbers WHERE id = ?').run(id);
  res.json({ success: true });
});

// SET default phone number
router.post('/:id/set-default', authMiddleware, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE phone_numbers SET is_default = 0').run();
  db.prepare('UPDATE phone_numbers SET is_default = 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

// GET /api/phone-numbers/sync — pull all numbers from SignalWire, add new ones, remove deleted ones
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const projectId = process.env.SIGNALWIRE_PROJECT_ID || db.prepare("SELECT value FROM settings WHERE key='signalwire_project_id'").get()?.value;
    const token = process.env.SIGNALWIRE_TOKEN || db.prepare("SELECT value FROM settings WHERE key='signalwire_token'").get()?.value;
    const spaceUrl = process.env.SIGNALWIRE_SPACE_URL || db.prepare("SELECT value FROM settings WHERE key='signalwire_space_url'").get()?.value;
    if (!projectId || !token || !spaceUrl) return res.status(400).json({ error: 'SignalWire credentials not configured' });

    const authHeader = 'Basic ' + Buffer.from(`${projectId}:${token}`).toString('base64');
    const resp = await fetch(`https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/IncomingPhoneNumbers.json?PageSize=100`, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`SignalWire API error: ${resp.status}`);
    const data = await resp.json();
    const swNumbers = data.incoming_phone_numbers || [];
    const swNumberSet = new Set(swNumbers.map(n => n.phone_number));

    // Add new numbers from SignalWire
    let added = 0, skipped = 0, removed = 0;
    const upsert = db.prepare('INSERT OR IGNORE INTO phone_numbers (label, number, provider) VALUES (?, ?, ?)');
    for (const num of swNumbers) {
      const e164 = num.phone_number;
      const label = num.friendly_name || e164;
      const r = upsert.run(label, e164, 'signalwire');
      if (r.changes > 0) added++; else skipped++;
    }

    // Remove numbers that are no longer in SignalWire (provider = signalwire only)
    const localSwNumbers = db.prepare("SELECT id, number FROM phone_numbers WHERE provider = 'signalwire'").all();
    for (const local of localSwNumbers) {
      if (!swNumberSet.has(local.number)) {
        // Clear any user assignments before deleting
        db.prepare('UPDATE sales_users SET phone_number_id = NULL WHERE phone_number_id = ?').run(local.id);
        db.prepare('DELETE FROM phone_numbers WHERE id = ?').run(local.id);
        removed++;
      }
    }

    res.json({ synced: swNumbers.length, added, skipped, removed });
  } catch (err) {
    console.error('SignalWire sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
