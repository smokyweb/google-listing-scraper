import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';

const FIELDS = [
  { label: 'Company Name', value: '{company_name}' },
  { label: 'City', value: '{city}' },
  { label: 'State', value: '{state}' },
  { label: 'Keyword', value: '{keyword}' },
];

export default function VoicemailDrop() {
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const textareaRef = useRef(null);

  const load = () => apiFetch('/voice-scripts').then(data => {
    // Filter for voicemail scripts (we'll tag them by name prefix)
    setScripts(data.filter(s => s.name.startsWith('[VM]') || s.voicemail_type));
    // Actually show all and let admin label them
    setScripts(data);
  }).catch(() => {});

  useEffect(() => { load(); }, []);

  const insertField = (field) => {
    const ta = textareaRef.current;
    if (!ta) { setScript(s => s + field); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const newScript = script.substring(0, start) + field + script.substring(end);
    setScript(newScript);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + field.length; ta.focus(); }, 0);
  };

  const selectScript = (s) => { setSelected(s); setName(s.name); setScript(s.script); setAudioUrl(null); setMsg(null); };
  const handleNew = () => { setSelected(null); setName('[Voicemail] '); setScript('Hi, this is a message for {company_name} in {city}, {state}. I wanted to reach out about an exciting opportunity for your business. Please call us back at your earliest convenience. Thank you and have a great day.'); setAudioUrl(null); setMsg(null); };

  const handleSave = async () => {
    if (!name || !script) return;
    setSaving(true);
    try {
      if (selected) {
        await apiFetch(`/voice-scripts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name, script }) });
        setMsg({ type: 'success', text: 'Voicemail script updated' });
      } else {
        const created = await apiFetch('/voice-scripts', { method: 'POST', body: JSON.stringify({ name, script }) });
        setSelected(created);
        setMsg({ type: 'success', text: 'Voicemail script saved' });
      }
      load();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm('Delete this voicemail script?')) return;
    await apiFetch(`/voice-scripts/${selected.id}`, { method: 'DELETE' });
    setSelected(null); setName(''); setScript('');
    load();
  };

  const handlePreview = async () => {
    setTtsLoading(true); setAudioUrl(null);
    try {
      const sample = script
        .replace(/{company_name}/g, 'Acme Plumbing').replace(/{city}/g, 'Austin')
        .replace(/{state}/g, 'TX').replace(/{keyword}/g, 'plumber');
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/calls/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text: sample }),
      });
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || `Error ${resp.status}`); }
      const blob = await resp.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    finally { setTtsLoading(false); }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Voicemail Drop</h2>
      <p className="text-gray-400 text-sm mb-6">Write the message that will be left as a voicemail when a call goes unanswered. The script plays after the beep using ElevenLabs voice.</p>

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
                <span className="text-sm font-medium truncate block">{s.name}</span>
                {s.is_active && <span className="text-xs text-green-400">Active (outbound)</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="bg-blue-900/30 border border-blue-800/50 rounded-lg p-3 text-sm text-blue-300">
            💡 When an outbound call goes to voicemail (no input from caller after IVR menu), this script plays after the beep. Use it to introduce your business and ask them to call back.
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Script Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. [Voicemail] General Outreach"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-2">Insert Data Fields</label>
            <div className="flex flex-wrap gap-2">
              {FIELDS.map(f => (
                <button key={f.value} onClick={() => insertField(f.value)}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-mono transition-colors">{f.value}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Voicemail Script</label>
            <textarea ref={textareaRef} value={script} onChange={e => setScript(e.target.value)} rows={8}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
            <p className="text-xs text-gray-600 mt-1">Keep it under 30 seconds (~75 words). Be clear about who you are and why you're calling.</p>
          </div>

          {msg && <div className={`px-4 py-3 rounded-lg text-sm ${msg.type==='error' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>{msg.text}</div>}

          {audioUrl && (
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-2">Preview (Adam's voice, sample data):</p>
              <audio controls src={audioUrl} className="w-full" />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={handleSave} disabled={saving || !name || !script}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : selected ? 'Update Script' : 'Save Script'}
            </button>
            <button onClick={handlePreview} disabled={ttsLoading || !script}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50">
              {ttsLoading ? 'Generating...' : '🔊 Preview Voice'}
            </button>
            {selected && (
              <button onClick={handleDelete} className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-lg text-sm transition-colors">Delete</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
