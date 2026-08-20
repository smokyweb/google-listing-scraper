import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import LeadsTable from '../components/LeadsTable';
import EditLeadModal from '../components/EditLeadModal';
import VoiceDropModal from '../components/VoiceDropModal';

// ─── Add Lead Modal ───────────────────────────────────────────────────────────

function AddLeadModal({ scrapes, onClose, onSaved }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', company: '',
    phone: '', email: '', website: '', address: '',
    city: '', state: '', keyword: '', scrape_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handle = async (e) => {
    e.preventDefault();
    if (!form.first_name && !form.last_name) return setErr('First Name or Last Name is required');
    setSaving(true);
    try {
      await apiFetch('/leads', {
        method: 'POST',
        body: JSON.stringify({ ...form, scrape_id: form.scrape_id || null }),
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  const f   = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Add Lead Manually</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
        <form onSubmit={handle} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-400">First Name *</label><input value={form.first_name} onChange={f('first_name')} required className={inp} /></div>
            <div><label className="text-xs text-gray-400">Last Name *</label><input value={form.last_name} onChange={f('last_name')} required className={inp} /></div>
            <div className="col-span-2"><label className="text-xs text-gray-400">Company</label><input value={form.company} onChange={f('company')} className={inp} placeholder="Optional" /></div>
            <div><label className="text-xs text-gray-400">Phone</label><input value={form.phone} onChange={f('phone')} className={inp} /></div>
            <div><label className="text-xs text-gray-400">Email</label><input value={form.email} onChange={f('email')} type="email" className={inp} /></div>
            <div className="col-span-2"><label className="text-xs text-gray-400">Website</label><input value={form.website} onChange={f('website')} className={inp} /></div>
            <div className="col-span-2"><label className="text-xs text-gray-400">Address</label><input value={form.address} onChange={f('address')} className={inp} /></div>
            <div><label className="text-xs text-gray-400">City</label><input value={form.city} onChange={f('city')} className={inp} /></div>
            <div><label className="text-xs text-gray-400">State</label><input value={form.state} onChange={f('state')} className={inp} /></div>
            <div><label className="text-xs text-gray-400">Keyword</label><input value={form.keyword} onChange={f('keyword')} className={inp} /></div>
            <div>
              <label className="text-xs text-gray-400">Assign to Scrape</label>
              <select value={form.scrape_id} onChange={f('scrape_id')} className={inp}>
                <option value="">None (manual)</option>
                {scrapes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : 'Add Lead'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Leads Page ──────────────────────────────────────────────────────────

export default function Leads() {
  // Role — read from localStorage (set at login, same approach as App.jsx).
  const role    = localStorage.getItem('gls_role') || 'admin';
  const isAdmin = role === 'admin';

  const [leads,              setLeads]              = useState([]);
  const [total,              setTotal]              = useState(0);
  const [page,               setPage]               = useState(1);
  const [pages,              setPages]              = useState(1);
  const [search,             setSearch]             = useState('');
  const [scrapes,            setScrapes]            = useState([]);
  const [salesUsers,         setSalesUsers]         = useState([]);
  const [leadSourceFilter,   setLeadSourceFilter]   = useState(''); // '' | scraped | manual | scrape:<id>
  const [salespersonFilter,  setSalespersonFilter]  = useState(''); // '' | 'unassigned' | '<id>'
  const [loading,            setLoading]            = useState(true);
  const [selectedIds,        setSelectedIds]        = useState(new Set());
  const [editLead,           setEditLead]           = useState(null);
  const [callLead,           setCallLead]           = useState(null);
  const [smsLead,            setSmsLead]            = useState(null);
  const [emailLead,          setEmailLead]          = useState(null);
  const [showAddModal,       setShowAddModal]       = useState(false);

  // Voice Drop state
  const [liveVoiceScripts, setLiveVoiceScripts] = useState([]);
  const [voicemailScripts, setVoicemailScripts] = useState([]);
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [voiceScript,      setVoiceScript]      = useState('');
  const [voiceDropLead,    setVoiceDropLead]    = useState(null);
  const [voiceDropMode,    setVoiceDropMode]    = useState('voicemail');
  const [voiceDropOpen,    setVoiceDropOpen]    = useState(false);

  const navigate = useNavigate();

  // ── fetch sales users list (admin only) ────────────────────────────────────
  useEffect(() => {
    if (isAdmin) {
      apiFetch('/sales-users').then(setSalesUsers).catch(() => setSalesUsers([]));
    }
  }, [isAdmin]);

  // ── fetch scrapes list ─────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/scrapes').then(data => setScrapes(data)).catch(() => {});
  }, []);

  // ── fetch voice scripts ────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch('/voice-scripts?mode=live'),
      apiFetch('/voice-scripts?mode=voicemail'),
    ]).then(([live, voicemail]) => {
      setLiveVoiceScripts(live);
      setVoicemailScripts(voicemail);
      const active = (voiceDropMode === 'voicemail' ? voicemail : live).find(s => s.is_active);
      if (active) {
        setSelectedScriptId(String(active.id));
        setVoiceScript(active.script);
      }
    }).catch(console.error);
  }, []);

  // ── open voice drop modal ──────────────────────────────────────────────────
  const openVoiceDrop = useCallback((lead, mode) => {
    setVoiceDropLead(lead);
    setVoiceDropMode(mode);
    const scripts = mode === 'voicemail' ? voicemailScripts : liveVoiceScripts;
    const active = scripts.find(s => s.is_active) || scripts[0];
    setSelectedScriptId(active ? String(active.id) : '');
    setVoiceScript(active?.script || '');
    setVoiceDropOpen(true);
  }, [liveVoiceScripts, voicemailScripts]);

  // ── fetch leads ────────────────────────────────────────────────────────────
  const fetchLeads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (search)            params.set('search',       search);
      if (leadSourceFilter === 'manual') params.set('source', 'manual');
      if (leadSourceFilter === 'scraped') params.set('source', 'scraped');
      if (leadSourceFilter.startsWith('scrape:')) params.set('scrape_id', leadSourceFilter.slice(7));
      // Admin-only: pass salesperson filter to backend
      if (isAdmin && salespersonFilter !== '') {
        params.set('salesperson_id', salespersonFilter);
      }
      const data = await apiFetch(`/leads?${params}`);
      setLeads(data.leads);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(); }, [page, search, leadSourceFilter, salespersonFilter]);

  // ── status / notes helpers ─────────────────────────────────────────────────
  const updateStatus = async (id, status) => {
    await apiFetch(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    fetchLeads();
  };

  const saveNotes = async (id, notes) => {
    await apiFetch(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ notes }) });
  };

  // ── lead assignment (admin only) ───────────────────────────────────────────
  const assignLead = async (leadId, assignedUserId) => {
    try {
      await apiFetch(`/leads/${leadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_user_id: assignedUserId }),
      });
      // Update local state so the dropdown reflects immediately without full refetch.
      setLeads(prev => prev.map(l => {
        if (l.id !== leadId) return l;
        const su = assignedUserId ? salesUsers.find(u => u.id === assignedUserId) : null;
        return { ...l, assigned_user_id: assignedUserId, assigned_user_name: su?.name || null };
      }));
    } catch (err) {
      console.error('Assignment failed:', err);
    }
  };

  // ── delete helpers ─────────────────────────────────────────────────────────
  const deleteLead = async (id) => {
    if (!window.confirm('Delete this lead?')) return;
    await apiFetch(`/leads/${id}`, { method: 'DELETE' });
    fetchLeads();
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected lead(s)?`)) return;
    await Promise.all([...selectedIds].map(id => apiFetch(`/leads/${id}`, { method: 'DELETE' })));
    setSelectedIds(new Set());
    fetchLeads();
  };

  // ── export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    const selectedScrapeId = leadSourceFilter.startsWith('scrape:') ? leadSourceFilter.slice(7) : '';
    if (selectedScrapeId) {
      window.open(`/api/scrapes/${selectedScrapeId}/export`, '_blank');
      return;
    }
    const token = localStorage.getItem('token');
    const res   = await fetch('/api/leads/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const csv  = await res.text();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'leads.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── selection helpers ──────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (leads.every(l => selectedIds.has(l.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const selectedScrapeId = leadSourceFilter.startsWith('scrape:') ? leadSourceFilter.slice(7) : '';
  const selectedScrape = scrapes.find(s => String(s.id) === String(selectedScrapeId));

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">
          Leads{' '}
          {selectedScrape && (
            <span className="text-gray-400 font-normal text-lg">— {selectedScrape.name}</span>
          )}
          <span className="text-gray-500 text-lg font-normal ml-2">({total})</span>
        </h2>
        <div className="flex gap-2">
          {selectedScrapeId && (
            <button
              onClick={() => navigate(`/scrapes/${selectedScrapeId}`)}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
            >
              View Scrape Detail →
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={bulkDelete}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              🗑 Delete {selectedIds.size} Selected
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + Add Lead
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {/* Search */}
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search leads..."
          className="flex-1 min-w-[200px] max-w-sm px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />

        {/* Scrape filter */}
        <select
          value={leadSourceFilter}
          onChange={(e) => { setLeadSourceFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white focus:outline-none focus:border-blue-500 min-w-[200px]"
        >
          <option value="">All Leads</option>
          <option value="scraped">All Scrapes</option>
          <option value="manual">Manually Added</option>
          {scrapes.map(s => (
            <option key={s.id} value={`scrape:${s.id}`}>
              {s.name} ({s.lead_count} leads)
            </option>
          ))}
        </select>

        {/* Salesperson filter — admin only */}
        {isAdmin && (
          <select
            value={salespersonFilter}
            onChange={(e) => { setSalespersonFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white focus:outline-none focus:border-blue-500 min-w-[180px]"
          >
            <option value="">All Sales Users</option>
            <option value="unassigned">Unassigned</option>
            {salesUsers.map(u => (
              <option key={u.id} value={String(u.id)}>
                {u.name}{u.is_active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        )}

        {/* Clear scrape filter */}
        {leadSourceFilter && (
          <button
            onClick={() => { setLeadSourceFilter(''); setPage(1); }}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
          >
            ✕ Clear filter
          </button>
        )}
      </div>

      {/* Leads table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : (
          <LeadsTable
            leads={leads}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            showSelect={true}
            onStatusChange={updateStatus}
            onEdit={setEditLead}
            onDelete={deleteLead}
            onCall={setCallLead}
            onSMS={setSmsLead}
            onEmail={setEmailLead}
            onNotesSave={saveNotes}
            isAdmin={isAdmin}
            salesUsers={salesUsers}
            onAssign={isAdmin ? assignLead : undefined}
            onVoiceDrop={openVoiceDrop}
          />
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 bg-gray-800 text-gray-300 rounded disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-gray-400">Page {page} of {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1 bg-gray-800 text-gray-300 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddLeadModal
          scrapes={scrapes}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); fetchLeads(); }}
        />
      )}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSaved={() => { setEditLead(null); fetchLeads(); }}
        />
      )}
      {callLead  && <QuickCallModal  lead={callLead}  onClose={() => setCallLead(null)} />}
      {smsLead   && <QuickSMSModal   lead={smsLead}   onClose={() => setSmsLead(null)}  onSent={fetchLeads} />}
      {emailLead && <QuickEmailModal lead={emailLead} onClose={() => setEmailLead(null)} onSent={fetchLeads} />}
      {voiceDropOpen && voiceDropLead && (
        <VoiceDropModal
          lead={voiceDropLead}
          voiceScripts={voiceDropMode === 'voicemail' ? voicemailScripts : liveVoiceScripts}
          liveVoiceScripts={liveVoiceScripts}
          voicemailScripts={voicemailScripts}
          selectedScriptId={selectedScriptId}
          scriptText={voiceScript}
          mode={voiceDropMode}
          onClose={() => { setVoiceDropOpen(false); setVoiceDropLead(null); }}
        />
      )}
    </div>
  );
}

// ─── Quick Modals (unchanged from original) ───────────────────────────────────

function QuickEmailModal({ lead, onClose, onSent }) {
  const [subject,  setSubject]  = useState(`Following up on your business in ${lead.city || 'your area'}`);
  const firstName = lead.first_name || 'there';
  const [body,     setBody]     = useState(`<p>Hi ${firstName},</p><p>I wanted to reach out regarding your business. I believe we can help you grow.</p><p>Please reply to this email or call us at your convenience.</p><p>Best regards</p>`);
  const [senderId, setSenderId] = useState('');
  const [senders,  setSenders]  = useState([]);
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState(null);

  useEffect(() => {
    apiFetch('/email-senders').then(d => {
      setSenders(d);
      const def = d.find(s => s.is_default);
      if (def) setSenderId(String(def.id));
    }).catch(() => {});
  }, []);

  const handleSend = async () => {
    setSending(true);
    try {
      const data = await apiFetch('/dialer/email', {
        method: 'POST',
        body: JSON.stringify({ toEmail: lead.email, subject, body, senderId: senderId || undefined, leadId: lead.id }),
      });
      setResult({ ok: true, msg: data.mock ? 'Mock email sent' : `✅ Email sent to ${lead.first_name || lead.name || lead.email}` });
      if (onSent) onSent();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setSending(false);
    }
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">✉ Email to {lead.first_name || lead.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        <p className="text-sm text-gray-400 mb-4">To: <span className="text-white font-mono">{lead.email}</span></p>
        <div className="space-y-3">
          {senders.length > 0 && (
            <div>
              <label className="text-xs text-gray-400">From</label>
              <select value={senderId} onChange={e => setSenderId(e.target.value)} className={inp}>
                <option value="">Default</option>
                {senders.map(s => <option key={s.id} value={String(s.id)}>{s.label} — {s.email}</option>)}
              </select>
            </div>
          )}
          <div><label className="text-xs text-gray-400">Subject</label><input value={subject} onChange={e => setSubject(e.target.value)} className={inp} /></div>
          <div><label className="text-xs text-gray-400">Body (HTML)</label><textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className={`${inp} resize-none font-mono text-xs`} /></div>
          {result && <div className={`p-3 rounded text-sm ${result.ok ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{result.msg}</div>}
          <button onClick={handleSend} disabled={sending || !subject || !body}
            className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            {sending ? 'Sending...' : '✉ Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickCallModal({ lead, onClose }) {
  const [agentNumber,   setAgentNumber]   = useState('');
  const [fromNumberId,  setFromNumberId]  = useState('');
  const [phoneNumbers,  setPhoneNumbers]  = useState([]);
  const [calling,       setCalling]       = useState(false);
  const [result,        setResult]        = useState(null);

  useEffect(() => {
    apiFetch('/phone-numbers').then(d => {
      setPhoneNumbers(d);
      const def = d.find(n => n.is_default);
      if (def) setFromNumberId(String(def.id));
    }).catch(() => {});
  }, []);

  const handleCall = async () => {
    setCalling(true);
    try {
      const data = await apiFetch('/dialer/call', {
        method: 'POST',
        body: JSON.stringify({ toNumber: lead.phone, fromNumberId: fromNumberId || undefined, agentNumber: agentNumber || undefined, leadId: lead.id }),
      });
      setResult({
        ok: true,
        msg: data.mock
          ? 'Mock call queued'
          : data.mode === 'agent-first'
          ? `✅ Your phone will ring — answer to connect to ${lead.first_name || lead.name}`
          : `✅ Calling ${lead.phone}...`,
      });
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setCalling(false);
    }
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">📞 Call {lead.first_name || lead.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        <p className="text-sm text-gray-400 mb-4">Calling: <span className="text-white font-mono">{lead.phone}</span></p>
        <div className="space-y-3">
          {phoneNumbers.length > 0 && (
            <div>
              <label className="text-xs text-gray-400">Caller ID</label>
              <select value={fromNumberId} onChange={e => setFromNumberId(e.target.value)} className={inp}>
                <option value="">Default</option>
                {phoneNumbers.map(n => <option key={n.id} value={String(n.id)}>{n.label} — {n.number}</option>)}
              </select>
            </div>
          )}
          <div><label className="text-xs text-gray-400">Your Phone (optional — rings your phone first)</label><input value={agentNumber} onChange={e => setAgentNumber(e.target.value)} placeholder="Your mobile number" className={inp} /></div>
          {result && <div className={`p-3 rounded text-sm ${result.ok ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{result.msg}</div>}
          <button onClick={handleCall} disabled={calling}
            className="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            {calling ? 'Calling...' : '📞 Call Now'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickSMSModal({ lead, onClose, onSent }) {
  const [message,      setMessage]      = useState('');
  const [fromNumberId, setFromNumberId] = useState('');
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [sending,      setSending]      = useState(false);
  const [result,       setResult]       = useState(null);

  useEffect(() => {
    apiFetch('/phone-numbers').then(d => {
      setPhoneNumbers(d);
      const def = d.find(n => n.is_default);
      if (def) setFromNumberId(String(def.id));
    }).catch(() => {});
  }, []);

  const handleSend = async () => {
    setSending(true);
    try {
      const data = await apiFetch('/dialer/sms', {
        method: 'POST',
        body: JSON.stringify({ toNumber: lead.phone, message, fromNumberId: fromNumberId || undefined, leadId: lead.id }),
      });
      setResult({ ok: true, msg: data.mock ? 'Mock SMS sent' : `✅ SMS sent to ${lead.first_name || lead.name || lead.phone}` });
      if (onSent) onSent();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setSending(false);
    }
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">💬 SMS to {lead.first_name || lead.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        <p className="text-sm text-gray-400 mb-4">To: <span className="text-white font-mono">{lead.phone}</span></p>
        <div className="space-y-3">
          {phoneNumbers.length > 0 && (
            <div>
              <label className="text-xs text-gray-400">From</label>
              <select value={fromNumberId} onChange={e => setFromNumberId(e.target.value)} className={inp}>
                <option value="">Default</option>
                {phoneNumbers.map(n => <option key={n.id} value={String(n.id)}>{n.label} — {n.number}</option>)}
              </select>
            </div>
          )}
          <div><label className="text-xs text-gray-400">Message</label><textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Type your message..." className={`${inp} resize-none`} /></div>
          {result && <div className={`p-3 rounded text-sm ${result.ok ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{result.msg}</div>}
          <button onClick={handleSend} disabled={sending || !message}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            {sending ? 'Sending...' : '💬 Send SMS'}
          </button>
        </div>
      </div>
    </div>
  );
}
