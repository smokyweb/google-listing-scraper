import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function EmailCampaign() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leads, setLeads] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    apiFetch('/leads?limit=500')
      .then(data => setLeads(data.leads.filter(l => l.email)))
      .catch(console.error);
  }, []);

  const handleSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const data = await apiFetch('/email/send', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          body,
          leadIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
        }),
      });
      setResult(data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setSending(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const previewBody = body
    .replace(/{business_name}/g, 'Acme Plumbing')
    .replace(/{city}/g, 'Austin')
    .replace(/{state}/g, 'TX');

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Email Campaign</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Compose Email</h3>
          <p className="text-xs text-gray-500 mb-4">Placeholders: {'{business_name}'} {'{city}'} {'{state}'}</p>

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Grow your {business_name} with our services"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Body (HTML)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="<p>Hi {business_name},</p><p>We help businesses in {city}, {state}...</p>"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
            >
              {showPreview ? 'Hide Preview' : 'Preview'}
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !subject || !body}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {sending ? 'Sending...' : selectedIds.size > 0 ? `Send to ${selectedIds.size} Selected` : `Send to All (${leads.length})`}
            </button>
          </div>

          {showPreview && (
            <div className="mt-4 p-4 bg-gray-800 rounded-lg">
              <p className="text-xs text-gray-500 mb-2">Preview (with sample data):</p>
              <p className="text-sm text-gray-300 mb-2"><strong>Subject:</strong> {subject.replace(/{business_name}/g, 'Acme Plumbing').replace(/{city}/g, 'Austin').replace(/{state}/g, 'TX')}</p>
              <div className="text-sm text-gray-300 border-t border-gray-700 pt-2" dangerouslySetInnerHTML={{ __html: previewBody }} />
            </div>
          )}

          {result && (
            <div className={`mt-4 p-4 rounded-lg ${result.error ? 'bg-red-900/50 border border-red-800 text-red-300' : 'bg-green-900/50 border border-green-800 text-green-300'}`}>
              {result.error ? result.error : `Sent ${result.sent} emails${result.mock ? ' (mock mode)' : ''}`}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Recipients ({leads.length} with email)</h3>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {leads.map(lead => (
              <label key={lead.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.has(lead.id)}
                  onChange={() => toggleSelect(lead.id)}
                  className="rounded bg-gray-800 border-gray-600"
                />
                <div>
                  <p className="text-sm text-white">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.email}</p>
                </div>
              </label>
            ))}
            {leads.length === 0 && <p className="text-gray-500 text-sm p-4">No leads with email addresses. Scrape some leads first.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
