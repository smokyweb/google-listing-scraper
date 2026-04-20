import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const OUTCOME_LABELS = {
  transferred: { label: 'Pressed 1 — Transferred to Staff', color: 'bg-green-900/50 text-green-300' },
  callback_requested: { label: 'Pressed 2 — Requested Callback', color: 'bg-yellow-900/50 text-yellow-300' },
  meeting_scheduled: { label: 'Pressed 3 — Scheduled Meeting', color: 'bg-purple-900/50 text-purple-300' },
  unsubscribed: { label: 'Pressed 4 — Unsubscribed', color: 'bg-red-900/50 text-red-300' },
  no_input: { label: 'No Input / Hung Up', color: 'bg-gray-700 text-gray-300' },
  voicemail_left: { label: 'Voicemail Left', color: 'bg-blue-900/50 text-blue-300' },
  initiated: { label: 'Call Initiated', color: 'bg-gray-700 text-gray-400' },
};

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [emailOpens, setEmailOpens] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [callSummary, setCallSummary] = useState([]);
  const [scrapes, setScrapes] = useState([]);
  const [filters, setFilters] = useState({ scrapeId: '', dateFrom: '', dateTo: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/scrapes').then(setScrapes).catch(() => {});
    loadOverview();
  }, []);

  const loadOverview = () => {
    apiFetch('/reports/overview').then(setOverview).catch(() => {});
  };

  const buildQuery = () => {
    const p = new URLSearchParams();
    if (filters.scrapeId) p.set('scrapeId', filters.scrapeId);
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) p.set('dateTo', filters.dateTo);
    return p.toString() ? '?' + p.toString() : '';
  };

  const loadEmailReport = async () => {
    setLoading(true);
    try { setEmailOpens(await apiFetch('/reports/email-opens' + buildQuery())); } catch {}
    finally { setLoading(false); }
  };

  const loadCallReport = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/reports/call-outcomes' + buildQuery());
      setCallLogs(data.logs);
      setCallSummary(data.summary);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (tab === 'emails') loadEmailReport();
    if (tab === 'calls') loadCallReport();
  }, [tab]);

  const filterBar = (
    <div className="flex flex-wrap gap-3 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-4">
      <select value={filters.scrapeId} onChange={e => setFilters(f => ({ ...f, scrapeId: e.target.value }))}
        className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none min-w-[200px]">
        <option value="">All Scrapes</option>
        {scrapes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400">From</label>
        <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400">To</label>
        <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none" />
      </div>
      <button onClick={() => { if(tab==='emails') loadEmailReport(); else loadCallReport(); }}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors">
        Apply
      </button>
      {(filters.scrapeId || filters.dateFrom || filters.dateTo) && (
        <button onClick={() => { setFilters({ scrapeId:'', dateFrom:'', dateTo:'' }); }}
          className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm">Clear</button>
      )}
    </div>
  );

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Reports</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {[{id:'overview',label:'📊 Overview'},{id:'emails',label:'📧 Email Opens'},{id:'calls',label:'📞 Call Outcomes'}].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab===t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Leads" value={overview.total_leads} />
            <StatCard label="Emails Sent" value={overview.emails_sent} />
            <StatCard label="Email Opens" value={overview.emails_opened} color="text-green-400" />
            <StatCard label="Open Rate" value={overview.emails_sent > 0 ? Math.round(overview.emails_opened / overview.emails_sent * 100) + '%' : '—'} color="text-green-400" />
            <StatCard label="Calls Made" value={overview.calls_made} />
            <StatCard label="SMS Sent" value={overview.sms_sent} />
            <StatCard label="Callbacks Pending" value={overview.callbacks_pending} color="text-yellow-400" />
            <StatCard label="Meetings Scheduled" value={overview.meetings_scheduled} color="text-purple-400" />
            <StatCard label="Unsubscribed" value={overview.unsubscribed} color="text-red-400" />
          </div>

          {overview.call_outcomes?.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Call Outcomes Breakdown</h3>
              <div className="space-y-3">
                {overview.call_outcomes.map(o => {
                  const info = OUTCOME_LABELS[o.outcome] || { label: o.outcome, color: 'bg-gray-700 text-gray-300' };
                  const pct = overview.calls_made > 0 ? Math.round(o.count / overview.calls_made * 100) : 0;
                  return (
                    <div key={o.outcome} className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded text-xs shrink-0 min-w-[200px] ${info.color}`}>{info.label}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-white font-semibold text-sm w-8 text-right">{o.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* EMAIL OPENS */}
      {tab === 'emails' && (
        <>
          {filterBar}
          {loading ? <div className="text-gray-500 text-center p-8">Loading...</div> : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <p className="text-sm text-gray-400">{emailOpens.length} leads • {emailOpens.filter(l=>l.email_opens>0).length} with opens</p>
                <p className="text-xs text-gray-500">Opens tracked via pixel — only works when images are enabled in recipient's email client</p>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="p-4">Lead</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Scrape / Date</th>
                  <th className="p-4">Sent</th>
                  <th className="p-4">Opens</th>
                  <th className="p-4">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-800">
                  {emailOpens.map(lead => (
                    <tr key={lead.id} className="hover:bg-gray-800/30">
                      <td className="p-4 text-white font-medium">{lead.name}</td>
                      <td className="p-4 text-gray-400 text-xs">{lead.email || '—'}</td>
                      <td className="p-4 text-xs text-gray-500">
                        <p>{lead.scrape_name || '—'}</p>
                        <p>{lead.scrape_date ? new Date(lead.scrape_date).toLocaleDateString() : ''}</p>
                      </td>
                      <td className="p-4 text-gray-400 text-xs">{lead.email_sent_at ? new Date(lead.email_sent_at).toLocaleString() : '—'}</td>
                      <td className="p-4">
                        {lead.email_opens > 0
                          ? <span className="text-green-400 font-bold">👁 {lead.email_opens}</span>
                          : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-xs ${lead.email_status==='sent' ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-700 text-gray-400'}`}>
                          {lead.email_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {emailOpens.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-500">No email data yet</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* CALL OUTCOMES */}
      {tab === 'calls' && (
        <>
          {filterBar}
          {callSummary.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-4">
              {callSummary.map(s => {
                const info = OUTCOME_LABELS[s.outcome] || { label: s.outcome, color: 'bg-gray-700 text-gray-300' };
                return <span key={s.outcome} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${info.color}`}>{info.label}: <strong>{s.count}</strong></span>;
              })}
            </div>
          )}
          {loading ? <div className="text-gray-500 text-center p-8">Loading...</div> : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="p-4">Lead</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4">Scrape</th>
                  <th className="p-4">Called</th>
                  <th className="p-4">Outcome</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-800">
                  {callLogs.map(log => {
                    const info = OUTCOME_LABELS[log.outcome] || { label: log.outcome, color: 'bg-gray-700 text-gray-300' };
                    return (
                      <tr key={log.id} className="hover:bg-gray-800/30">
                        <td className="p-4 text-white font-medium">{log.lead_name || '—'}</td>
                        <td className="p-4 text-gray-400 font-mono text-xs">{log.lead_phone}</td>
                        <td className="p-4 text-xs text-gray-500">{log.scrape_name || '—'}</td>
                        <td className="p-4 text-gray-400 text-xs">{new Date(log.called_at).toLocaleString()}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-xs ${info.color}`}>{info.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {callLogs.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-500">No call log data yet. Call outcomes are tracked when callers respond to the IVR menu.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
