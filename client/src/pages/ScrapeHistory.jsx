import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

export default function ScrapeHistory() {
  const [scrapes, setScrapes] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    apiFetch('/scrapes')
      .then(data => { setScrapes(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete scrape "${name}" and all its leads?`)) return;
    await apiFetch(`/scrapes/${id}`, { method: 'DELETE' });
    load();
  };

  const handleExport = (id) => {
    const token = localStorage.getItem('token');
    window.open(`/api/scrapes/${id}/export?token=${token}`, '_blank');
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Scrape History</h2>

      {loading ? (
        <div className="text-gray-500 p-8 text-center">Loading...</div>
      ) : scrapes.length === 0 ? (
        <div className="text-gray-500 p-8 text-center bg-gray-900 border border-gray-800 rounded-xl">
          No scrapes yet. Run your first scrape from the Scraper page.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Scrape Name</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Date</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Leads</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Emails Found</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {scrapes.map(s => (
                <tr key={s.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <button
                      onClick={() => navigate(`/scrapes/${s.id}`)}
                      className="text-white font-medium hover:text-blue-400 transition-colors text-left"
                    >
                      {s.name}
                    </button>
                    {s.mock ? <span className="ml-2 px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 rounded text-xs">mock</span> : null}
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-white font-semibold">{s.lead_count}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`font-semibold ${s.emails_found > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                      {s.emails_found || 0}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-3">
                      <button
                        onClick={() => navigate(`/scrapes/${s.id}`)}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleExport(s.id)}
                        className="text-xs text-green-400 hover:text-green-300 transition-colors"
                      >
                        Export CSV
                      </button>
                      <button
                        onClick={() => handleDelete(s.id, s.name)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
