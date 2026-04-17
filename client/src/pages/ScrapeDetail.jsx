import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

export default function ScrapeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

  const load = () => {
    apiFetch(`/scrapes/${id}/leads`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const handleRefreshEmails = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const r = await apiFetch(`/scrape/refresh-emails/${id}`, { method: 'POST' });
      setRefreshResult(r);
      load();
    } catch (err) {
      setRefreshResult({ error: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  const handleExport = () => {
    const token = localStorage.getItem('token');
    window.open(`/api/scrapes/${id}/export`, '_blank');
  };

  if (loading) return <div className="text-gray-500 p-8 text-center">Loading...</div>;
  if (!data) return <div className="text-red-400 p-8 text-center">Scrape not found.</div>;

  const { scrape, leads } = data;
  const emailCount = leads.filter(l => l.email).length;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/history')} className="text-gray-400 hover:text-white transition-colors text-sm">
          ← History
        </button>
        <h2 className="text-2xl font-bold text-white flex-1">{scrape.name}</h2>
        <div className="flex gap-2">
          <button
            onClick={handleRefreshEmails}
            disabled={refreshing}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Scraping emails...' : '🔍 Re-scrape Emails'}
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Leads', value: leads.length },
          { label: 'With Email', value: emailCount },
          { label: 'With Phone', value: leads.filter(l => l.phone).length },
          { label: 'With Website', value: leads.filter(l => l.website).length },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {refreshResult && (
        <div className={`mb-4 p-4 rounded-lg text-sm ${refreshResult.error ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
          {refreshResult.error || `Updated ${refreshResult.updated} of ${refreshResult.total} leads with email addresses`}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Business</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Phone</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Website</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {leads.map(lead => (
              <tr key={lead.id} className="hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-white font-medium">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.address}</p>
                </td>
                <td className="px-4 py-3 text-gray-300">{lead.phone || <span className="text-gray-600">—</span>}</td>
                <td className="px-4 py-3">
                  {lead.email
                    ? <span className="text-green-400">{lead.email}</span>
                    : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  {lead.website
                    ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 truncate block max-w-xs">{lead.website.replace(/^https?:\/\/(www\.)?/, '')}</a>
                    : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {lead.email_status !== 'pending' && <span className="px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded text-xs">✉ {lead.email_status}</span>}
                    {lead.call_status !== 'pending' && <span className="px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">📞 {lead.call_status}</span>}
                    {lead.sms_status !== 'pending' && <span className="px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded text-xs">💬 {lead.sms_status}</span>}
                    {lead.email_status === 'pending' && lead.call_status === 'pending' && lead.sms_status === 'pending' && (
                      <span className="text-gray-600 text-xs">new</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 && (
          <div className="p-8 text-center text-gray-500">No leads in this scrape.</div>
        )}
      </div>
    </div>
  );
}
