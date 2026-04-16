const router = require('express').Router();
const { google } = require('googleapis');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || getSetting('google_calendar_client_id');
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || getSetting('google_calendar_client_secret');

  if (!clientId || !clientSecret) return null;

  const redirectUri = `http://localhost:${process.env.PORT || 3001}/api/calendar/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Get OAuth URL
router.get('/auth', authMiddleware, (req, res) => {
  const client = getOAuthClient();
  if (!client) {
    return res.json({ mock: true, message: 'Google Calendar OAuth not configured. Set client ID and secret in settings.' });
  }

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  res.json({ url });
});

// OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const client = getOAuthClient();
    if (!client || !code) {
      return res.redirect('/?calendarError=not_configured');
    }

    const { tokens } = await client.getToken(code);

    // Store tokens in settings
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    upsert.run('google_calendar_tokens', JSON.stringify(tokens));

    res.redirect('/?calendarConnected=true');
  } catch (err) {
    console.error('Calendar callback error:', err);
    res.redirect('/?calendarError=' + encodeURIComponent(err.message));
  }
});

// Get upcoming events
router.get('/events', authMiddleware, async (req, res) => {
  try {
    const client = getOAuthClient();
    const tokensRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('google_calendar_tokens');

    if (!client || !tokensRow) {
      // Return mock events
      const now = new Date();
      const mockEvents = [
        { id: '1', summary: 'Call with Plumber Pro Services', start: new Date(now.getTime() + 3600000).toISOString(), end: new Date(now.getTime() + 5400000).toISOString() },
        { id: '2', summary: 'Meeting with Elite Roofing', start: new Date(now.getTime() + 86400000).toISOString(), end: new Date(now.getTime() + 90000000).toISOString() },
        { id: '3', summary: 'Follow-up: HVAC Masters LLC', start: new Date(now.getTime() + 172800000).toISOString(), end: new Date(now.getTime() + 176400000).toISOString() },
      ];
      return res.json({ events: mockEvents, mock: true });
    }

    const tokens = JSON.parse(tokensRow.value);
    client.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map(e => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location,
    }));

    res.json({ events, mock: false });
  } catch (err) {
    console.error('Calendar events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Disconnect
router.post('/disconnect', authMiddleware, (req, res) => {
  db.prepare("DELETE FROM settings WHERE key = 'google_calendar_tokens'").run();
  res.json({ success: true });
});

module.exports = router;
