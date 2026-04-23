import { formatEST } from '../utils/time';
import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const STATUS_COLORS = { pending: 'bg-yellow-900/50 text-yellow-300', completed: 'bg-green-900/50 text-green-300', cancelled: 'bg-red-900/50 text-red-300' };

export default function Callbacks() {
  const [callbacks, setCallbacks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => apiFetch('/callbacks').then(data => { setCallbacks(data); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const updateStatus = async (id, status) => {
    await apiFetch(`/callbacks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    load();
  };

  const updateNotes = async (id, notes) => {
    await apiFetch(`/callbacks/${id}`, { method: 'PATCH', body: JSON.stringify({ notes }) });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this callback?')) return;
    await apiFetch(`/callbacks/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Call Backs ({callbacks.length})</h2>
      {loading ? (
        <div className="text-gray-500 p-8 text-center">Loading...</div>
      ) : callbacks.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          No callbacks yet. When callers press 2 during a call, their requested callback time will appear here.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Lead</th>
                <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Phone</th>
                <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Callback Request</th>
                <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Received</th>
                <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Notes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {callbacks.map(cb => (
                <tr key={cb.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{cb.lead_name || cb.lead_name_resolved || 'â€”'}</td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-sm">{cb.phone}</td>
                  <td className="px-4 py-3 text-gray-300 text-sm max-w-xs">{cb.raw_speech || 'â€”'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatEST(cb.created_at)}</td>
                  <td className="px-4 py-3">
                    <select value={cb.status} onChange={e => updateStatus(cb.id, e.target.value)}
                      className={`px-2 py-1 rounded text-xs font-medium border-0 focus:outline-none cursor-pointer ${STATUS_COLORS[cb.status] || 'bg-gray-700 text-gray-300'}`}>
                      <option value="pending">Pending</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input defaultValue={cb.notes || ''} onBlur={e => updateNotes(cb.id, e.target.value)}
                      placeholder="Add notes..."
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-blue-500" />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(cb.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
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

