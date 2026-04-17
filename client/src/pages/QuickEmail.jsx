import { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import AIScriptBox from '../components/AIScriptBox';

export default function QuickEmail() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [senders, setSenders] = useState([]);
  const [selectedSenderId, setSelectedSenderId] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    apiFetch('/email-senders').then(data => {
      setSenders(data);
      const def = data.find(s => s.is_default);
      if (def) setSelectedSenderId(String(def.id));
    }).catch(() => {});
  }, []);

  const handleSend = async () => {
    if (!to || !subject || !body) return;
    setSending(true); setResult(null);
    try {
      const data = await apiFetch('/dialer/email', {
        method: 'POST',
        body: JSON.stringify({ toEmail: to, subject, body, senderId: selectedSenderId || undefined }),
      });
      setResult({ ok: true, msg: data.mock ? `[Mock] Email would be sent to ${to}` : `✅ Email sent to ${to}` });
      setTo(''); setSubject(''); setBody('');
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally { setSending(false); }
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500';

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Quick Email</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white">Compose</h3>

          {senders.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">From</label>
              <select value={selectedSenderId} onChange={e => setSelectedSenderId(e.target.value)} className={inp}>
                <option value="">Use SMTP default</option>
                {senders.map(s => <option key={s.id} value={String(s.id)}>{s.label} — {s.email}{s.is_default?' (default)':''}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">To (email address)</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@example.com" type="email" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject line..." className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Body (HTML or plain text)</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
              placeholder="<p>Hi there,</p><p>I wanted to reach out...</p>"
              className={`${inp} resize-none font-mono text-xs`} />
          </div>

          <AIScriptBox type="email" onGenerated={b => setBody(b)} placeholder='e.g. "Friendly follow-up for a local plumber in Austin"' />

          <div className="flex gap-2">
            <button onClick={() => setShowPreview(!showPreview)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors">
              {showPreview ? 'Hide Preview' : 'Preview'}
            </button>
            <button onClick={handleSend} disabled={sending || !to || !subject || !body}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {sending ? 'Sending...' : '✉ Send Email'}
            </button>
          </div>

          {result && (
            <div className={`p-4 rounded-lg text-sm ${result.ok ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
              {result.msg}
            </div>
          )}

          {showPreview && body && (
            <div className="p-4 bg-gray-800 rounded-lg">
              <p className="text-xs text-gray-500 mb-2">Preview:</p>
              <div className="text-sm text-gray-300" dangerouslySetInnerHTML={{ __html: body }} />
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Tips</h3>
          <div className="space-y-3 text-sm text-gray-400">
            <div className="p-3 bg-gray-800/60 rounded-lg">
              <p className="text-white font-medium mb-1">From address</p>
              <p>Emails will come from the selected sender. Add senders in <a href="/email-senders" className="text-blue-400 hover:underline">Email Senders</a>. Each must be verified in Mailgun.</p>
            </div>
            <div className="p-3 bg-gray-800/60 rounded-lg">
              <p className="text-white font-medium mb-1">HTML email tips</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Use <code className="bg-gray-700 px-1 rounded">&lt;p&gt;</code> tags for paragraphs</li>
                <li>Use <code className="bg-gray-700 px-1 rounded">&lt;br&gt;</code> for line breaks</li>
                <li>Use <code className="bg-gray-700 px-1 rounded">&lt;b&gt;</code> or <code className="bg-gray-700 px-1 rounded">&lt;strong&gt;</code> for bold</li>
                <li>Or just type plain text — it works too</li>
              </ul>
            </div>
            <div className="p-3 bg-gray-800/60 rounded-lg">
              <p className="text-white font-medium mb-1">AI Generate</p>
              <p>Use the ✨ Generate box to have Gemini write the email body for you. Just describe what you want.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
