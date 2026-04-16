import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function PhoneCalls() {
  const [script, setScript] = useState(
    'Hello {business_name}, this is a courtesy call regarding your business listing in {city}, {state}. We have some exciting opportunities to help grow your online presence.'
  );
  const [leads, setLeads] = useState([]);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsResult, setTtsResult] = useState(null);

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

  const handleTTSPreview = async () => {
    setTtsLoading(true);
    setTtsResult(null);
    try {
      const previewText = script
        .replace(/{business_name}/g, 'Acme Plumbing')
        .replace(/{city}/g, 'Austin')
        .replace(/{state}/g, 'TX');

      const data = await apiFetch('/calls/tts-preview', {
        method: 'POST',
        body: JSON.stringify({ text: previewText }),
      });
      setTtsResult(data);
    } catch (err) {
      setTtsResult({ error: err.message });
    } finally {
      setTtsLoading(false);
    }
  };

  const handleTrigger = async () => {
    setCalling(true);
    setResult(null);
    try {
      const data = await apiFetch('/calls/trigger', {
        method: 'POST',
        body: JSON.stringify({
          script,
          leadIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
          phoneNumberId: selectedPhoneId ? parseInt(selectedPhoneId) : undefined,
        }),
      });
      setResult(data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setCalling(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Phone Calls</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Call Script Template</h3>
          <p className="text-xs text-gray-500 mb-4">Placeholders: {'{business_name}'} {'{city}'} {'{state}'}</p>

          {phoneNumbers.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">Calling From</label>
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
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
          />

          <div className="bg-gray-800 rounded-lg p-4 mb-4">
            <p className="text-xs text-gray-500 mb-2">IVR Flow:</p>
            <ul className="text-sm text-gray-300 space-y-1">
              <li>Press 1 → Transfer to your phone number</li>
              <li>Press 2 → Send SMS with scheduling link</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleTTSPreview}
              disabled={ttsLoading}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {ttsLoading ? 'Generating...' : 'TTS Preview'}
            </button>
            <button
              onClick={handleTrigger}
              disabled={calling || !script}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {calling ? 'Calling...' : selectedIds.size > 0 ? `Call ${selectedIds.size} Selected` : `Call All (${leads.length})`}
            </button>
          </div>

          {ttsResult && (
            <div className={`mt-4 p-4 rounded-lg ${ttsResult.error ? 'bg-red-900/50 text-red-300' : 'bg-purple-900/50 text-purple-300'}`}>
              {ttsResult.error || (ttsResult.mock ? 'ElevenLabs not configured — TTS preview is mocked' : 'TTS audio generated successfully')}
            </div>
          )}

          {result && (
            <div className={`mt-4 p-4 rounded-lg ${result.error ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {result.error || `Called ${result.called} leads${result.mock ? ' (mock mode)' : ''}`}
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
