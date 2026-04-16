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
`);

// Migrations — add columns to existing tables if they don't exist
try { db.exec('ALTER TABLE leads ADD COLUMN scrape_id INTEGER REFERENCES scrapes(id)'); } catch(e) {}
try { db.exec('ALTER TABLE leads ADD COLUMN email_scraped INTEGER DEFAULT 0'); } catch(e) {}

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

