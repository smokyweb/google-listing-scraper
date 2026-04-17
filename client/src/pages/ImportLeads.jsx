import { useState } from 'react';
import { apiFetch } from '../api';

const EXPECTED_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'keyword', label: 'Keyword' },
];

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map(line => {
    // Handle quoted fields with commas inside
    const cols = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    return cols;
  });
  return { headers, rows };
}

function autoMap(csvHeaders) {
  const mapping = {};
  const ALIASES = {
    name: ['name', 'business name', 'company', 'company name', 'business', 'title'],
    phone: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell'],
    email: ['email', 'email address', 'e-mail', 'mail'],
    website: ['website', 'url', 'web', 'site', 'domain'],
    address: ['address', 'street', 'location', 'addr'],
    city: ['city', 'town'],
    state: ['state', 'province', 'region', 'st'],
    keyword: ['keyword', 'category', 'type', 'industry'],
  };
  for (const csvHeader of csvHeaders) {
    const lower = csvHeader.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(lower) && !mapping[field]) {
        mapping[field] = csvHeader;
        break;
      }
    }
  }
  return mapping;
}

export default function ImportLeads() {
  const [step, setStep] = useState('upload'); // upload | map | importing | done
  const [csvData, setCsvData] = useState(null); // { headers, rows }
  const [mapping, setMapping] = useState({});
  const [scrapes, setScrapes] = useState([]);
  const [selectedScrapeId, setSelectedScrapeId] = useState('');
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadScrapes = () => apiFetch('/scrapes').then(setScrapes).catch(() => {});

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      if (parsed.headers.length === 0) return alert('Could not parse CSV file');
      setCsvData(parsed);
      const autoMapped = autoMap(parsed.headers);
      setMapping(autoMapped);
      loadScrapes();
      setStep('map');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleImport = async () => {
    setImporting(true);
    setResult(null);
    try {
      const leads = csvData.rows
        .filter(row => row.some(c => c)) // skip empty rows
        .map(row => {
          const lead = { source: 'import' };
          for (const [field, csvHeader] of Object.entries(mapping)) {
            if (!csvHeader) continue;
            const idx = csvData.headers.indexOf(csvHeader);
            if (idx >= 0) lead[field] = row[idx] || '';
          }
          if (selectedScrapeId) lead.scrape_id = parseInt(selectedScrapeId);
          return lead;
        })
        .filter(l => l.name); // name is required

      // Batch import — POST each lead
      let imported = 0, skipped = 0, errors = [];
      for (const lead of leads) {
        try {
          await apiFetch('/leads', { method: 'POST', body: JSON.stringify(lead) });
          imported++;
        } catch (err) {
          if (err.message?.includes('required')) skipped++;
          else errors.push(err.message);
        }
      }
      setResult({ imported, skipped, errors, total: leads.length });
      setStep('done');
    } catch (err) {
      setResult({ error: err.message });
    } finally { setImporting(false); }
  };

  const reset = () => { setStep('upload'); setCsvData(null); setMapping({}); setResult(null); };

  const downloadTemplate = () => {
    const csv = EXPECTED_FIELDS.map(f => f.label).join(',') + '\n' +
      'Acme Plumbing,555-123-4567,info@acmeplumbing.com,https://acmeplumbing.com,123 Main St,Austin,TX,plumber\n' +
      'Best Electric Co,555-987-6543,contact@bestelectric.com,https://bestelectric.com,456 Oak Ave,Dallas,TX,electrician';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'leads_import_template.csv'; a.click();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Import Leads (CSV)</h2>
        <button onClick={downloadTemplate} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors">
          ⬇ Download Template
        </button>
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Expected CSV Format</h3>
            <p className="text-sm text-gray-400 mb-4">Download the template above or use a CSV with these column headings (case-insensitive, extras are fine):</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {EXPECTED_FIELDS.map(f => (
                <div key={f.key} className={`px-3 py-2 rounded-lg text-sm font-mono ${f.required ? 'bg-blue-900/50 text-blue-200 border border-blue-700' : 'bg-gray-800 text-gray-300'}`}>
                  {f.label} {f.required && <span className="text-xs text-blue-400">*required</span>}
                </div>
              ))}
            </div>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 bg-gray-900 hover:border-gray-600'}`}
          >
            <div className="text-4xl mb-3">📂</div>
            <p className="text-white font-medium mb-2">Drag & drop your CSV file here</p>
            <p className="text-gray-500 text-sm mb-4">or</p>
            <label className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium cursor-pointer transition-colors">
              Browse Files
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
            </label>
          </div>
        </div>
      )}

      {/* Step 2: Field Mapping */}
      {step === 'map' && csvData && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-gray-400 text-sm">
              Found <span className="text-white font-medium">{csvData.headers.length}</span> columns and <span className="text-white font-medium">{csvData.rows.length}</span> rows.
              Map each lead field to a CSV column below.
            </p>
            <button onClick={reset} className="text-sm text-gray-400 hover:text-white">← Upload different file</button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Field Mapping</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {EXPECTED_FIELDS.map(field => (
                <div key={field.key} className="flex items-center gap-3">
                  <div className={`w-28 shrink-0 px-2 py-1.5 rounded text-sm font-medium text-center ${field.required ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-800 text-gray-400'}`}>
                    {field.label} {field.required && '*'}
                  </div>
                  <span className="text-gray-600">→</span>
                  <select
                    value={mapping[field.key] || ''}
                    onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">— Skip this field —</option>
                    {csvData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {mapping[field.key] && (
                    <span className="text-xs text-green-400 shrink-0">✓ mapped</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Assign to scrape */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <label className="block text-sm text-gray-400 mb-2">Assign to Scrape (optional)</label>
            <select value={selectedScrapeId} onChange={e => setSelectedScrapeId(e.target.value)}
              className="w-full max-w-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="">None — save as standalone leads</option>
              {scrapes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Preview */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-sm text-gray-400 mb-3">Preview (first 3 rows with current mapping):</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    {EXPECTED_FIELDS.filter(f => mapping[f.key]).map(f => <th key={f.key} className="text-left p-2">{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {csvData.rows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      {EXPECTED_FIELDS.filter(f => mapping[f.key]).map(f => {
                        const idx = csvData.headers.indexOf(mapping[f.key]);
                        return <td key={f.key} className="p-2 text-gray-300 truncate max-w-[150px]">{row[idx] || '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleImport} disabled={importing || !mapping.name}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {importing ? `Importing...` : `Import ${csvData.rows.length} Leads`}
            </button>
            {!mapping.name && <p className="text-sm text-red-400 self-center">⚠ "Name" field must be mapped to import</p>}
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && result && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          {result.error ? (
            <div className="text-red-400"><p className="text-xl mb-2">❌ Import Failed</p><p className="text-sm">{result.error}</p></div>
          ) : (
            <>
              <div className="text-5xl mb-4">✅</div>
              <h3 className="text-xl font-bold text-white mb-2">Import Complete</h3>
              <div className="flex justify-center gap-8 mt-4 text-sm">
                <div><p className="text-2xl font-bold text-green-400">{result.imported}</p><p className="text-gray-400">Imported</p></div>
                <div><p className="text-2xl font-bold text-yellow-400">{result.skipped}</p><p className="text-gray-400">Skipped</p></div>
                <div><p className="text-2xl font-bold text-gray-400">{result.total}</p><p className="text-gray-400">Total</p></div>
              </div>
              {result.errors?.length > 0 && (
                <div className="mt-4 text-left bg-red-900/20 rounded-lg p-4">
                  <p className="text-xs text-red-400 font-medium mb-1">Errors:</p>
                  {result.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-red-300">• {e}</p>)}
                </div>
              )}
              <div className="flex justify-center gap-3 mt-6">
                <button onClick={reset} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Import Another File</button>
                <a href="/leads" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">View Leads →</a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
