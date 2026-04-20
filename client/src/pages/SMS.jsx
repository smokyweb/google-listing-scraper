import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import AIScriptBox from '../components/AIScriptBox';

const SMS_FIELDS = [
  { label: '{business_name}', value: '{business_name}' },
  { label: '{city}', value: '{city}' },
  { label: '{state}', value: '{state}' },
  { label: '{keyword}', value: '{keyword}' },
  { label: '{phone}', value: '{phone}' },
];

export default function SMS() {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [message, setMessage] = useState('Hi {business_name}! We noticed your listing in {city}, {state} and would love to help grow your business. Book a free consultation: https://your-scheduling-link.com');
  const [leads, setLeads] = useState([]);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState(null);
  const msgRef = useRef(null);

  const insertField = (text) => {
    const ta = msgRef.current;
    if (!ta) { setMessage(m => m + text); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const newMsg = message.substring(0, start) + text + message.substring(end);
    setMessage(newMsg);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
  };

  const loadTemplates = () => apiFetch('/sms-templates').then(setTemplates).catch(() => {});

  useEffect(() => {
    apiFetch('/leads?limit=500').then(data => setLeads(data.leads.filter(l => l.phone))).catch(console.error);
    apiFetch('/phone-numbers').then(data => { setPhoneNumbers(data); const def = data.find(n=>n.is_default); if(def) setSelectedPhoneId(String(def.id)); }).catch(console.error);
    loadTemplates();
  }, []);

  const handleTemplateSelect = (id) => {
    setSelectedTemplateId(id);
    if (!id) return;
    const t = templates.find(t => String(t.id) === id);
    if (t) { setMessage(t.message); setTemplateName(t.name); }
  };

  const handleSaveTemplate = async () => {
    if (!templateName || !message) return setTemplateMsg({ type:'error', text:'Name and message required' });
    setSavingTemplate(true);
    try {
      if (selectedTemplateId) {
        await apiFetch(`/sms-templates/${selectedTemplateId}`, { method:'PATCH', body: JSON.stringify({ name:templateName, message }) });
        setTemplateMsg({ type:'success', text:'Template updated' });
      } else {
        const t = await apiFetch('/sms-templates', { method:'POST', body: JSON.stringify({ name:templateName, message }) });
        setSelectedTemplateId(String(t.id));
        setTemplateMsg({ type:'success', text:'Template saved' });
      }
      loadTemplates();
    } catch(err) { setTemplateMsg({ type:'error', text:err.message }); }
    finally { setSavingTemplate(false); }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId || !window.confirm('Delete this template?')) return;
    await apiFetch(`/sms-templates/${selectedTemplateId}`, { method:'DELETE' });
    setSelectedTemplateId(''); setTemplateName('');
    loadTemplates();
  };

  const handleSend = async () => {
    setSending(true); setResult(null);
    try {
      const data = await apiFetch('/sms/send', { method:'POST', body: JSON.stringify({ message, leadIds: selectedIds.size > 0 ? [...selectedIds] : undefined, phoneNumberId: selectedPhoneId ? parseInt(selectedPhoneId) : undefined }) });
      setResult(data);
    } catch(err) { setResult({ error: err.message }); }
    finally { setSending(false); }
  };

  const toggleSelect = (id) => setSelectedIds(prev => { const n=new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => { if(selectedIds.size===leads.length) setSelectedIds(new Set()); else setSelectedIds(new Set(leads.map(l=>l.id))); };
  const preview = message.replace(/{business_name}/g,'Acme Plumbing').replace(/{city}/g,'Austin').replace(/{state}/g,'TX');
  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">SMS</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white">Compose SMS</h3>
          <p className="text-xs text-gray-500">Placeholders: {'{business_name}'} {'{city}'} {'{state}'}</p>

          {/* Template management */}
          <div className="bg-gray-800/60 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <select value={selectedTemplateId} onChange={e => handleTemplateSelect(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="">— Select saved template —</option>
                {templates.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </select>
              {selectedTemplateId && <button onClick={handleDeleteTemplate} className="text-xs text-red-400 hover:text-red-300 whitespace-nowrap">Delete</button>}
            </div>
            <div className="flex gap-2">
              <input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Template name..." className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
              <button onClick={handleSaveTemplate} disabled={savingTemplate} className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm whitespace-nowrap disabled:opacity-50">
                {savingTemplate ? '...' : selectedTemplateId ? 'Update' : 'Save'}
              </button>
            </div>
            {templateMsg && <p className={`text-xs ${templateMsg.type==='error' ? 'text-red-400' : 'text-green-400'}`}>{templateMsg.text}</p>}
          </div>

          {phoneNumbers.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Sending From</label>
              <select value={selectedPhoneId} onChange={e => setSelectedPhoneId(e.target.value)} className={inp}>
                <option value="">Use default number</option>
                {phoneNumbers.map(n => <option key={n.id} value={String(n.id)}>{n.label} — {n.number}{n.is_default ? ' (default)' : ''}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Message</label>
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="text-xs text-gray-500 self-center">Insert:</span>
              {SMS_FIELDS.map(f => (
                <button key={f.value} onClick={() => insertField(f.value)}
                  className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs font-mono transition-colors">{f.label}</button>
              ))}
            </div>
            <textarea ref={msgRef} value={message} onChange={e => setMessage(e.target.value)} rows={4} className={`${inp} resize-none`} />
          </div>

          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Preview:</p>
            <p className="text-sm text-gray-300">{preview}</p>
            <p className="text-xs text-gray-500 mt-1">{preview.length}/160 characters</p>
          </div>

          <button onClick={handleSend} disabled={sending || !message}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {sending ? 'Sending...' : selectedIds.size > 0 ? `Send to ${selectedIds.size} Selected` : `Send to All (${leads.length})`}
          </button>

          {/* AI Script Generator */}
          <AIScriptBox type="sms" onGenerated={m => setMessage(m)} placeholder='e.g. "Short text for electricians with a scheduling link"' />

          {result && (
            <div className={`p-4 rounded-lg text-sm ${result.error ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {result.error || `✅ Sent ${result.sent} of ${result.total} SMS${result.mock ? ' (mock mode)' : ''}`}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Recipients ({leads.length} with phone)</h3>
            {leads.length > 0 && <button onClick={toggleAll} className="text-xs text-blue-400 hover:text-blue-300">{selectedIds.size===leads.length ? 'Deselect all' : 'Select all'}</button>}
          </div>
          <div className="max-h-[500px] overflow-y-auto space-y-1">
            {leads.map(lead => (
              <label key={lead.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800 rounded-lg cursor-pointer">
                <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded bg-gray-800 border-gray-600" />
                <div>
                  <p className="text-sm text-white">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.phone}</p>
                </div>
              </label>
            ))}
            {leads.length === 0 && <p className="text-gray-500 text-sm p-4">No leads with phone numbers.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
