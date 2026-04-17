import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import AIScriptBox from '../components/AIScriptBox';

const FIELDS = [
  { label: 'Company Name', value: '{company_name}' },
  { label: 'City', value: '{city}' },
  { label: 'State', value: '{state}' },
  { label: 'Keyword', value: '{keyword}' },
  { label: 'Phone', value: '{phone}' },
  { label: 'Email', value: '{email}' },
];

export default function VoiceMessage() {
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const textareaRef = useRef(null);

  const load = () => apiFetch('/voice-scripts').then(setScripts).catch(() => {});
  useEffect(() => { load(); }, []);

  const insertField = (field) => {
    const ta = textareaRef.current;
    if (!ta) { setScript(s => s + field); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newScript = script.substring(0, start) + field + script.substring(end);
    setScript(newScript);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + field.length; ta.focus(); }, 0);
  };

  const selectScript = (s) => {
    setSelected(s);
    setName(s.name);
    setScript(s.script);
    setAudioUrl(null);
    setMsg(null);
  };

  const handleNew = () => {
    setSelected(null);
    setName('');
    setScript('Hello {company_name}, this is a call from our team. We noticed your business in {city}, {state} and would love to connect.');
    setAudioUrl(null);
    setMsg(null);
  };

  const handleSave = async () => {
    if (!name || !script) return;
    setSaving(true);
    try {
      if (selected) {
        await apiFetch(`/voice-scripts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name, script }) });
        setMsg({ type: 'success', text: 'Script updated' });
      } else {
        const created = await apiFetch('/voice-scripts', { method: 'POST', body: JSON.stringify({ name, script }) });
        setSelected(created);
        setMsg({ type: 'success', text: 'Script saved' });
      }
      load();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(false); }
  };

  const handleActivate = async () => {
    if (!selected) return;
    await apiFetch(`/voice-scripts/${selected.id}/activate`, { method: 'POST' });
    setMsg({ type: 'success', text: 'Script set as active — will be used for outbound calls' });
    load();
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm('Delete this script?')) return;
    await apiFetch(`/voice-scripts/${selected.id}`, { method: 'DELETE' });
    setSelected(null); setName(''); setScript('');
    load();
  };

  const handlePreview = async () => {
    setTtsLoading(true);
    setAudioUrl(null);
    try {
      const sample = script
        .replace(/{company_name}/g, 'Acme Plumbing').replace(/{business_name}/g, 'Acme Plumbing')
        .replace(/{city}/g, 'Austin').replace(/{state}/g, 'TX')
        .replace(/{keyword}/g, 'plumber').replace(/{phone}/g, '555-123-4567')
        .replace(/{email}/g, 'info@acmeplumbing.com');
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/calls/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text: sample }),
      });
      if (!resp.ok) { const j = await resp.json(); throw new Error(j.error || j.message || 'TTS error'); }
      const blob = await resp.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setTtsLoading(false); }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Voice Message Builder</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Script List */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Saved Scripts</h3>
            <button onClick={handleNew} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors">+ New</button>
          </div>
          <div className="space-y-2">
            {scripts.length === 0 && <p className="text-gray-600 text-sm text-center py-4">No scripts yet</p>}
            {scripts.map(s => (
              <button key={s.id} onClick={() => selectScript(s)}
                className={`w-full text-left px-3 py-3 rounded-lg transition-colors ${selected?.id === s.id ? 'bg-blue-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  {s.is_active ? <span className="text-xs bg-green-700 text-green-200 px-1.5 py-0.5 rounded ml-2 shrink-0">Active</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">Script Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Outreach Script"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div className="mb-3">
            <label className="block text-xs text-gray-400 mb-2">Insert Data Fields</label>
            <div className="flex flex-wrap gap-2">
              {FIELDS.map(f => (
                <button key={f.value} onClick={() => insertField(f.value)}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs transition-colors font-mono">
                  {f.value}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">Script Text</label>
            <textarea ref={textareaRef} value={script} onChange={e => setScript(e.target.value)} rows={8}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none" />
            <p className="text-xs text-gray-600 mt-1">After the script plays, callers hear: "Press 1 to speak to staff · Press 2 for callback · Press 3 to schedule meeting · Press 4 to unsubscribe"</p>
          </div>

          {/* AI Script Generator */}
          <AIScriptBox type="voice" onGenerated={s => { setScript(s); setSelected(null); }} placeholder='e.g. "Warm intro for HVAC companies in the South, mention summer deals"' />

          {msg && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${msg.type === 'error' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {msg.text}
            </div>
          )}

          {audioUrl && (
            <div className="mb-4 p-3 bg-gray-800 rounded-lg">
              <p className="text-xs text-gray-400 mb-2">TTS Preview (sample data: Acme Plumbing, Austin TX):</p>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={handleSave} disabled={saving || !name || !script}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : selected ? 'Update Script' : 'Save Script'}
            </button>
            {selected && !selected.is_active && (
              <button onClick={handleActivate} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-colors">
                ✓ Set as Active
              </button>
            )}
            <button onClick={handlePreview} disabled={ttsLoading || !script}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50">
              {ttsLoading ? 'Generating...' : '🔊 Preview TTS'}
            </button>
            {selected && (
              <button onClick={handleDelete} className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-lg text-sm transition-colors">
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
