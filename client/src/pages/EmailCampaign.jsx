import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import AIScriptBox from '../components/AIScriptBox';

const EMAIL_FIELDS = [
  { label: '{business_name}', value: '{business_name}' },
  { label: '{city}', value: '{city}' },
  { label: '{state}', value: '{state}' },
  { label: '{keyword}', value: '{keyword}' },
  { label: '{email}', value: '{email}' },
  { label: '{phone}', value: '{phone}' },
];

const EMAIL_SNIPPETS = [
  { label: '<br>', value: '<br>' },
  { label: '<b>bold</b>', value: '<b>text</b>' },
  { label: '<p>para</p>', value: '<p>Your text here</p>' },
  { label: 'unsubscribe link', value: '<a href="{unsubscribe_url}">Unsubscribe</a>' },
];

export default function EmailCampaign() {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leads, setLeads] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState(null);
  const [senders, setSenders] = useState([]);
  const [selectedSenderId, setSelectedSenderId] = useState('');
  const [allLeads, setAllLeads] = useState([]);
  const [scrapes, setScrapes] = useState([]);
  const [selectedScrapeId, setSelectedScrapeId] = useState('');
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);

  const filterByScrape = (scrapeId, all) => scrapeId ? all.filter(l => String(l.scrape_id) === String(scrapeId)) : all;

  const insertIntoField = (ref, setter, text) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const current = ta.value;
    const newVal = current.substring(0, start) + text + current.substring(end);
    setter(newVal);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
  };

  const loadTemplates = () => apiFetch('/email-templates').then(setTemplates).catch(() => {});

  useEffect(() => {
    apiFetch('/leads?limit=2000').then(data => { const w = data.leads.filter(l => l.email); setAllLeads(w); setLeads(w); }).catch(console.error);
    apiFetch('/scrapes').then(setScrapes).catch(() => {});
    loadTemplates();
    apiFetch('/email-senders').then(data => {
      setSenders(data);
      const role = localStorage.getItem('gls_role') || 'admin';
      const user = (() => { try { return JSON.parse(localStorage.getItem('gls_user') || 'null'); } catch { return null; } })();
      if (role === 'salesperson' && user?.email) {
        // Auto-select salesperson's own email sender
        const mySender = data.find(s => s.email === user.email);
        if (mySender) setSelectedSenderId(String(mySender.id));
      } else {
        const def = data.find(s => s.is_default);
        if (def) setSelectedSenderId(String(def.id));
      }
    }).catch(()=>{});
  }, []);

  const handleTemplateSelect = (id) => {
    setSelectedTemplateId(id);
    if (!id) return;
    const t = templates.find(t => String(t.id) === id);
    if (t) { setSubject(t.subject); setBody(t.body); setTemplateName(t.name); }
  };

  const handleSaveTemplate = async () => {
    if (!templateName || !subject || !body) return setTemplateMsg({ type:'error', text:'Name, subject, and body required' });
    setSavingTemplate(true);
    try {
      if (selectedTemplateId) {
        await apiFetch(`/email-templates/${selectedTemplateId}`, { method:'PATCH', body: JSON.stringify({ name:templateName, subject, body }) });
        setTemplateMsg({ type:'success', text:'Template updated' });
      } else {
        const t = await apiFetch('/email-templates', { method:'POST', body: JSON.stringify({ name:templateName, subject, body }) });
        setSelectedTemplateId(String(t.id));
        setTemplateMsg({ type:'success', text:'Template saved' });
      }
      loadTemplates();
    } catch(err) { setTemplateMsg({ type:'error', text:err.message }); }
    finally { setSavingTemplate(false); }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId || !window.confirm('Delete this template?')) return;
    await apiFetch(`/email-templates/${selectedTemplateId}`, { method:'DELETE' });
    setSelectedTemplateId(''); setTemplateName(''); setSubject(''); setBody('');
    loadTemplates();
  };

  const handleSend = async () => {
    setSending(true); setResult(null);
    try {
      const role = localStorage.getItem('gls_role') || 'admin';
      const user = (() => { try { return JSON.parse(localStorage.getItem('gls_user') || 'null'); } catch { return null; } })();
      const replyToEmail = (role === 'salesperson' && user?.email) ? user.email : undefined;
      const data = await apiFetch('/email/send', { method:'POST', body: JSON.stringify({ subject, body, leadIds: selectedIds.size > 0 ? [...selectedIds] : undefined, senderId: selectedSenderId || undefined, replyToEmail }) });
      setResult(data);
    } catch(err) { setResult({ error: err.message }); }
    finally { setSending(false); }
  };

  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => { if(selectedIds.size===leads.length) setSelectedIds(new Set()); else setSelectedIds(new Set(leads.map(l=>l.id))); };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Email Campaign</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white">Compose Email</h3>
          <p className="text-xs text-gray-500">Placeholders: {'{business_name}'} {'{city}'} {'{state}'} {'{keyword}'}</p>

          {/* From sender */}
          {senders.length > 0 && (() => {
            const role = localStorage.getItem('gls_role') || 'admin';
            const user = (() => { try { return JSON.parse(localStorage.getItem('gls_user') || 'null'); } catch { return null; } })();
            const isSalesperson = role === 'salesperson';
            const visibleSenders = isSalesperson && user?.email
              ? senders.filter(s => s.email === user.email)
              : senders;
            return (
              <div>
                <label className="block text-xs text-gray-400 mb-1">From {isSalesperson && <span className="text-gray-600">(your email)</span>}</label>
                <select value={selectedSenderId} onChange={e => !isSalesperson && setSelectedSenderId(e.target.value)}
                  disabled={isSalesperson}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-70">
                  <option value="">Use SMTP default</option>
                  {visibleSenders.map(s=><option key={s.id} value={String(s.id)}>{s.label} — {s.email}</option>)}
                </select>
              </div>
            );
          })()}

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

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-gray-400">Subject</label>
              <div className="flex gap-1">
                {EMAIL_FIELDS.slice(0,4).map(f => (
                  <button key={f.value} onClick={() => insertIntoField(subjectRef, setSubject, f.value)}
                    className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs font-mono transition-colors">{f.label}</button>
                ))}
              </div>
            </div>
            <input ref={subjectRef} value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Grow your {business_name} with our services" className={inp} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Body (HTML)</label>
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="text-xs text-gray-500 self-center">Fields:</span>
              {EMAIL_FIELDS.map(f => (
                <button key={f.value} onClick={() => insertIntoField(bodyRef, setBody, f.value)}
                  className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs font-mono transition-colors">{f.label}</button>
              ))}
              <span className="text-xs text-gray-600 mx-1">|</span>
              <span className="text-xs text-gray-500 self-center">HTML:</span>
              {EMAIL_SNIPPETS.map(s => (
                <button key={s.label} onClick={() => insertIntoField(bodyRef, setBody, s.value)}
                  className="px-1.5 py-0.5 bg-indigo-900/50 hover:bg-indigo-800/50 text-indigo-300 rounded text-xs font-mono transition-colors">{s.label}</button>
              ))}
            </div>
            <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={8}
              placeholder="<p>Hi {business_name},</p><p>We help businesses in {city}, {state}...</p>"
              className={`${inp} font-mono text-sm resize-none`} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowPreview(!showPreview)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors">
              {showPreview ? 'Hide Preview' : 'Preview'}
            </button>
            <button onClick={handleSend} disabled={sending || !subject || !body}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {sending ? 'Sending...' : selectedIds.size > 0 ? `Send to ${selectedIds.size} Selected` : `Send to All (${leads.length})`}
            </button>
          </div>

          {showPreview && (
            <div className="p-4 bg-gray-800 rounded-lg">
              <p className="text-xs text-gray-500 mb-2">Preview (sample data):</p>
              <p className="text-sm text-gray-300 mb-2"><strong>Subject:</strong> {subject.replace(/{business_name}/g,'Acme Plumbing').replace(/{city}/g,'Austin').replace(/{state}/g,'TX')}</p>
              <div className="text-sm text-gray-300 border-t border-gray-700 pt-2" dangerouslySetInnerHTML={{ __html: body.replace(/{business_name}/g,'Acme Plumbing').replace(/{city}/g,'Austin').replace(/{state}/g,'TX') }} />
            </div>
          )}
          {/* AI Script Generator */}
          <AIScriptBox type="email" onGenerated={b => setBody(b)} placeholder='e.g. "Professional follow-up for roofing companies, mention storm damage"' />

          {result && (
            <div className={`p-4 rounded-lg text-sm ${result.error ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {result.error || `✅ Sent ${result.sent} of ${result.total} email(s)${result.mock ? ' (mock mode)' : ''}`}
            </div>
          )}
        </div>

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
                <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded bg-gray-800 border-gray-600" />
                <div>
                  <p className="text-sm text-white">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.email}</p>
                </div>
              </label>
            ))}
            {leads.length === 0 && <p className="text-gray-500 text-sm p-4">No leads with email addresses.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
