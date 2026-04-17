require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false })); // Required for SignalWire/Twilio webhook form-encoded bodies

// Serve built frontend
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
// Serve generated audio files for outbound calls (ElevenLabs TTS)
app.use('/audio', express.static(path.join(__dirname, '..', 'data', 'audio')));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/scrape', require('./routes/scraper'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/email', require('./routes/email'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/phone-numbers', require('./routes/phone-numbers'));
app.use('/api/scrapes', require('./routes/scrapes'));
app.use('/api/voice-scripts', require('./routes/voice-scripts'));
app.use('/api/callbacks', require('./routes/callbacks'));
app.use('/api/email-templates', require('./routes/email-templates'));
app.use('/api/sms-templates', require('./routes/sms-templates'));
app.use('/api/sales-users', require('./routes/sales-users'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/dialer', require('./routes/dialer'));
app.use('/api/email-senders', require('./routes/email-senders'));
// SignalWire webhooks (no auth) — must be before authMiddleware
app.post('/api/calls/ivr-handler', require('./routes/calls').ivr || ((req, res, next) => next()));
app.post('/api/calls/ivr-callback', require('./routes/calls').ivrCallback || ((req, res, next) => next()));
app.post('/api/sms/incoming', require('./routes/sms').incoming || ((req, res, next) => next()));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
