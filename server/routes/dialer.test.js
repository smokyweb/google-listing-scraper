/**
 * Tests for dialer.js helper functions: normalizePhone and isValidE164.
 *
 * Pure unit tests — no database, no HTTP, no SignalWire.
 *
 * Run with:  node server/routes/dialer.test.js
 */

'use strict';

// ── Inline copies of the functions under test ────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return '';
  let n = raw.replace(/\D/g, '');
  if (n.length === 10) n = '1' + n;      // US 10-digit → prepend country code
  // 11-digit starting with '1' is already a US number with country code
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}

function isValidE164(normalized) {
  return /^\+\d{10,15}$/.test(normalized);
}

// ── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      received: ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertValid(description, phone) {
  const n = normalizePhone(phone);
  const ok = isValidE164(n);
  if (ok) {
    console.log(`  ✓ ${description} → ${n}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}: normalized to "${n}" which is NOT valid E.164`);
    failed++;
  }
}

function assertInvalid(description, phone) {
  const n = normalizePhone(phone);
  const ok = isValidE164(n);
  if (!ok) {
    console.log(`  ✓ ${description} → "${n}" (correctly rejected)`);
    passed++;
  } else {
    console.error(`  ✗ ${description}: normalized to "${n}" but was expected to be INVALID`);
    failed++;
  }
}

// ── normalizePhone ───────────────────────────────────────────────────────────

console.log('\nnormalizePhone()');

assert('null/empty → empty string',          normalizePhone(null), '');
assert('undefined → empty string',           normalizePhone(undefined), '');
assert('empty string → empty string',        normalizePhone(''), '');

assert('10-digit US → E.164',
  normalizePhone('2125551234'), '+12125551234');

assert('10-digit with dashes → E.164',
  normalizePhone('212-555-1234'), '+12125551234');

assert('10-digit with dots → E.164',
  normalizePhone('212.555.1234'), '+12125551234');

assert('10-digit with parens/spaces → E.164',
  normalizePhone('(212) 555-1234'), '+12125551234');

assert('11-digit US (1XXXXXXXXXX) → E.164',
  normalizePhone('12125551234'), '+12125551234');

assert('already E.164 +1XXXXXXXXXX → unchanged',
  normalizePhone('+12125551234'), '+12125551234');

assert('international +33 French → unchanged',
  normalizePhone('+33123456789'), '+33123456789');

assert('international digits only 33XXXXXXXXX → E.164',
  normalizePhone('33123456789'), '+33123456789');

assert('strips formatting from +1 (212) 555-1234',
  normalizePhone('+1 (212) 555-1234'), '+12125551234');

// ── isValidE164 ──────────────────────────────────────────────────────────────

console.log('\nisValidE164()');

assert('valid US E.164',      isValidE164('+12125551234'), true);
assert('valid intl E.164',    isValidE164('+447700900123'), true);
assert('15-digit max',        isValidE164('+123456789012345'), true);
assert('no plus → false',     isValidE164('12125551234'), false);
assert('too short → false',   isValidE164('+1212555'), false);
assert('too long → false',    isValidE164('+1234567890123456'), false);
assert('has letters → false', isValidE164('+1212555abc4'), false);
assert('empty → false',       isValidE164(''), false);

// ── Round-trip: normalize then validate ──────────────────────────────────────

console.log('\nRound-trip: normalizePhone → isValidE164');

assertValid('10-digit US',               '2125551234');
assertValid('10-digit with dashes',      '212-555-1234');
assertValid('11-digit US',               '12125551234');
assertValid('already E.164 +1',          '+12125551234');
assertValid('international +44',         '+447700900123');
assertValid('(212) 555-1234 formatted',  '(212) 555-1234');

assertInvalid('7-digit (local only)',    '5551234');
assertInvalid('empty string',            '');
assertInvalid('null',                    null);
assertInvalid('garbage string',          'not-a-number!!');

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
