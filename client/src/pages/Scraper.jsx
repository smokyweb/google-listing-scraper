import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

export default function Scraper() {
  const [keyword, setKeyword] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [recentScrapes, setRecentScrapes] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/scrapes').then(data => setRecentScrapes(data.slice(0, 5))).catch(() => {});
  }, []);

  const handleScrape = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    setLoading(true);
    try {
      const data = await apiFetch('/scrape', {
        method: 'POST',
        body: JSON.stringify({ keyword, city, state }),
      });
      setResults(data);
      // Refresh recent scrapes
      apiFetch('/scrapes').then(d => setRecentScrapes(d.slice(0, 5))).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Scraper</h2>

      <form onSubmit={handleScrape} className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Keyword</label>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. Plumber"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Austin"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="e.g. TX"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Scraping & finding emails...' : '🔍 Scrape Google Listings'}
          </button>
          {loading && <p className="text-sm text-gray-400 animate-pulse">Scraping listings and scanning websites for emails…</p>}
        </div>
      </form>

      {error && <div className="bg-red-900/50 border border-red-800 text-red-300 p-4 rounded-xl mb-6">{error}</div>}

      {results && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{results.scrape_name}</h3>
              <p className="text-sm text-gray-400 mt-1">
                {results.count} leads scraped · {results.emails_found || 0} emails found from websites
                {results.mock && <span className="ml-2 text-xs bg-yellow-900 text-yellow-300 px-2 py-1 rounded-full">Mock Data</span>}
              </p>
            </div>
            <button
              onClick={() => navigate(`/scrapes/${results.scrape_id}`)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
            >
              View Full Scrape →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="p-3">Name</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Website</th>
                  <th className="p-3">Address</th>
                </tr>
              </thead>
              <tbody>
                {results.leads.map((lead, i) => (
                  <tr key={lead.id || i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-3 text-white font-medium">{lead.name}</td>
                    <td className="p-3 text-gray-300">{lead.phone || '—'}</td>
                    <td className="p-3">
                      {lead.email
                        ? <span className="text-green-400">{lead.email}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="p-3">
                      {lead.website ? (
                        <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate block max-w-[200px]">
                          {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="p-3 text-gray-400">{lead.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recentScrapes.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Recent Scrapes</h3>
            <button onClick={() => navigate('/history')} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
              View All History →
            </button>
          </div>
          <div className="space-y-2">
            {recentScrapes.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors">
                <div>
                  <button onClick={() => navigate(`/scrapes/${s.id}`)} className="text-white font-medium hover:text-blue-400 transition-colors">
                    {s.name}
                  </button>
                  <p className="text-xs text-gray-500 mt-0.5">{new Date(s.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-400">{s.lead_count} leads</span>
                  <span className={s.emails_found > 0 ? 'text-green-400' : 'text-gray-600'}>{s.emails_found || 0} emails</span>
                  <button onClick={() => navigate(`/scrapes/${s.id}`)} className="text-xs text-blue-400 hover:text-blue-300">View →</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
