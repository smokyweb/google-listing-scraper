const router = require('express').Router();
const { google } = require('googleapis');
const db = require('../db');
const { authMiddleware, getSecret } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || db.prepare("SELECT value FROM settings WHERE key='google_calendar_client_id'").get()?.value;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || db.prepare("SELECT value FROM settings WHERE key='google_calendar_client_secret'").get()?.value;
  const baseUrl = process.env.BASE_URL || 'https://leads.bluesapps.com';
  return new google.auth.OAuth2(clientId, clientSecret, `${baseUrl}/api/salesperson-calendar/callback`);
}

function getUserFromToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  try {
    return jwt.verify(header.split(' ')[1], getSecret());
  } catch { return null; }
}

// GET /api/salesperson-calendar/auth-url?userId=X
// Returns the Google OAuth URL for a salesperson to connect their calendar
router.get('/auth-url', authMiddleware, (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/userinfo.email'],
    state: String(userId),
  });
  res.json({ url });
});

// GET /api/salesperson-calendar/callback — OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).send('Missing code or state');

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get the user's email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    // Save tokens to sales_users
    db.prepare('UPDATE sales_users SET gcal_access_token=?, gcal_refresh_token=?, gcal_token_expiry=?, gcal_email=? WHERE id=?')
      .run(tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null, email, parseInt(userId));

    // Close the popup and notify the parent window
    res.send(`<!DOCTYPE html><html><body><script>
      window.opener && window.opener.postMessage({ type: 'gcal_connected', email: '${email}' }, '*');
      window.close();
    </script><p>Calendar connected as ${email}. You can close this window.</p></body></html>`);
  } catch (err) {
    console.error('Calendar OAuth error:', err.message);
    res.status(500).send('OAuth failed: ' + err.message);
  }
});

// GET /api/salesperson-calendar/status?userId=X
router.get('/status', authMiddleware, (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const user = db.prepare('SELECT gcal_email, gcal_token_expiry FROM sales_users WHERE id=?').get(parseInt(userId));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ connected: !!user.gcal_email, email: user.gcal_email || null });
});

// POST /api/salesperson-calendar/disconnect?userId=X
router.post('/disconnect', authMiddleware, (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  db.prepare('UPDATE sales_users SET gcal_access_token=NULL, gcal_refresh_token=NULL, gcal_token_expiry=NULL, gcal_email=NULL WHERE id=?').run(parseInt(userId));
  res.json({ success: true });
});

module.exports = router;
