require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve built frontend
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

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

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
