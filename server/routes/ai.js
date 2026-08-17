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

// POST /api/ai/generate
// body: { prompt, type: 'email' | 'sms' | 'voice' | 'call' }
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, type } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const apiKey = getGeminiKey();
    if (!apiKey) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings.' });

    const systemContext = {
      email: 'You are an expert email copywriter for B2B outreach. Write a professional, concise HTML email body (use <p> tags). Use placeholders {business_name}, {city}, {state} where natural. No subject line needed — just the body. Keep it under 200 words.',
      sms: 'You are an SMS marketing expert. Write a short, friendly SMS message under 160 characters. Use placeholders {business_name}, {city}, {state} where natural. Be direct and include a clear call-to-action. No emojis unless requested.',
      voice: 'You are a voice script writer for outbound business calls. Write a natural-sounding, conversational phone script. Use placeholders {company_name}, {city}, {state}, {keyword} where natural. Keep it under 45 seconds when spoken (about 100 words). No stage directions.',
      call: 'You are a voice script writer for outbound business calls. Write a natural-sounding, conversational phone script. Use placeholders {company_name}, {city}, {state}, {keyword} where natural. Keep it under 45 seconds when spoken (about 100 words). No stage directions.',
    };

    const context = systemContext[type] || systemContext.voice;
    const fullPrompt = `${context}\n\nUser request: ${prompt}\n\nScript:`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 400 },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ script: text.trim() });
  } catch (err) {
    console.error('AI generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
