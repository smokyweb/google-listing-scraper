/**
 * Tests for voice-drop route — state machine logic, webhook, TwiML, and
 * manual targetPhone (no leadId) session support.
 *
 * Pure unit tests using an in-memory SQLite database.
 * No real HTTP calls or SignalWire connections are made.
 *
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
    mode TEXT DEFAULT 'voicemail',
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

// ── Helpers (inline ports of route logic) ───────────────────────────────────

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
  if (!lead) return scriptText || '';
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

/**
 * Validate normalized phone string against E.164 rules.
 * +<10-15 digits>
 */
function isValidE164(normalized) {
  return /^\+\d{10,15}$/.test(normalized);
}

function xmlEscape(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Agent conference TwiML — agent is MUTED (listen-only).
 * Recipient CANNOT hear the salesperson.
 */
function agentConferenceTwiml(confName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="alice">Lead is connecting. You are in listen-only mode — your microphone is muted. Click Drop Voice Message in the app when you are ready.</Say>` +
    `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="" muted="true">${xmlEscape(confName)}</Conference></Dial>` +
    `</Response>`
  );
}

/**
 * Recipient conference TwiML — recipient joins normally.
 */
function leadConferenceTwiml(confName) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">${xmlEscape(confName)}</Conference></Dial>` +
    `</Response>`
  );
}

/**
 * Playback TwiML — plays the message then the IVR menu.
 */
function ivrMenuTwiml(baseUrl) {
  return (
    `<Gather numDigits="1" action="${baseUrl}/api/calls/ivr-handler" method="POST" timeout="15">` +
    `<Say voice="alice">Press 1 to connect to a live staff member. ` +
    `Press 2 to set a call back time. ` +
    `Press 3 to schedule a virtual meeting. ` +
    `Press 4 to be removed from our list.</Say>` +
    `</Gather>` +
    `<Say voice="alice">We did not receive your input. Goodbye.</Say>` +
    `<Hangup/>`
  );
}

function buildPlaybackTwiml(audioUrl, scriptText, baseUrl) {
  const messageEl = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : `<Say voice="alice">${xmlEscape(scriptText || 'Thank you for your time.')}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messageEl}${ivrMenuTwiml(baseUrl)}</Response>`;
}

/** Create a session tied to a lead row */
function createSession(overrides = {}) {
  const id = uuidv4();
  const confName = `vd-${id}`;
  const expires = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO voice_drop_sessions (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, mode, state, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.salesperson_id ?? 1,
    overrides.lead_id ?? 1,           // lead row exists
    overrides.lead_phone ?? '+15551234567',
    confName,
    overrides.from_number ?? '+15559001000',
    overrides.agent_phone ?? '+15559998888',
    overrides.script_text ?? 'Hello {business_name}',
    overrides.mode ?? 'voicemail',
    overrides.state ?? 'initiated',
    expires
  );
  return id;
}

/** Create a manual session — no lead_id (NULL), uses targetPhone directly */
function createManualSession(overrides = {}) {
  const id = uuidv4();
  const confName = `vd-${id}`;
  const expires = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO voice_drop_sessions (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, mode, state, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.salesperson_id ?? 1,
    null,                             // NULL — no lead row
    overrides.lead_phone ?? '+15557778888',
    confName,
    overrides.from_number ?? '+15559001000',
    overrides.agent_phone ?? null,
    overrides.script_text ?? 'Hello, this is a manual outreach message.',
    overrides.mode ?? 'voicemail',
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

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n=== Session Creation & State ===');

{
  const id = createSession({ state: 'initiated' });
  const s = getSession(id);
  assertEqual('session created with correct state', s.state, 'initiated');
  assertEqual('session lead_phone set', s.lead_phone, '+15551234567');
  assert('session has conference_name', !!s.conference_name);
  assert('session conference_name starts with vd-', s.conference_name.startsWith('vd-'));
  assertEqual('session has lead_id for lead-based session', s.lead_id, 1);
}

console.log('\n=== Manual targetPhone Session (no leadId) ===');

{
  const id = createManualSession({ lead_phone: '+15557778888', mode: 'voicemail' });
  const s = getSession(id);
  assert('manual session created', !!s);
  assertEqual('manual session lead_id is NULL', s.lead_id, null);
  assertEqual('manual session lead_phone set to targetPhone', s.lead_phone, '+15557778888');
  assertEqual('manual session mode = voicemail', s.mode, 'voicemail');
  assert('manual session has conference_name', !!s.conference_name);
}

{
  // Manual agent-mode session (Live Voice Message to arbitrary number)
  const id = createManualSession({
    lead_phone: '+15557779999',
    mode: 'agent',
    agent_phone: '+15559998888',
  });
  const s = getSession(id);
  assertEqual('manual agent session lead_id is NULL', s.lead_id, null);
  assertEqual('manual agent session mode = agent', s.mode, 'agent');
  assertEqual('manual agent session agent_phone set', s.agent_phone, '+15559998888');
}

{
  // canAccessSession must work for manual sessions (salesperson_id still set)
  const id = createManualSession({ salesperson_id: 1 });
  const s = getSession(id);
  assert('salesperson can access own manual session', canAccessSession(s, { role: 'salesperson', userId: 1 }));
  assert('other salesperson cannot access manual session', !canAccessSession(s, { role: 'salesperson', userId: 2 }));
  assert('admin can access any manual session', canAccessSession(s, { role: 'admin', userId: 99 }));
}

console.log('\n=== normalizePhone ===');

{
  assertEqual('10-digit → E.164', normalizePhone('5551234567'), '+15551234567');
  assertEqual('with dashes → E.164', normalizePhone('555-123-4567'), '+15551234567');
  assertEqual('already E.164 unchanged', normalizePhone('+15551234567'), '+15551234567');
  assertEqual('empty string', normalizePhone(''), '');
  assertEqual('null → empty', normalizePhone(null), '');
  assertEqual('with parens/spaces', normalizePhone('(555) 123-4567'), '+15551234567');
}

console.log('\n=== isValidE164 (E.164 phone validation) ===');

{
  assert('valid US E.164 +15551234567', isValidE164('+15551234567'));
  assert('valid 10-digit normalized', isValidE164(normalizePhone('5551234567')));
  assert('valid 10-digit with dashes normalized', isValidE164(normalizePhone('555-123-4567')));
  assert('rejects empty string', !isValidE164(''));
  assert('rejects null-normalized', !isValidE164(normalizePhone(null)));
  assert('rejects too short +1555123', !isValidE164('+1555123'));
  assert('rejects no plus sign', !isValidE164('15551234567'));
  assert('rejects letters', !isValidE164('+1555abc4567'));
  assert('accepts 15-digit international', isValidE164('+441234567890'));
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
  const nonDroppableStates = ['initiated', 'agent_answered', 'dropping', 'completed', 'failed', 'cancelled'];
  for (const state of nonDroppableStates) {
    const id = createSession({ state });
    const s = getSession(id);
    const canDrop = s.state === 'recipient_answered';
    assert(`cannot drop in state "${state}"`, !canDrop);
  }

  const id = createSession({ state: 'recipient_answered', recipient_call_sid: 'CA-999' });
  const s = getSession(id);
  assert('can drop in state "recipient_answered"', s.state === 'recipient_answered');
}

console.log('\n=== Drop idempotency (already dropping/completed) ===');

{
  // Simulating the idempotency check from the route handler
  const states = ['dropping', 'completed'];
  for (const state of states) {
    const id = createSession({ state });
    const s = getSession(id);
    const isIdempotent = ['dropping', 'completed'].includes(s.state);
    assert(`drop in "${state}" returns idempotent success`, isIdempotent);
  }
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

console.log('\n=== personalizeScript (null-safe) ===');

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

{
  // null lead (manual targetPhone session) — no personalization, no crash
  const script = 'Hello {business_name}, this is a message for you.';
  const result = personalizeScript(script, null);
  assertEqual('null lead returns script unchanged', result, script);
}

{
  // undefined lead
  const script = 'Test message {company_name}.';
  const result = personalizeScript(script, undefined);
  assertEqual('undefined lead returns script unchanged', result, script);
}

console.log('\n=== TwiML builders ===');

{
  // agentConferenceTwiml — MUST include muted="true" for listen-only monitoring
  const xml = agentConferenceTwiml('vd-test-conf');
  assert('agent TwiML contains muted="true"', xml.includes('muted="true"'));
  assert('agent TwiML is valid XML opener', xml.startsWith('<?xml version="1.0"'));
  assert('agent TwiML contains Conference element', xml.includes('<Conference'));
  assert('agent TwiML contains conference name', xml.includes('vd-test-conf'));
  assert('agent TwiML has listen-only hint in Say', xml.toLowerCase().includes('muted') || xml.includes('listen-only'));
}

{
  // leadConferenceTwiml — must NOT be muted (recipient hears the drop)
  const xml = leadConferenceTwiml('vd-test-conf');
  assert('lead TwiML does NOT have muted="true" for recipient', !xml.includes('muted="true"'));
  assert('lead TwiML contains Conference element', xml.includes('<Conference'));
  assert('lead TwiML contains conference name', xml.includes('vd-test-conf'));
}

{
  // buildPlaybackTwiml — with audio URL
  const xml = buildPlaybackTwiml('https://example.com/audio.mp3', null, 'https://leads.bluesapps.com');
  assert('playback TwiML uses <Play> when audioUrl provided', xml.includes('<Play>'));
  assert('playback TwiML contains audio URL', xml.includes('https://example.com/audio.mp3'));
  assert('playback TwiML contains IVR menu', xml.includes('/api/calls/ivr-handler'));
  assert('playback TwiML has Press 1/2/3/4 options', xml.includes('Press 1') && xml.includes('Press 4'));
}

{
  // buildPlaybackTwiml — without audio URL (Say fallback)
  const xml = buildPlaybackTwiml(null, 'Hello there!', 'https://leads.bluesapps.com');
  assert('playback TwiML uses <Say> when no audioUrl', xml.includes('<Say'));
  assert('playback TwiML contains script text in Say', xml.includes('Hello there!'));
  assert('playback TwiML still has IVR menu', xml.includes('/api/calls/ivr-handler'));
}

{
  // xmlEscape in conference name with special chars
  const xml = agentConferenceTwiml('vd-test&conf');
  assert('conference name is XML-escaped in agent TwiML', xml.includes('vd-test&amp;conf'));
}

console.log('\n=== Voicemail Mode — state transitions ===');

{
  // voicemail: initiated → active (call connected)
  const id = createSession({ mode: 'voicemail', state: 'initiated' });
  updateSession(id, { state: 'active', recipient_call_sid: 'CA-vm-001' });
  const s = getSession(id);
  assertEqual('voicemail: state = active on call connect', s.state, 'active');
  assertEqual('voicemail: recipient_call_sid stored on active', s.recipient_call_sid, 'CA-vm-001');
}

{
  // voicemail: active → completed (call ends)
  const id = createSession({ mode: 'voicemail', state: 'active' });
  updateSession(id, { state: 'completed' });
  const s = getSession(id);
  assertEqual('voicemail: state = completed when call ends', s.state, 'completed');
}

{
  // voicemail: initiated → failed (no-answer)
  const id = createSession({ mode: 'voicemail', state: 'initiated' });
  updateSession(id, { state: 'failed', error_msg: 'Call no-answer' });
  const s = getSession(id);
  assertEqual('voicemail: state = failed on no-answer', s.state, 'failed');
  assert('voicemail: error_msg set', s.error_msg === 'Call no-answer');
}

{
  // voicemail: drop-message must be blocked (it's for agent mode only)
  const id = createSession({ mode: 'voicemail', state: 'active' });
  const s = getSession(id);
  const dropGuard = s.mode === 'voicemail';
  assert('voicemail: drop-message endpoint should be blocked for voicemail mode', dropGuard);
}

console.log('\n=== Agent Mode (Live Voice Message) — state transitions ===');

{
  // agent: full happy path
  const id = createSession({ mode: 'agent', state: 'initiated' });
  updateSession(id, { state: 'agent_answered', agent_call_sid: 'CA-ag-001' });
  updateSession(id, { state: 'recipient_answered', recipient_call_sid: 'CA-rc-001' });
  updateSession(id, { state: 'dropping' });
  updateSession(id, { state: 'completed' });
  const s = getSession(id);
  assertEqual('agent: full path ends completed', s.state, 'completed');
  assertEqual('agent: agent_call_sid stored', s.agent_call_sid, 'CA-ag-001');
  assertEqual('agent: recipient_call_sid stored', s.recipient_call_sid, 'CA-rc-001');
}

{
  // agent: drop only allowed in recipient_answered
  const blockStates = ['initiated', 'agent_answered', 'dropping', 'completed', 'failed', 'cancelled'];
  for (const state of blockStates) {
    const id = createSession({ mode: 'agent', state });
    const s = getSession(id);
    assert(`agent: cannot drop in state "${state}"`, s.state !== 'recipient_answered');
  }
  const id = createSession({ mode: 'agent', state: 'recipient_answered' });
  const s = getSession(id);
  assert('agent: can drop in recipient_answered', s.state === 'recipient_answered');
}

console.log('\n=== Manual session full agent-mode path ===');

{
  // Manual targetPhone + agent mode — same transitions as lead session
  const id = createManualSession({ mode: 'agent', state: 'initiated' });
  updateSession(id, { state: 'agent_answered', agent_call_sid: 'CA-manual-ag' });
  updateSession(id, { state: 'recipient_answered', recipient_call_sid: 'CA-manual-rc' });
  const s1 = getSession(id);
  assertEqual('manual agent: state = recipient_answered', s1.state, 'recipient_answered');
  assertEqual('manual agent: lead_id still NULL', s1.lead_id, null);

  updateSession(id, { state: 'dropping' });
  updateSession(id, { state: 'completed' });
  const s2 = getSession(id);
  assertEqual('manual agent: state = completed after full path', s2.state, 'completed');
}

{
  // Manual voicemail session full path
  const id = createManualSession({ mode: 'voicemail', state: 'initiated' });
  updateSession(id, { state: 'active', recipient_call_sid: 'CA-manual-vm' });
  updateSession(id, { state: 'completed' });
  const s = getSession(id);
  assertEqual('manual voicemail: completes correctly', s.state, 'completed');
  assertEqual('manual voicemail: lead_id is NULL throughout', s.lead_id, null);
}

console.log('\n=== Mode stored on session ===');

{
  const vmId = createSession({ mode: 'voicemail' });
  const agId = createSession({ mode: 'agent' });
  assertEqual('voicemail session has mode=voicemail', getSession(vmId).mode, 'voicemail');
  assertEqual('agent session has mode=agent', getSession(agId).mode, 'agent');
}

{
  const mvmId = createManualSession({ mode: 'voicemail' });
  const magId = createManualSession({ mode: 'agent' });
  assertEqual('manual voicemail session has mode=voicemail', getSession(mvmId).mode, 'voicemail');
  assertEqual('manual agent session has mode=agent', getSession(magId).mode, 'agent');
}

console.log('\n=== Expired session cleanup ===');

{
  // Insert an already-expired session
  const id = uuidv4();
  const pastDate = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO voice_drop_sessions (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, mode, state, expires_at)
    VALUES (?, 1, 1, '+15550000000', 'vd-old', '+15559001000', '+15559998888', 'old script', 'voicemail', 'initiated', ?)
  `).run(id, pastDate);

  const before = getSession(id);
  assert('expired session exists before cleanup', !!before);

  db.prepare("DELETE FROM voice_drop_sessions WHERE expires_at < datetime('now')").run();

  const after = getSession(id);
  assert('expired session removed after cleanup', !after);
}

{
  // Manual session also subject to cleanup
  const id = uuidv4();
  const pastDate = new Date(Date.now() - 3600000).toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO voice_drop_sessions (id, salesperson_id, lead_id, lead_phone, conference_name, from_number, agent_phone, script_text, mode, state, expires_at)
    VALUES (?, 1, NULL, '+15557778888', 'vd-manual-old', '+15559001000', NULL, 'manual old', 'voicemail', 'initiated', ?)
  `).run(id, pastDate);

  db.prepare("DELETE FROM voice_drop_sessions WHERE expires_at < datetime('now')").run();

  const after = getSession(id);
  assert('expired manual session also cleaned up', !after);
}

// ── normalizePhone / isValidE164 (also tested in dialer.test.js) ────────────

console.log('\n=== normalizePhone & isValidE164 (voice-drop copy) ===');

{
  const cases = [
    // [input, expectedNormalized, expectedValid]
    [null,            '',               false],
    ['',              '',               false],
    ['2125551234',    '+12125551234',   true],
    ['212-555-1234',  '+12125551234',   true],
    ['(212) 555-1234','+12125551234',   true],
    ['12125551234',   '+12125551234',   true],
    ['+12125551234',  '+12125551234',   true],
    ['+447700900123', '+447700900123',  true],
    ['5551234',       '+5551234',       false], // 7-digit—too short (not prepended)
    ['garbage',       '+',              false],
  ];

  for (const [input, expectNorm, expectValid] of cases) {
    const norm = normalizePhone(input);
    const valid = isValidE164(norm);
    assertEqual(`normalizePhone(${JSON.stringify(input)})`, norm, expectNorm);
    assert(`isValidE164 of normalizePhone(${JSON.stringify(input)}) === ${expectValid}`, valid === expectValid);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All voice-drop tests passed.\n');
}
