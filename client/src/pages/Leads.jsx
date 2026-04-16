import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import LeadsTable from '../components/LeadsTable';

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [scrapes, setScrapes] = useState([]);
  const [selectedScrapeId, setSelectedScrapeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/scrapes').then(data => setScrapes(data)).catch(() => {});
  }, []);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (search) params.set('search', search);
      if (selectedScrapeId) params.set('scrape_id', selectedScrapeId);
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

  useEffect(() => { fetchLeads(); }, [page, search, selectedScrapeId]);

  const handleExport = async () => {
    // If filtering by scrape, export that scrape's CSV
    if (selectedScrapeId) {
      window.open(`/api/scrapes/${selectedScrapeId}/export`, '_blank');
      return;
    }
    const token = localStorage.getItem('gls_token');
    const res = await fetch('/api/leads/export', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const csv = await res.text();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads.csv'; a.click();
    URL.revokeObjectURL(url);
  };

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

  const selectedScrape = scrapes.find(s => String(s.id) === String(selectedScrapeId));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">
          Leads {selectedScrape ? <span className="text-gray-400 font-normal text-lg">— {selectedScrape.name}</span> : null}
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
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search leads..."
          className="flex-1 min-w-[200px] max-w-sm px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={selectedScrapeId}
          onChange={(e) => { setSelectedScrapeId(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white focus:outline-none focus:border-blue-500 min-w-[200px]"
        >
          <option value="">All Scrapes</option>
          {scrapes.map(s => (
            <option key={s.id} value={String(s.id)}>
              {s.name} ({s.lead_count} leads)
            </option>
          ))}
        </select>
        {selectedScrapeId && (
          <button
            onClick={() => { setSelectedScrapeId(''); setPage(1); }}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
          >
            ✕ Clear filter
          </button>
        )}
      </div>

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
          />
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-800 text-gray-300 rounded disabled:opacity-50">Prev</button>
          <span className="text-sm text-gray-400">Page {page} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1 bg-gray-800 text-gray-300 rounded disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
