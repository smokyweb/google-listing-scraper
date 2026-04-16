import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function SMS() {
  const [message, setMessage] = useState(
    'Hi {business_name}! We noticed your listing in {city}, {state} and would love to help grow your business. Book a free consultation: https://your-scheduling-link.com'
  );
  const [leads, setLeads] = useState([]);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    apiFetch('/leads?limit=500')
      .then(data => setLeads(data.leads.filter(l => l.phone)))
      .catch(console.error);
    apiFetch('/phone-numbers')
      .then(data => {
        setPhoneNumbers(data);
        const def = data.find(n => n.is_default);
        if (def) setSelectedPhoneId(String(def.id));
      })
      .catch(console.error);
  }, []);

  const handleSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const data = await apiFetch('/sms/send', {
        method: 'POST',
        body: JSON.stringify({
          message,
          leadIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
          phoneNumberId: selectedPhoneId ? parseInt(selectedPhoneId) : undefined,
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

  const previewMessage = message
    .replace(/{business_name}/g, 'Acme Plumbing')
    .replace(/{city}/g, 'Austin')
    .replace(/{state}/g, 'TX');

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">SMS</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Compose SMS</h3>
          <p className="text-xs text-gray-500 mb-4">Placeholders: {'{business_name}'} {'{city}'} {'{state}'}</p>

          {phoneNumbers.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">Sending From</label>
              <select
                value={selectedPhoneId}
                onChange={e => setSelectedPhoneId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">Use default number</option>
                {phoneNumbers.map(n => (
                  <option key={n.id} value={String(n.id)}>
                    {n.label} — {n.number}{n.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
          />

          <div className="bg-gray-800 rounded-lg p-4 mb-4">
            <p className="text-xs text-gray-500 mb-1">Preview:</p>
            <p className="text-sm text-gray-300">{previewMessage}</p>
            <p className="text-xs text-gray-500 mt-2">{previewMessage.length}/160 characters</p>
          </div>

          <button
            onClick={handleSend}
            disabled={sending || !message}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending...' : selectedIds.size > 0 ? `Send to ${selectedIds.size} Selected` : `Send to All (${leads.length})`}
          </button>

          {result && (
            <div className={`mt-4 p-4 rounded-lg ${result.error ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {result.error || `Sent ${result.sent} SMS${result.mock ? ' (mock mode)' : ''}`}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Recipients ({leads.length} with phone)</h3>
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
                  <p className="text-xs text-gray-500">{lead.phone}</p>
                </div>
              </label>
            ))}
            {leads.length === 0 && <p className="text-gray-500 text-sm p-4">No leads with phone numbers. Scrape some leads first.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
