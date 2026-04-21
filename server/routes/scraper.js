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

async function scrapeGooglePlaces(keyword, city, state, apiKey, maxResults = 20, pageToken = null) {
  let allPlaces = [];
  let nextPageToken = pageToken;
  const pages = Math.ceil(maxResults / 20);

  for (let page = 0; page < pages; page++) {
    const query = `${keyword} in ${city}, ${state}`;
    // Use pagetoken if we have one (either passed in or from previous page)
    let url = nextPageToken
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(nextPageToken)}&key=${apiKey}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status === 'INVALID_REQUEST') {
      if (page === 0) throw new Error(`Google Places API error: ${data.status} - ${data.error_message || ''}`);
      break; // page token expired or invalid, stop gracefully
    }
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      if (page === 0) throw new Error(`Google Places API error: ${data.status} - ${data.error_message || ''}`);
      break;
    }

    allPlaces.push(...(data.results || []));
    nextPageToken = data.next_page_token || null;
    if (!nextPageToken || allPlaces.length >= maxResults) break;
    // Google requires a 2-second delay before using next_page_token
    await new Promise(r => setTimeout(r, 2000));
  }

  // Store the last next_page_token for "Scrape More" functionality
  scrapeGooglePlaces._lastPageToken = nextPageToken;

  const leads = [];
  for (const place of allPlaces.slice(0, maxResults)) {
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
    const { keyword, city, state, maxResults = 20 } = req.body;
    if (!keyword || !city || !state) {
      return res.status(400).json({ error: 'keyword, city, and state are required' });
    }

    const apiKey = getApiKey();
    const isMock = !apiKey;
    const limit = Math.min(Math.max(parseInt(maxResults) || 20, 20), 60); // cap at 60 (3 pages)
    let results = isMock
      ? getMockResults(keyword, city, state)
      : await scrapeGooglePlaces(keyword, city, state, apiKey, limit);

    // Scrape websites for email addresses
    const withEmails = await Promise.all(results.map(async (lead) => {
      if (lead.website) {
        const emails = await scrapeWebsiteForEmail(lead.website);
        return { ...lead, email: emails[0] || '', email_scraped: 1 };
      }
      return { ...lead, email_scraped: 0 };
    }));

    // Save next_page_token if available for "Scrape More"
    const nextPageToken = scrapeGooglePlaces._lastPageToken || null;

    // Create scrape record
    const scrapeName = `${keyword} - ${city}, ${state}`;
    const scrapeRecord = db.prepare(
      'INSERT INTO scrapes (name, keyword, city, state, lead_count, mock, next_page_token) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(scrapeName, keyword, city, state, withEmails.length, isMock ? 1 : 0, nextPageToken);
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
      has_more: !!nextPageToken,
    });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scrape/more/:scrapeId — fetch next page of results for an existing scrape
router.post('/more/:scrapeId', authMiddleware, async (req, res) => {
  try {
    const scrape = db.prepare('SELECT * FROM scrapes WHERE id=?').get(req.params.scrapeId);
    if (!scrape) return res.status(404).json({ error: 'Scrape not found' });
    if (!scrape.next_page_token) return res.status(400).json({ error: 'No more results available for this scrape. Google only provides up to 3 pages per query.' });

    const apiKey = getApiKey();
    if (!apiKey) return res.status(400).json({ error: 'Google Places API key not configured' });

    let results;
    try {
      results = await scrapeGooglePlaces(scrape.keyword, scrape.city, scrape.state, apiKey, 20, scrape.next_page_token);
    } catch(err) {
      // Clear expired token from DB
      db.prepare('UPDATE scrapes SET next_page_token = NULL WHERE id = ?').run(req.params.scrapeId);
      if (err.message.includes('INVALID_REQUEST')) {
        return res.status(400).json({ error: 'Page token has expired (Google tokens last ~2 minutes). Run a new scrape to get more results.' });
      }
      throw err;
    }
    const nextPageToken = scrapeGooglePlaces._lastPageToken || null;

    const withEmails = await Promise.all(results.map(async (lead) => {
      if (lead.website) {
        const emails = await scrapeWebsiteForEmail(lead.website);
        return { ...lead, email: emails[0] || '', email_scraped: 1 };
      }
      return { ...lead, email_scraped: 0 };
    }));

    const insert = db.prepare(`INSERT INTO leads (scrape_id, name, phone, email, website, address, city, state, keyword, email_scraped) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertMany = db.transaction((leads) => {
      const inserted = [];
      for (const lead of leads) {
        const info = insert.run(scrape.id, lead.name, lead.phone, lead.email, lead.website, lead.address, scrape.city, scrape.state, scrape.keyword, lead.email_scraped ? 1 : 0);
        inserted.push({ id: info.lastInsertRowid, scrape_id: scrape.id, ...lead });
      }
      return inserted;
    });
    const inserted = insertMany(withEmails);

    // Update scrape record
    db.prepare('UPDATE scrapes SET lead_count = lead_count + ?, next_page_token = ? WHERE id = ?').run(inserted.length, nextPageToken, scrape.id);

    res.json({ count: inserted.length, leads: inserted, emails_found: inserted.filter(l => l.email).length, has_more: !!nextPageToken });
  } catch (err) {
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
