const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || getSetting('google_places_api_key');
}

// Extract emails from HTML text
function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const found = text.match(emailRegex) || [];
  // Filter out common false positives
  return [...new Set(found.filter(e =>
    !e.includes('example.com') &&
    !e.includes('sentry') &&
    !e.includes('wixpress') &&
    !e.endsWith('.png') &&
    !e.endsWith('.jpg') &&
    !e.endsWith('.gif') &&
    e.length < 80
  ))];
}

// Scrape a website URL for email addresses
async function scrapeWebsiteForEmail(url, timeoutMs = 8000) {
  if (!url) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const html = await resp.text();
    const emails = extractEmails(html);

    // If no email on main page, try /contact page
    if (emails.length === 0) {
      try {
        const base = new URL(url);
        const contactUrl = `${base.origin}/contact`;
        const c = new AbortController();
        const ct = setTimeout(() => c.abort(), 5000);
        const cr = await fetch(contactUrl, {
          signal: c.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
          redirect: 'follow',
        });
        clearTimeout(ct);
        if (cr.ok) {
          const ch = await cr.text();
          return extractEmails(ch);
        }
      } catch {}
    }
    return emails;
  } catch {
    return [];
  }
}

function getMockResults(keyword, city, state) {
  return [
    { name: `${keyword} Pro Services`, phone: '(555) 123-4567', email: '', website: `https://${keyword.toLowerCase().replace(/\s/g, '')}pro.com`, address: `123 Main St, ${city}, ${state}` },
    { name: `${city} ${keyword} Experts`, phone: '(555) 234-5678', email: '', website: `https://${city.toLowerCase()}experts.com`, address: `456 Oak Ave, ${city}, ${state}` },
    { name: `Elite ${keyword} ${city}`, phone: '(555) 345-6789', email: '', website: `https://elite${keyword.toLowerCase().replace(/\s/g, '')}.com`, address: `789 Pine Rd, ${city}, ${state}` },
    { name: `${keyword} Masters LLC`, phone: '(555) 456-7890', email: '', website: `https://${keyword.toLowerCase().replace(/\s/g, '')}masters.com`, address: `321 Elm Blvd, ${city}, ${state}` },
    { name: `Premier ${keyword} Co`, phone: '(555) 567-8901', email: '', website: `https://premier${keyword.toLowerCase().replace(/\s/g, '')}.com`, address: `654 Maple Dr, ${city}, ${state}` },
  ];
}

async function scrapeGooglePlaces(keyword, city, state, apiKey) {
  const query = `${keyword} in ${city}, ${state}`;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (data.status !== 'OK') {
    throw new Error(`Google Places API error: ${data.status} - ${data.error_message || ''}`);
  }

  const leads = [];
  for (const place of data.results || []) {
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,formatted_address&key=${apiKey}`;
    const detailResp = await fetch(detailUrl);
    const detail = await detailResp.json();
    const r = detail.result || {};

    leads.push({
      name: r.name || place.name,
      phone: r.formatted_phone_number || '',
      email: '',
      website: r.website || '',
      address: r.formatted_address || place.formatted_address || '',
    });
  }
  return leads;
}

// POST /api/scrape — run a new scrape
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { keyword, city, state } = req.body;
    if (!keyword || !city || !state) {
      return res.status(400).json({ error: 'keyword, city, and state are required' });
    }

    const apiKey = getApiKey();
    const isMock = !apiKey;
    let results = isMock
      ? getMockResults(keyword, city, state)
      : await scrapeGooglePlaces(keyword, city, state, apiKey);

    // Scrape websites for email addresses
    const withEmails = await Promise.all(results.map(async (lead) => {
      if (lead.website) {
        const emails = await scrapeWebsiteForEmail(lead.website);
        return { ...lead, email: emails[0] || '', email_scraped: 1 };
      }
      return { ...lead, email_scraped: 0 };
    }));

    // Create scrape record
    const scrapeName = `${keyword} - ${city}, ${state}`;
    const scrapeRecord = db.prepare(
      'INSERT INTO scrapes (name, keyword, city, state, lead_count, mock) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(scrapeName, keyword, city, state, withEmails.length, isMock ? 1 : 0);
    const scrapeId = scrapeRecord.lastInsertRowid;

    // Insert leads with scrape_id
    const insert = db.prepare(`
      INSERT INTO leads (scrape_id, name, phone, email, website, address, city, state, keyword, email_scraped)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((leads) => {
      const inserted = [];
      for (const lead of leads) {
        const info = insert.run(
          scrapeId, lead.name, lead.phone, lead.email,
          lead.website, lead.address, city, state, keyword,
          lead.email_scraped ? 1 : 0
        );
        inserted.push({ id: info.lastInsertRowid, scrape_id: scrapeId, ...lead, city, state, keyword });
      }
      return inserted;
    });

    const inserted = insertMany(withEmails);

    res.json({
      scrape_id: scrapeId,
      scrape_name: scrapeName,
      count: inserted.length,
      leads: inserted,
      mock: isMock,
      emails_found: inserted.filter(l => l.email).length,
    });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/refresh-emails/:scrapeId — re-scrape websites for emails for a specific scrape
router.post('/refresh-emails/:scrapeId', authMiddleware, async (req, res) => {
  try {
    const { scrapeId } = req.params;
    const leads = db.prepare('SELECT * FROM leads WHERE scrape_id = ? AND website != ""').all(scrapeId);

    let updated = 0;
    for (const lead of leads) {
      const emails = await scrapeWebsiteForEmail(lead.website);
      if (emails.length > 0) {
        db.prepare('UPDATE leads SET email = ?, email_scraped = 1 WHERE id = ?').run(emails[0], lead.id);
        updated++;
      }
    }
    res.json({ updated, total: leads.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
