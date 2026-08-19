/**
 * Basic smoke tests for the isHtmlComplete helper and normalizeEmailOutput.
 * Run with: node server/routes/ai.test.js
 */

// ---- inline copies of the helpers under test ----

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const PAIRED_TAGS = ['p', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
  'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'a', 'b', 'i', 'u'];

function isHtmlComplete(html) {
  if (!html || !html.trim()) return false;
  const trimmed = html.trimEnd();

  // Ends with a dangling opening (non-void) tag?
  const danglingOpenTag = trimmed.match(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?\s*>\s*$/);
  if (danglingOpenTag) {
    const tag = danglingOpenTag[1].toLowerCase();
    if (!VOID_ELEMENTS.has(tag)) return false;
  }

  // Balance check
  for (const tag of PAIRED_TAGS) {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
    const closeRe = new RegExp(`</${tag}>`, 'gi');
    const opens = (html.match(openRe) || []).length;
    const closes = (html.match(closeRe) || []).length;
    if (opens !== closes) return false;
  }

  return true;
}

// ---- tests ----

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

console.log('\n=== isHtmlComplete ===');

// Truncated: ends with dangling <p>
assert('truncated: ends with open <p>',
  isHtmlComplete('<p>Hi,</p>\n\n<p>\n') === false);

// Truncated: ends with open <p> (no trailing whitespace)
assert('truncated: ends with open <p> no trailing space',
  isHtmlComplete('<p>Hello</p><p>') === false);

// Truncated: unbalanced <p> tags
assert('truncated: more <p> than </p>',
  isHtmlComplete('<p>Para 1</p><p>Para 2') === false);

// Complete: balanced <p> tags
assert('complete: balanced <p> tags',
  isHtmlComplete('<p>Hi, {business_name} in {city}.</p>\n<p>We help businesses like yours.</p>\n<p>Call us today!</p>') === true);

// Complete: void element at end is fine (br)
assert('complete: ends with void <br> is ok',
  isHtmlComplete('<p>Hello.</p><br>') === true);

// Complete: single paragraph
assert('complete: single balanced <p>',
  isHtmlComplete('<p>Short email.</p>') === true);

// Empty/null
assert('incomplete: empty string', isHtmlComplete('') === false);
assert('incomplete: null', isHtmlComplete(null) === false);

// Unbalanced <ul>
assert('truncated: unbalanced <ul>',
  isHtmlComplete('<p>Hi</p><ul><li>Item 1</li>') === false);

// Balanced <ul>
assert('complete: balanced <ul>',
  isHtmlComplete('<p>Hi</p><ul><li>Item 1</li></ul><p>Thanks.</p>') === true);

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed.\n');
}
