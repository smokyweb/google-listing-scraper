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
  // Match ```lang\n...\n``` anywhere in the string (greedy outer, lazy inner)
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
    // After unescaping, check for another fence layer
    const f2 = extractCodeFence(s);
    if (f2) s = f2;
  }

  // 4. Strip prose preamble/postamble around HTML content
  if (s.includes('<')) {
    // Take from the first HTML tag onward
    const firstTag = s.search(/<[a-zA-Z]/);
    if (firstTag > 0) s = s.slice(firstTag);

    // Strip trailing prose after the last closing HTML element
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

    const systemContext = {
      email: 'You are an expert email copywriter for B2B outreach. Write ONLY the HTML email body — no subject line, no preamble, no explanation. Use <p> tags for paragraphs. Use placeholders {business_name}, {city}, {state} where natural. Keep it under 200 words. Output raw HTML only.',
      sms: 'You are an SMS marketing expert. Write ONLY the SMS message text — no preamble, no explanation. Keep it under 160 characters. Use placeholders {business_name}, {city}, {state} where natural. Be direct with a clear call-to-action. No emojis unless requested. Output the message text only.',
      voice: 'You are a voice script writer for outbound business calls. Write ONLY the phone script — no preamble, no explanation, no stage directions. Use placeholders {company_name}, {city}, {state}, {keyword} where natural. Keep it under 45 seconds when spoken (about 100 words). Output the script text only.',
      call: 'You are a voice script writer for outbound business calls. Write ONLY the phone script — no preamble, no explanation, no stage directions. Use placeholders {company_name}, {city}, {state}, {keyword} where natural. Keep it under 45 seconds when spoken (about 100 words). Output the script text only.',
    };

    const context = systemContext[type] || systemContext.voice;
    const fullPrompt = `${context}\n\nUser request: ${prompt.trim()}\n\nOutput:`;

    // AbortSignal.timeout is available in Node v17.3+ / v20+ — safe for Node v20
    const signal = AbortSignal.timeout(30000);

    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 512 },
          }),
        }
      );
    } catch (fetchErr) {
      if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'AI request timed out after 30 seconds. Please try again.' });
      }
      throw fetchErr;
    }

    if (!response.ok) {
      let errMsg = `Gemini API error: ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody?.error?.message) errMsg = errBody.error.message;
      } catch {}
      return res.status(502).json({ error: errMsg });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return res.status(502).json({ error: 'Gemini returned an unreadable response.' });
    }

    // Validate Gemini response shape
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      // Check for finish_reason clues
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason === 'SAFETY') {
        return res.status(422).json({ error: 'AI declined to generate this content due to safety filters. Try rephrasing your prompt.' });
      }
      return res.status(502).json({ error: 'AI returned an empty response. Try rephrasing your prompt.' });
    }

    // Normalize based on type
    const isEmail = type === 'email';
    const script = isEmail
      ? normalizeEmailOutput(rawText)
      : normalizePlainOutput(rawText);

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
