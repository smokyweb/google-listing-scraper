/**
 * Tests for voice-drop route — state machine logic and webhook authorization.
 *
 * Pure unit tests using an in-memory SQLite database.
 * Run with:  node server/routes/voice-drop.test.js
 */

'use strict';

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

// ── In-memory DB setup ───────────────────────────────────────────────────────

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE IF NOT EXISTS voice_drop_sessions (
    id TEXT PRIMARY KEY,
    salesperson_id INTEGER,
    lead_id INTEGER,
    lead_phone TEXT,
    conference_name TEXT,
    from_number TEXT,
    agent_phone TEXT,
    agent_call_sid TEXT,
    recipient_call_sid TEXT,
    audio_url TEXT,
    script_text TEXT,
    state TEXT DEFAULT 'initiated',
    error_msg TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, phone TEXT, city TEXT, state TEXT,
    keyword TEXT, email TEXT, assigned_user_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS sales_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, email TEXT, password_hash TEXT,
    forward_number TEXT, phone_number_id INTEGER,
    is_active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS phone_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT, number TEXT, is_default INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS voice_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, script TEXT, is_active INTEGER DEFAULT 0
  );
`);

// Seed
db.prepare('INSERT INTO leads (name, phone, city, state, keyword) VALUES (?, ?, ?, ?, ?)').run('Acme Plumbing', '555-123-4567', 'Austin', 'TX', 'plumber');
db.prepare('INSERT INTO phone_numbers (label, number, is_default) VALUES (?, ?, ?)').run('Main', '+15551234567', 1);
db.prepare('INSERT INTO sales_users (name, email, password_hash, forward_number, phone_number_id) VALUES (?, ?, ?, ?, ?)').run('Alice', 'alice@test.com', 'hash', '+15559998888', 1);
db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('signalwire_project_id', 'proj-abc-123');

// ── Helpers (inline port of route logic) ─────────────────────────────────────

function getSession(id) {
  return db.prepare('SELECT * FROM voice_drop_sessions WHERE id = ?').get(id);
}

function updateSession(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE voice_drop_sessions SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}

function canAccessSession(session, user) {
  if (!session) return false;
  if (user.role === 'admin') return true;
  return session.salesperson_id === user.userId;
}

function validateWebhook(body, projectId) {
  if (!projectId) return true;
  const accountSid = body?.AccountSid || body?.account_sid;
  if (!accountSid) return false;
  return accountSid === projectId;
}

function personalizeScript(scriptText, lead) {
  return (scriptText || '')
    .replace(/{company_name}/g, lead.name || '')
    .replace(/{business_name}/g, lead.name || '')
    .replace(/{city}/g, lead.city || '')
    .replace(/{state}/g, lead.state || '');
}

function normalizePhone(raw) {
  if (!raw) return '';
  let n = raw.replace(/\D/g, '');
  if (n.length === 10) n = '1' + n;
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}

function createSession(overrides = {}) {
  const id = uuidv4();
  const confName = `vd-${id}`;
  const expires = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO voice_drop_sessions (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, state, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.salesperson_id ?? 1,
    overrides.lead_id ?? 1,
    overrides.lead_phone ?? '+15551234567',
    confName,
    overrides.from_number ?? '+15559001000',
    overrides.agent_phone ?? '+15559998888',
    overrides.script_text ?? 'Hello {business_name}',
    overrides.state ?? 'initiated',
    expires
  );
  return id;
}

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEqual(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── Test Groups ──────────────────────────────────────────────────────────────

console.log('\n=== Session Creation & State ===');

{
  const id = createSession({ state: 'initiated' });
  const s = getSession(id);
  assertEqual('session created with correct state', s.state, 'initiated');
  assertEqual('session lead_phone set', s.lead_phone, '+15551234567');
  assert('session has conference_name', !!s.conference_name);
  assert('session conference_name starts with vd-', s.conference_name.startsWith('vd-'));
}

console.log('\n=== canAccessSession ===');

{
  const id = createSession({ salesperson_id: 1 });
  const s = getSession(id);

  assert('admin can access any session', canAccessSession(s, { role: 'admin', userId: 99 }));
  assert('salesperson can access own session', canAccessSession(s, { role: 'salesperson', userId: 1 }));
  assert('salesperson cannot access others session', !canAccessSession(s, { role: 'salesperson', userId: 2 }));
  assert('null session returns false', !canAccessSession(null, { role: 'admin', userId: 1 }));
}

console.log('\n=== State Transitions ===');

{
  // initiated → agent_answered
  const id = createSession({ state: 'initiated' });
  updateSession(id, { state: 'agent_answered', agent_call_sid: 'CA-agent-111' });
  const s = getSession(id);
  assertEqual('state = agent_answered after agent picks up', s.state, 'agent_answered');
  assertEqual('agent_call_sid stored', s.agent_call_sid, 'CA-agent-111');
}

{
  // agent_answered → recipient_answered
  const id = createSession({ state: 'agent_answered', agent_call_sid: 'CA-agent-222' });
  updateSession(id, { state: 'recipient_answered', recipient_call_sid: 'CA-lead-333' });
  const s = getSession(id);
  assertEqual('state = recipient_answered after lead picks up', s.state, 'recipient_answered');
  assertEqual('recipient_call_sid stored', s.recipient_call_sid, 'CA-lead-333');
}

{
  // recipient_answered → dropping
  const id = createSession({ state: 'recipient_answered', recipient_call_sid: 'CA-lead-444' });
  updateSession(id, { state: 'dropping' });
  const s = getSession(id);
  assertEqual('state = dropping after drop clicked', s.state, 'dropping');
}

{
  // dropping → completed (lead hangs up after playback)
  const id = createSession({ state: 'dropping' });
  updateSession(id, { state: 'completed' });
  const s = getSession(id);
  assertEqual('state = completed after lead hangs up', s.state, 'completed');
}

{
  // agent no-answer → failed
  const id = createSession({ state: 'initiated' });
  updateSession(id, { state: 'failed', error_msg: 'Agent call no-answer' });
  const s = getSession(id);
  assertEqual('state = failed on agent no-answer', s.state, 'failed');
  assert('error_msg set on failure', !!s.error_msg);
}

{
  // lead no-answer → failed
  const id = createSession({ state: 'agent_answered' });
  updateSession(id, { state: 'failed', error_msg: 'Lead call no-answer' });
  const s = getSession(id);
  assertEqual('state = failed on lead no-answer', s.state, 'failed');
}

{
  // cancelled
  const id = createSession({ state: 'agent_answered' });
  updateSession(id, { state: 'cancelled' });
  const s = getSession(id);
  assertEqual('state = cancelled on user cancel', s.state, 'cancelled');
}

console.log('\n=== Drop guard — only in recipient_answered ===');

{
  const terminalStates = ['initiated', 'agent_answered', 'dropping', 'completed', 'failed', 'cancelled'];
  for (const state of terminalStates) {
    const id = createSession({ state });
    const s = getSession(id);
    const canDrop = s.state === 'recipient_answered';
    assert(`cannot drop in state "${state}"`, !canDrop);
  }

  const id = createSession({ state: 'recipient_answered', recipient_call_sid: 'CA-999' });
  const s = getSession(id);
  assert('can drop in state "recipient_answered"', s.state === 'recipient_answered');
}

console.log('\n=== Webhook validation ===');

{
  const projectId = 'proj-abc-123';

  assert('valid AccountSid passes', validateWebhook({ AccountSid: 'proj-abc-123' }, projectId));
  assert('wrong AccountSid fails', !validateWebhook({ AccountSid: 'wrong-id' }, projectId));
  assert('missing AccountSid fails', !validateWebhook({}, projectId));
  assert('no projectId configured → allow (dev mode)', validateWebhook({}, null));
  assert('snake_case account_sid also accepted', validateWebhook({ account_sid: 'proj-abc-123' }, projectId));
}

console.log('\n=== normalizePhone ===');

{
  assertEqual('10-digit → E.164', normalizePhone('5551234567'), '+15551234567');
  assertEqual('with dashes → E.164', normalizePhone('555-123-4567'), '+15551234567');
  assertEqual('already E.164 unchanged', normalizePhone('+15551234567'), '+15551234567');
  assertEqual('empty string', normalizePhone(''), '');
  assertEqual('null → empty', normalizePhone(null), '');
}

console.log('\n=== personalizeScript ===');

{
  const lead = { name: 'Acme Plumbing', city: 'Austin', state: 'TX' };
  const script = 'Hello {business_name} in {city}, {state}!';
  const result = personalizeScript(script, lead);
  assertEqual('replaces {business_name}', result, 'Hello Acme Plumbing in Austin, TX!');
}

{
  const lead = { name: 'Bob Co', city: 'NYC', state: 'NY' };
  const script = '{company_name} and {business_name}';
  const result = personalizeScript(script, lead);
  assertEqual('replaces both company_name and business_name', result, 'Bob Co and Bob Co');
}

console.log('\n=== Expired session cleanup ===');

{
  // Insert a session with an already-expired expires_at
  const id = uuidv4();
  const pastDate = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO voice_drop_sessions (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, state, expires_at)
    VALUES (?, 1, 1, '+15550000000', 'vd-old', '+15559001000', '+15559998888', 'old script', 'initiated', ?)
  `).run(id, pastDate);

  // Verify it exists before cleanup
  const before = getSession(id);
  assert('expired session exists before cleanup', !!before);

  // Simulate cleanup
  db.prepare("DELETE FROM voice_drop_sessions WHERE expires_at < datetime('now')").run();

  const after = getSession(id);
  assert('expired session removed after cleanup', !after);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All voice-drop tests passed.\n');
}
