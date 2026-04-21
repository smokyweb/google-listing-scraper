import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

export default function Scraper() {
  const [keyword, setKeyword] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [customCity, setCustomCity] = useState('');
  const [maxResults, setMaxResults] = useState(20);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [minPop, setMinPop] = useState(100000);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scrapeMoreLoading, setScrapeMoreLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [recentScrapes, setRecentScrapes] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/locations/states').then(setStates).catch(() => {});
    apiFetch('/scrapes').then(data => setRecentScrapes(data.slice(0, 5))).catch(() => {});
  }, []);

  const loadCities = async (stateCode, pop) => {
    if (!stateCode) { setCities([]); return; }
    setLoadingCities(true);
    try {
      const data = await apiFetch(`/locations/cities?state=${stateCode}&minPop=${pop || minPop}`);
      setCities(data);
      setSelectedCity('');
    } catch { setCities([]); }
    finally { setLoadingCities(false); }
  };

  const handleStateChange = (code) => {
    setSelectedState(code);
    setSelectedCity('');
    setCustomCity('');
    if (code) loadCities(code, minPop);
    else setCities([]);
  };

  const handleMinPopChange = (val) => {
    setMinPop(Number(val));
    if (selectedState) loadCities(selectedState, Number(val));
  };

  const handleScrape = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    setLoading(true);
    const city = customCity || selectedCity;
    const stateCode = selectedState;
    try {
      const data = await apiFetch('/scrape', { method: 'POST', body: JSON.stringify({ keyword, city, state: stateCode, maxResults }) });
      setResults(data);
      apiFetch('/scrapes').then(d => setRecentScrapes(d.slice(0, 5))).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Scraper</h2>

      <form onSubmit={handleScrape} className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Keyword *</label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="e.g. Plumber" required className={inp} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">State *</label>
            <select value={selectedState} onChange={e => handleStateChange(e.target.value)} required className={inp}>
              <option value="">Select a state...</option>
              {states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {selectedState && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-400">City (from list)</label>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  Min population:
                  <input type="number" value={minPop} onChange={e => handleMinPopChange(e.target.value)}
                    className="w-24 px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              {loadingCities ? (
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-500 text-sm">Loading cities...</div>
              ) : (
                <select value={selectedCity} onChange={e => { setSelectedCity(e.target.value); setCustomCity(''); }} className={inp}>
                  <option value="">Select a city...</option>
                  {cities.map(c => <option key={c.name} value={c.name}>{c.name} ({c.population?.toLocaleString()})</option>)}
                  {cities.length === 0 && <option disabled>No cities found with {minPop.toLocaleString()}+ residents</option>}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Or enter custom city</label>
              <input value={customCity} onChange={e => { setCustomCity(e.target.value); setSelectedCity(''); }}
                placeholder="Type any city name..." className={inp} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Results:</label>
            <select value={maxResults} onChange={e => setMaxResults(Number(e.target.value))}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
              <option value={20}>20 (1 page)</option>
              <option value={40}>40 (2 pages)</option>
              <option value={60}>60 (max per query)</option>
            </select>
          </div>
          <button type="submit" disabled={loading || !selectedState || (!selectedCity && !customCity)}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            {loading ? 'Scraping & finding emails...' : 'ðŸ” Scrape Google Listings'}
          </button>
          {loading && <p className="text-sm text-gray-400 animate-pulse">Scraping listings and scanning websites for emailsâ€¦ {maxResults > 20 ? `(fetching up to ${maxResults} results)` : ''}</p>}
        </div>
      </form>

      {error && <div className="bg-red-900/50 border border-red-800 text-red-300 p-4 rounded-xl mb-6">{error}</div>}

      {results && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{results.scrape_name}</h3>
              <p className="text-sm text-gray-400 mt-1">
                {results.count} leads Â· {results.emails_found || 0} emails found
                {results.mock && <span className="ml-2 text-xs bg-yellow-900 text-yellow-300 px-2 py-1 rounded-full">Mock Data</span>}
              </p>
            </div>
            {results.has_more && (
                <button onClick={async () => {
                  setScrapeMoreLoading(true);
                  try {
                    const more = await apiFetch(`/scrape/more/${results.scrape_id}`, { method: 'POST' });
                    setResults(prev => ({ ...prev, count: prev.count + more.count, emails_found: (prev.emails_found||0) + (more.emails_found||0), leads: [...(prev.leads||[]), ...more.leads], has_more: more.has_more }));
                    apiFetch('/scrapes').then(d => setRecentScrapes(d.slice(0, 5))).catch(() => {});
                  } catch(err) { setError(err.message); } finally { setScrapeMoreLoading(false); }
                }} disabled={scrapeMoreLoading} className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50">
                  {scrapeMoreLoading ? 'Loading...' : '+ Scrape 20 More'}
                </button>
              )}
              <button onClick={() => navigate(`/scrapes/${results.scrape_id}`)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors">
              View Full Scrape → â†’
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Email</th><th className="p-3">Website</th>
              </tr></thead>
              <tbody>
                {results.leads.map((lead, i) => (
                  <tr key={lead.id || i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-3 text-white font-medium">{lead.name}</td>
                    <td className="p-3 text-gray-300">{lead.phone || 'â€”'}</td>
                    <td className="p-3">{lead.email ? <span className="text-green-400">{lead.email}</span> : <span className="text-gray-600">â€”</span>}</td>
                    <td className="p-3">{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate block max-w-xs">{lead.website.replace(/^https?:\/\/(www\.)?/, '')}</a> : <span className="text-gray-600">â€”</span>}</td>
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
            <button onClick={() => navigate('/history')} className="text-sm text-blue-400 hover:text-blue-300">View All â†’</button>
          </div>
          <div className="space-y-2">
            {recentScrapes.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors">
                <div>
                  <button onClick={() => navigate(`/scrapes/${s.id}`)} className="text-white font-medium hover:text-blue-400">{s.name}</button>
                  <p className="text-xs text-gray-500">{new Date(s.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-400">{s.lead_count} leads</span>
                  <span className={s.emails_found > 0 ? 'text-green-400' : 'text-gray-600'}>{s.emails_found || 0} emails</span>
                  <button onClick={() => navigate(`/scrapes/${s.id}`)} className="text-xs text-blue-400 hover:text-blue-300">View â†’</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


