const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS scrapes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    lead_count INTEGER DEFAULT 0,
    mock INTEGER DEFAULT 0,
    next_page_token TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_id INTEGER REFERENCES scrapes(id) ON DELETE SET NULL,
    name TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    keyword TEXT,
    email_scraped INTEGER DEFAULT 0,
    scraped_at TEXT DEFAULT (datetime('now')),
    email_status TEXT DEFAULT 'pending',
    email_sent_at TEXT,
    call_status TEXT DEFAULT 'pending',
    called_at TEXT,
    sms_status TEXT DEFAULT 'pending',
    sms_sent_at TEXT
  );

  -- Add scrape_id column to existing leads table if it doesn't exist (migration)
  -- SQLite doesn't support IF NOT EXISTS for columns, handled in JS below

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    template TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    sent_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS phone_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    number TEXT NOT NULL UNIQUE,
    provider TEXT DEFAULT 'signalwire',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS callbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    lead_name TEXT,
    phone TEXT,
    raw_speech TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sms_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    from_number TEXT NOT NULL,
    to_number TEXT,
    message TEXT,
    direction TEXT DEFAULT 'inbound',
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ivr_sessions (
    call_sid TEXT PRIMARY KEY,
    lead_id INTEGER,
    lead_phone TEXT,
    step TEXT DEFAULT 'menu',
    data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS voice_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    script TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sms_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    states TEXT DEFAULT '[]',
    cities TEXT DEFAULT '[]',
    phone_number_id INTEGER REFERENCES phone_numbers(id),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_opens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    campaign_id INTEGER,
    opened_at TEXT DEFAULT (datetime('now')),
    ip TEXT
  );

  CREATE TABLE IF NOT EXISTS email_senders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    lead_name TEXT,
    lead_phone TEXT,
    scrape_id INTEGER,
    call_sid TEXT,
    outcome TEXT DEFAULT 'initiated',
    button_pressed TEXT,
    duration_seconds INTEGER DEFAULT 0,
    called_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sms_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    message_sid TEXT,
    status TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrations — add columns to existing tables if they don't exist
try { db.exec('ALTER TABLE leads ADD COLUMN scrape_id INTEGER REFERENCES scrapes(id)'); } catch(e) {}
try { db.exec('ALTER TABLE leads ADD COLUMN email_scraped INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec("ALTER TABLE leads ADD COLUMN unsubscribed INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE leads ADD COLUMN notes TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE scrapes ADD COLUMN next_page_token TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE scrapes ADD COLUMN created_by_user_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE scrapes ADD COLUMN created_by_name TEXT DEFAULT 'Admin'"); } catch(e) {}
try { db.exec("ALTER TABLE sales_users ADD COLUMN gcal_access_token TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE sales_users ADD COLUMN gcal_refresh_token TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE sales_users ADD COLUMN gcal_token_expiry INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE sales_users ADD COLUMN gcal_email TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE leads ADD COLUMN source TEXT DEFAULT 'scraped'"); } catch(e) {}
try { db.exec("ALTER TABLE leads ADD COLUMN status TEXT DEFAULT 'new'"); } catch(e) {}
try { db.exec("ALTER TABLE leads ADD COLUMN assigned_user_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE leads ADD COLUMN email_opens INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE campaigns ADD COLUMN tracking_id TEXT"); } catch(e) {}

// Seed Google Calendar OAuth from env vars if not already in DB
const gcalKeys = [
  ['google_calendar_client_id', process.env.GOOGLE_CALENDAR_CLIENT_ID],
  ['google_calendar_client_secret', process.env.GOOGLE_CALENDAR_CLIENT_SECRET],
  ['google_calendar_refresh_token', process.env.GOOGLE_CALENDAR_REFRESH_TOKEN],
  ['gemini_api_key', process.env.GEMINI_API_KEY],
  ['elevenlabs_api_key', process.env.ELEVENLABS_API_KEY],
  ['elevenlabs_voice_id', process.env.ELEVENLABS_VOICE_ID],
  ['signalwire_project_id', process.env.SIGNALWIRE_PROJECT_ID],
  ['signalwire_token', process.env.SIGNALWIRE_TOKEN],
  ['signalwire_space_url', process.env.SIGNALWIRE_SPACE_URL],
  ['signalwire_phone_number', process.env.SIGNALWIRE_PHONE_NUMBER],
  ['transfer_phone_number', process.env.TRANSFER_PHONE_NUMBER],
  ['google_places_api_key', process.env.GOOGLE_PLACES_API_KEY],
];
const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, val] of gcalKeys) {
  if (val) upsertSetting.run(key, val);
}

// Seed default phone number from env if none exist
const existingNumbers = db.prepare('SELECT COUNT(*) as count FROM phone_numbers').get();
if (existingNumbers.count === 0 && process.env.SIGNALWIRE_PHONE_NUMBER) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO phone_numbers (label, number, provider, is_default) VALUES (?, ?, ?, ?)'
    ).run('SignalWire (default)', process.env.SIGNALWIRE_PHONE_NUMBER, 'signalwire', 1);
  } catch (e) {
    // ignore seed errors
  }
}

module.exports = db;

