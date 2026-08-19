/**
 * Tests for stats route — salesperson scoping and admin global view.
 *
 * These tests exercise the SQL logic by running it against an in-memory SQLite
 * database, keeping the tests fast and self-contained.
 *
 * Run with:  node server/routes/stats.test.js
 */

'use strict';

const Database = require('better-sqlite3');

// ─── Setup in-memory DB ───────────────────────────────────────────────────────

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE scrapes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    keyword TEXT,
    city TEXT,
    state TEXT,
    lead_count INTEGER DEFAULT 0,
    created_by_user_id INTEGER
  );

  CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_id INTEGER,
    assigned_user_id INTEGER,
    email_status TEXT DEFAULT 'pending',
    call_status  TEXT DEFAULT 'pending',
    sms_status   TEXT DEFAULT 'pending'
  );

  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT
  );
`);

// Seed data
//   user 1 = salesperson (Alice)
//   user 2 = salesperson (Bob)
// Scrapes
db.prepare('INSERT INTO scrapes (name,keyword,city,state,created_by_user_id) VALUES (?,?,?,?,?)').run('Scrape-A','plumber','NYC','NY',1); // id=1, created by Alice
db.prepare('INSERT INTO scrapes (name,keyword,city,state,created_by_user_id) VALUES (?,?,?,?,?)').run('Scrape-B','dentist','LA', 'CA',2); // id=2, created by Bob

// Leads
// Lead 1: assigned to Alice
db.prepare('INSERT INTO leads (scrape_id,assigned_user_id,email_status,call_status,sms_status) VALUES (?,?,?,?,?)').run(null,1,'sent','called','sent');
// Lead 2: from Alice's scrape (not explicitly assigned to anyone)
db.prepare('INSERT INTO leads (scrape_id,assigned_user_id,email_status,call_status,sms_status) VALUES (?,?,?,?,?)').run(1,null,'pending','pending','pending');
// Lead 3: assigned to Alice AND from her scrape (potential double-count risk!)
db.prepare('INSERT INTO leads (scrape_id,assigned_user_id,email_status,call_status,sms_status) VALUES (?,?,?,?,?)').run(1,1,'sent','pending','pending');
// Lead 4: assigned to Bob
db.prepare('INSERT INTO leads (scrape_id,assigned_user_id,email_status,call_status,sms_status) VALUES (?,?,?,?,?)').run(2,2,'sent','called','sent');
// Lead 5: from Bob's scrape, not assigned
db.prepare('INSERT INTO leads (scrape_id,assigned_user_id,email_status,call_status,sms_status) VALUES (?,?,?,?,?)').run(2,null,'pending','called','pending');
// Lead 6: global — no scrape, no assignment
db.prepare('INSERT INTO leads (scrape_id,assigned_user_id,email_status,call_status,sms_status) VALUES (?,?,?,?,?)').run(null,null,'pending','pending','pending');

db.prepare('INSERT INTO campaigns (type) VALUES (?)').run('meeting');
db.prepare('INSERT INTO campaigns (type) VALUES (?)').run('meeting');
db.prepare('INSERT INTO campaigns (type) VALUES (?)').run('email');

// ─── Helpers (mirrors stats.js logic) ────────────────────────────────────────

function getStats(role, userId) {
  let baseWhere = '';
  const baseParams = [];
  if (role === 'salesperson' && userId) {
    baseWhere = `WHERE (assigned_user_id = ? OR scrape_id IN (
      SELECT id FROM scrapes WHERE created_by_user_id = ?
    ))`;
    baseParams.push(userId, userId);
  }
  const and = baseWhere ? 'AND' : 'WHERE';

  const totalLeads  = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere}`).get(...baseParams).count;
  const emailsSent  = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere} ${and} email_status = 'sent'`).get(...baseParams).count;
  const callsMade   = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere} ${and} call_status = 'called'`).get(...baseParams).count;
  const smsSent     = db.prepare(`SELECT COUNT(*) as count FROM leads ${baseWhere} ${and} sms_status = 'sent'`).get(...baseParams).count;
  const meetingsBooked = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE type = 'meeting'").get().count;

  return { totalLeads, emailsSent, callsMade, smsSent, meetingsBooked };
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label} — expected ${expected}, got ${actual}`);
    failed++;
  }
}

// ── Admin sees everything ─────────────────────────────────────────────────────

console.log('\n=== Admin (global) stats ===');
const adminStats = getStats('admin', null);
assert('admin totalLeads = 6',        adminStats.totalLeads,    6);
assert('admin emailsSent = 3',        adminStats.emailsSent,    3); // leads 1,3,4
assert('admin callsMade = 3',         adminStats.callsMade,     3); // leads 1,4,5
assert('admin smsSent = 2',           adminStats.smsSent,       2); // leads 1,4
assert('admin meetingsBooked = 2',    adminStats.meetingsBooked, 2);

// ── Alice (user 1) scoped stats ───────────────────────────────────────────────

console.log('\n=== Salesperson Alice (userId=1) stats ===');
const aliceStats = getStats('salesperson', 1);
// Alice's leads: id=1 (assigned), id=2 (scrape-A), id=3 (assigned + scrape-A)
assert('alice totalLeads = 3 (no double-count)', aliceStats.totalLeads, 3);
assert('alice emailsSent = 2',  aliceStats.emailsSent, 2); // lead 1 (sent), lead 3 (sent)
assert('alice callsMade = 1',   aliceStats.callsMade,  1); // lead 1 (called)
assert('alice smsSent = 1',     aliceStats.smsSent,    1); // lead 1 (sent)
assert('alice meetingsBooked = 2 (global)', aliceStats.meetingsBooked, 2);

// ── Bob (user 2) scoped stats ─────────────────────────────────────────────────

console.log('\n=== Salesperson Bob (userId=2) stats ===');
const bobStats = getStats('salesperson', 2);
// Bob's leads: id=4 (assigned + scrape-B), id=5 (scrape-B)
assert('bob totalLeads = 2 (no double-count)', bobStats.totalLeads, 2);
assert('bob emailsSent = 1',  bobStats.emailsSent, 1); // lead 4
assert('bob callsMade = 2',   bobStats.callsMade,  2); // lead 4,5
assert('bob smsSent = 1',     bobStats.smsSent,    1); // lead 4

// ─── leads route: salesperson_id filter logic ────────────────────────────────

console.log('\n=== Leads salesperson_id filter (admin usage) ===');

function queryLeads(salesperson_id) {
  const where  = [];
  const params = [];
  if (salesperson_id !== undefined && salesperson_id !== '') {
    if (salesperson_id === 'unassigned') {
      where.push('leads.assigned_user_id IS NULL');
    } else {
      const spId = parseInt(salesperson_id, 10);
      if (!isNaN(spId)) {
        where.push('leads.assigned_user_id = ?');
        params.push(spId);
      }
    }
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT COUNT(*) as count FROM leads ${whereClause}`).get(...params).count;
}

assert('no filter → all 6 leads',       queryLeads(undefined),     6);
assert('empty string → all 6 leads',    queryLeads(''),            6);
assert('salesperson_id=1 → 2 leads',    queryLeads('1'),           2); // leads 1,3 (both assigned to Alice)
assert('salesperson_id=2 → 1 lead',     queryLeads('2'),           1); // lead 4 (lead 5 is unassigned)
assert('unassigned → 3 leads',           queryLeads('unassigned'),  3); // leads 2,5,6



// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed.\n');
}
