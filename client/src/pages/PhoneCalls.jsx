import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import AIScriptBox from '../components/AIScriptBox';

const PAUSE_OPTIONS = [
  { label: 'Short pause', insert: ',' },
  { label: 'Sentence pause', insert: '.' },
  { label: 'Long pause ...', insert: '...' },
  { label: '1s break', insert: '<break time="1s" />' },
  { label: '2s break', insert: '<break time="2s" />' },
  { label: 'Em dash —', insert: ' — ' },
];

export default function PhoneCalls() {
  const [voiceScripts, setVoiceScripts] = useState([]);
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [script, setScript] = useState('Hello {business_name}, this is a courtesy call regarding your business listing in {city}, {state}. We have some exciting opportunities to help grow your online presence.');
  const [allLeads, setAllLeads] = useState([]);
  const [leads, setLeads] = useState([]);
  const [scrapes, setScrapes] = useState([]);
  const [selectedScrapeId, setSelectedScrapeId] = useState('');
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());

  const filterByScrape = (scrapeId, all) => scrapeId ? all.filter(l => String(l.scrape_id) === String(scrapeId)) : all;
  const [calling, setCalling] = useState(false);
  const [callDelay, setCallDelay] = useState(5);
  const [result, setResult] = useState(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const selectAllRef = useRef(null);
  const scriptRef = useRef(null);

  const insertAtCursor = (text) => {
    const ta = scriptRef.current;
    if (!ta) { setScript(s => s + text); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const newScript = script.substring(0, start) + text + script.substring(end);
    setScript(newScript);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
  };

  useEffect(() => {
    apiFetch('/leads?limit=2000')
      .then(data => { const w = data.leads.filter(l => l.phone); setAllLeads(w); setLeads(w); })
      .catch(console.error);
    apiFetch('/scrapes').then(setScrapes).catch(() => {});
    apiFetch('/phone-numbers')
      .then(data => {
        setPhoneNumbers(data);
        const def = data.find(n => n.is_default);
        if (def) setSelectedPhoneId(String(def.id));
      })
      .catch(console.error);
    apiFetch('/voice-scripts')
      .then(data => {
        setVoiceScripts(data);
        const active = data.find(s => s.is_active);
        if (active) { setSelectedScriptId(String(active.id)); setScript(active.script); }
      })
      .catch(console.error);
  }, []);

  const handleScriptChange = (id) => {
    setSelectedScriptId(id);
    if (!id) return;
    const found = voiceScripts.find(s => String(s.id) === id);
    if (found) setScript(found.script);
  };

  const handleTTSPreview = async () => {
    setTtsLoading(true);
    setAudioUrl(null);
    try {
      const previewText = script
        .replace(/{business_name}/g, 'Acme Plumbing').replace(/{company_name}/g, 'Acme Plumbing')
        .replace(/{city}/g, 'Austin').replace(/{state}/g, 'TX')
        .replace(/{keyword}/g, 'plumber').replace(/{phone}/g, '555-1234').replace(/{email}/g, 'info@acme.com');
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/calls/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text: previewText }),
      });
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `Error ${resp.status}`); }
      const blob = await resp.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setResult({ error: `TTS error: ${err.message}` });
    } finally { setTtsLoading(false); }
  };

  const handleTrigger = async () => {
    setCalling(true);
    setResult(null);
    setAudioUrl(null);
    try {
      const data = await apiFetch('/calls/trigger', {
        method: 'POST',
        body: JSON.stringify({
          script,
          leadIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
          phoneNumberId: selectedPhoneId ? parseInt(selectedPhoneId) : undefined,
          callDelay: callDelay,
        }),
      });
      setResult(data);
    } catch (err) {
      setResult({ error: err.message });
    } finally { setCalling(false); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map(l => l.id)));
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Phone Calls</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left — Script + Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white">Call Script</h3>

          {/* Script selector */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Select Saved Script</label>
            <select value={selectedScriptId} onChange={e => handleScriptChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="">— Custom script —</option>
              {voiceScripts.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}{s.is_active ? ' ✓ (active)' : ''}
                </option>
              ))}
            </select>
            {voiceScripts.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">No scripts saved yet — create them in Voice Message page.</p>
            )}
          </div>

          {/* Phone number */}
          {phoneNumbers.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Calling From</label>
              <select value={selectedPhoneId} onChange={e => setSelectedPhoneId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">Use default number</option>
                {phoneNumbers.map(n => (
                  <option key={n.id} value={String(n.id)}>{n.label} — {n.number}{n.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Script editor */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Script Text <span className="text-gray-600">(edit or write custom)</span></label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-xs text-gray-500 self-center">Fields:</span>
              {['{business_name}','{city}','{state}','{keyword}','{phone}','{email}'].map(f => (
                <button key={f} onClick={() => insertAtCursor(f)}
                  className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs font-mono transition-colors">{f}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-xs text-gray-500 self-center">Pauses:</span>
              {PAUSE_OPTIONS.map(p => (
                <button key={p.label} onClick={() => insertAtCursor(p.insert)}
                  className="px-2 py-0.5 bg-indigo-900/60 hover:bg-indigo-800/60 text-indigo-300 border border-indigo-700/50 rounded text-xs transition-colors">{p.label}</button>
              ))}
            </div>
            <textarea ref={scriptRef} value={script} onChange={e => { setScript(e.target.value); setSelectedScriptId(''); }} rows={6}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          {/* AI Script Generator */}
          <AIScriptBox type="call" onGenerated={s => { setScript(s); setSelectedScriptId(''); }} placeholder='e.g. "Friendly outreach for plumbers in Austin Texas"' />

          {/* Call delay */}
          <div className="flex items-center gap-3 p-3 bg-gray-800/60 rounded-lg">
            <span className="text-xs text-gray-400 shrink-0">Delay between calls:</span>
            <select value={callDelay} onChange={e => setCallDelay(Number(e.target.value))}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-blue-500">
              <option value={0}>No delay (fastest)</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
            </select>
            <span className="text-xs text-gray-600">Longer delays reduce spam flags</span>
          </div>

          {/* IVR info */}
          <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400 space-y-1">
            <p className="font-medium text-gray-300">After script plays, caller hears:</p>
            <p>Press 1 → Transfer to staff</p>
            <p>Press 2 → Request callback (logged in Call Backs)</p>
            <p>Press 3 → Schedule Google Meet</p>
            <p>Press 4 → Unsubscribe</p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={handleTTSPreview} disabled={ttsLoading || !script}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50">
              {ttsLoading ? 'Generating...' : '🔊 TTS Preview'}
            </button>
            <button onClick={handleTrigger} disabled={calling || !script}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {calling ? 'Calling...' : selectedIds.size > 0 ? `📞 Call ${selectedIds.size} Selected` : `📞 Call All (${leads.length})`}
            </button>
          </div>

          {audioUrl && (
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-2">TTS Preview (sample data):</p>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}

          {result && (
            <div className={`p-4 rounded-lg text-sm ${result.error ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {result.error
                ? result.error
                : `✅ Called ${result.called} of ${result.total} lead(s)${result.mock ? ' (mock mode — SignalWire not configured)' : ''}`}
              {result.errors && result.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-300 space-y-1">
                  <p className="font-medium">Errors:</p>
                  {result.errors.map((e, i) => <p key={i}>• {e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — Lead selection */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-white">Recipients ({leads.length})</h3>
            {leads.length > 0 && <button onClick={toggleAll} className="text-xs text-blue-400 hover:text-blue-300">{selectedIds.size===leads.length ? 'Deselect all' : 'Select all'}</button>}
          </div>
          <div className="mb-3">
            <select value={selectedScrapeId} onChange={e => { setSelectedScrapeId(e.target.value); setLeads(filterByScrape(e.target.value, allLeads)); setSelectedIds(new Set()); }}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="">All scrapes ({allLeads.length} leads)</option>
              {scrapes.map(s => <option key={s.id} value={String(s.id)}>{s.name} ({allLeads.filter(l=>String(l.scrape_id)===String(s.id)).length})</option>)}
            </select>
          </div>
          <div className="max-h-[500px] overflow-y-auto space-y-1">
            {leads.map(lead => (
              <label key={lead.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 rounded-lg cursor-pointer">
                <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)}
                  className="rounded bg-gray-800 border-gray-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.phone}</p>
                </div>
                {lead.source === 'manual' && <span className="text-xs text-purple-400 shrink-0">manual</span>}
              </label>
            ))}
            {leads.length === 0 && <p className="text-gray-500 text-sm p-4 text-center">No leads with phone numbers yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
