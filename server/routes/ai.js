const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const db = require('../db');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getGeminiKey() {
  return process.env.GEMINI_API_KEY || getSetting('gemini_api_key');
}

/**
 * Decode HTML entities that Gemini may have escaped (especially inside JSON strings).
 */
function decodeHtmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Extract content from a markdown code fence if present anywhere in the text.
 * Returns the inner content, or null if no fence found.
 */
function extractCodeFence(s) {
  const m = s.match(/```[\w]*\r?\n([\s\S]*?)\r?\n?```/);
  return m ? m[1].trim() : null;
}

/**
 * Strip any leading/trailing ``` markers when not a complete fence block.
 */
function stripLooseFences(s) {
  return s
    .replace(/^```[\w]*\r?\n?/, '')
    .replace(/\r?\n?```\s*$/, '')
    .trim();
}

/**
 * Void/self-closing HTML elements that do not need a closing tag.
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Paired block/inline tags we care about for balance checking in emails.
 */
const PAIRED_TAGS = ['p', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
  'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'a', 'b', 'i', 'u'];

/**
 * Check that an HTML string is structurally complete:
 *  1. Does not end with a dangling open tag (e.g. "<p>" with no content/close).
 *  2. Has balanced counts for common paired tags.
 *
 * Returns true if the HTML looks complete, false if it appears truncated.
 */
function isHtmlComplete(html) {
  if (!html || !html.trim()) return false;

  const trimmed = html.trimEnd();

  // 1. Check whether the string ends with an opening (non-void) tag.
  //    Pattern: <tagname> or <tagname attrs> at the very end (ignoring trailing whitespace).
  const danglingOpenTag = trimmed.match(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?\s*>\s*$/);
  if (danglingOpenTag) {
    const tag = danglingOpenTag[1].toLowerCase();
    if (!VOID_ELEMENTS.has(tag)) {
      return false; // unclosed opening tag at end
    }
  }

  // 2. Balance check for paired tags.
  for (const tag of PAIRED_TAGS) {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
    const closeRe = new RegExp(`</${tag}>`, 'gi');
    const opens = (html.match(openRe) || []).length;
    const closes = (html.match(closeRe) || []).length;
    if (opens !== closes) return false;
  }

  return true;
}

/**
 * Normalize AI output for EMAIL type.
 * Handles: JSON wrappers, markdown code fences, escaped HTML, prose preambles/postambles.
 * Preserves placeholders: {business_name}, {city}, {state}, {keyword}, {company_name}, etc.
 * Returns clean HTML suitable for an email body.
 */
function normalizeEmailOutput(raw) {
  let s = raw.trim();

  // 1. JSON wrapper (Gemini occasionally returns {"html": "...", "body": "..."})
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      const val =
        parsed.html || parsed.body || parsed.email ||
        parsed.script || parsed.text || parsed.content || parsed.message;
      if (typeof val === 'string') s = val.trim();
    } catch {
      // Not valid JSON — continue
    }
  }

  // 2. Code fence extraction (embedded anywhere in prose)
  const fenced = extractCodeFence(s);
  if (fenced) {
    s = fenced;
  } else {
    s = stripLooseFences(s);
  }

  // 3. Unescape HTML entities (Gemini can escape < > inside code fences / JSON)
  if (!s.includes('<') && (s.includes('&lt;') || s.includes('&gt;'))) {
    s = decodeHtmlEntities(s);
    const f2 = extractCodeFence(s);
    if (f2) s = f2;
  }

  // 4. Strip prose preamble/postamble around HTML content
  if (s.includes('<')) {
    const firstTag = s.search(/<[a-zA-Z]/);
    if (firstTag > 0) s = s.slice(firstTag);

    const lastGt = s.lastIndexOf('>');
    if (lastGt !== -1 && lastGt < s.length - 1) {
      const after = s.slice(lastGt + 1).trim();
      if (after && !after.startsWith('<')) {
        s = s.slice(0, lastGt + 1);
      }
    }
  } else if (s.trim()) {
    // Plain text fallback — wrap in <p> tags preserving paragraph breaks
    s = s
      .split(/\n{2,}/)
      .filter(p => p.trim())
      .map(p => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  }

  return s.trim();
}

/**
 * Normalize AI output for SMS / VOICE / CALL types.
 * Returns clean plain text (strips HTML tags and code fences).
 * Preserves placeholders.
 */
function normalizePlainOutput(raw) {
  let s = raw.trim();

  // JSON wrapper
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      const val =
        parsed.text || parsed.sms || parsed.script || parsed.message ||
        parsed.voice || parsed.content || parsed.body;
      if (typeof val === 'string') s = val.trim();
    } catch {
      // Not valid JSON — continue
    }
  }

  // Code fence extraction
  const fenced = extractCodeFence(s);
  if (fenced) {
    s = fenced;
  } else {
    s = stripLooseFences(s);
  }

  // Unescape HTML entities
  s = decodeHtmlEntities(s);

  // Strip any stray HTML tags (shouldn't be in SMS/voice but clean them out)
  s = s.replace(/<[^>]+>/g, '');

  return s.trim();
}

/**
 * Call Gemini once and return { rawText, finishReason } or throw.
 * Throws on fetch/network errors; returns null rawText on empty/safety blocks.
 */
async function callGemini(apiKey, prompt, maxOutputTokens, signal) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens },
      }),
    }
  );

  if (!response.ok) {
    let errMsg = `Gemini API error: ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) errMsg = errBody.error.message;
    } catch {}
    const err = new Error(errMsg);
    err.status = 502;
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const err = new Error('Gemini returned an unreadable response.');
    err.status = 502;
    throw err;
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason = data?.candidates?.[0]?.finishReason;

  return { rawText: typeof rawText === 'string' ? rawText : null, finishReason };
}

// POST /api/ai/generate
// body: { prompt, type: 'email' | 'sms' | 'voice' | 'call' }
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, type } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const apiKey = getGeminiKey();
    if (!apiKey) {
      return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings.' });
    }

    const isEmail = type === 'email';

    // --- System contexts ---
    // Email prompt is kept deliberately concise (3 short paragraphs ≈ 80 words of content)
    // so the output stays well within the token budget even on the first attempt.
    const systemContext = {
      email: 'You are a B2B email copywriter. Output ONLY raw HTML — no subject line, no explanation, no markdown. Use <p> tags for paragraphs. Exactly 3 paragraphs: (1) brief intro referencing {business_name} in {city}, (2) one key benefit sentence, (3) call-to-action. Use placeholders {business_name}, {city}, {state} where natural. Total length: 60–90 words of visible text. Start with <p> and end with </p>.',
      sms: 'You are an SMS marketing expert. Write ONLY the SMS message text — no preamble, no explanation. Keep it under 160 characters. Use placeholders {business_name}, {city}, {state} where natural. Be direct with a clear call-to-action. No emojis unless requested. Output the message text only.',
      voice: 'You are a voice script writer for outbound business calls. Write ONLY the phone script — no preamble, no explanation, no stage directions. Use placeholders {company_name}, {city}, {state}, {keyword} where natural. Keep it under 45 seconds when spoken (about 100 words). Output the script text only.',
      call: 'You are a voice script writer for outbound business calls. Write ONLY the phone script — no preamble, no explanation, no stage directions. Use placeholders {company_name}, {city}, {state}, {keyword} where natural. Keep it under 45 seconds when spoken (about 100 words). Output the script text only.',
    };

    // Retry prompt for email: even stricter, demands a complete 2-paragraph email
    const emailRetryContext = 'You are a B2B email copywriter. Output ONLY raw HTML. Exactly 2 paragraphs using <p> tags: (1) one sentence intro, (2) one sentence call-to-action. Use placeholder {business_name}. Maximum 40 words of visible text. Must start with <p> and end with </p>. Nothing else.';

    const context = systemContext[type] || systemContext.voice;
    const firstPrompt = `${context}\n\nUser request: ${prompt.trim()}\n\nOutput:`;

    // Token budgets: emails need more headroom; SMS/voice stay small
    const maxTokensFirst = isEmail ? 1024 : 512;
    const maxTokensRetry = 512; // retry is a shorter email

    // AbortSignal.timeout is available in Node v17.3+ / v20+ — safe for Node v20
    const signal = AbortSignal.timeout(30000);

    // --- First attempt ---
    let rawText, finishReason;
    try {
      ({ rawText, finishReason } = await callGemini(apiKey, firstPrompt, maxTokensFirst, signal));
    } catch (fetchErr) {
      if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'AI request timed out after 30 seconds. Please try again.' });
      }
      if (fetchErr.status) {
        return res.status(fetchErr.status).json({ error: fetchErr.message });
      }
      throw fetchErr;
    }

    // Check for empty / safety block
    if (!rawText) {
      if (finishReason === 'SAFETY') {
        return res.status(422).json({ error: 'AI declined to generate this content due to safety filters. Try rephrasing your prompt.' });
      }
      return res.status(502).json({ error: 'AI returned an empty response. Try rephrasing your prompt.' });
    }

    // Normalize
    let script = isEmail ? normalizeEmailOutput(rawText) : normalizePlainOutput(rawText);

    // --- Truncation detection & retry (email only) ---
    if (isEmail) {
      const truncated = finishReason === 'MAX_TOKENS' || !isHtmlComplete(script);

      if (truncated) {
        console.warn(`[AI] Email truncated (finishReason=${finishReason}), retrying with shorter prompt.`);

        const retryPrompt = `${emailRetryContext}\n\nUser request: ${prompt.trim()}\n\nOutput:`;
        let rawText2, finishReason2;
        try {
          ({ rawText: rawText2, finishReason: finishReason2 } = await callGemini(apiKey, retryPrompt, maxTokensRetry, signal));
        } catch (fetchErr2) {
          if (fetchErr2.name === 'TimeoutError' || fetchErr2.name === 'AbortError') {
            return res.status(504).json({ error: 'AI request timed out on retry. Please try again.' });
          }
          if (fetchErr2.status) {
            return res.status(fetchErr2.status).json({ error: fetchErr2.message });
          }
          throw fetchErr2;
        }

        if (rawText2) {
          const script2 = normalizeEmailOutput(rawText2);
          const stillTruncated = finishReason2 === 'MAX_TOKENS' || !isHtmlComplete(script2);

          if (!stillTruncated && script2) {
            // Retry succeeded
            script = script2;
          } else {
            // Both attempts truncated — return a clear error
            return res.status(502).json({
              error: 'AI could not generate a complete email for this prompt. Please try a shorter or simpler description.',
            });
          }
        } else {
          return res.status(502).json({ error: 'AI returned an empty response on retry. Try rephrasing your prompt.' });
        }
      }
    }

    if (!script) {
      return res.status(502).json({ error: 'AI response could not be normalized. Try rephrasing your prompt.' });
    }

    res.json({ script });
  } catch (err) {
    console.error('AI generate error:', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Internal server error during AI generation.' });
  }
});

module.exports = router;
