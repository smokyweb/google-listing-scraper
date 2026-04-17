import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function PhoneNumbers() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', number: '', provider: 'signalwire', is_default: false });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await apiFetch('/phone-numbers/sync', { method: 'POST' });
      setMessage({ type: 'success', text: `Synced from SignalWire: ${data.added} new number(s) added, ${data.skipped} already existed.` });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally { setSyncing(false); }
  };

  const load = () => {
    apiFetch('/phone-numbers')
      .then(data => { setNumbers(data); setLoading(false); })
      .catch(err => { setMessage({ type: 'error', text: err.message }); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch('/phone-numbers', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setMessage({ type: 'success', text: 'Phone number added successfully' });
      setForm({ label: '', number: '', provider: 'signalwire', is_default: false });
      setShowAdd(false);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await apiFetch(`/phone-numbers/${id}/set-default`, { method: 'POST' });
      setMessage({ type: 'success', text: 'Default phone number updated' });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this phone number?')) return;
    try {
      await apiFetch(`/phone-numbers/${id}`, { method: 'DELETE' });
      setMessage({ type: 'success', text: 'Phone number removed' });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Phone Numbers</h2>
        <div className="flex gap-2">
          <button onClick={handleSync} disabled={syncing}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {syncing ? 'Syncing...' : '🔄 Sync from SignalWire'}
          </button>
          <button onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            + Add Phone Number
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-4 rounded-lg text-sm ${message.type === 'error' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
          {message.text}
        </div>
      )}

      {showAdd && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Add New Phone Number</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Label</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                  placeholder="e.g. Main SignalWire, Backup Line"
                  required
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={form.number}
                  onChange={e => setForm({ ...form, number: e.target.value })}
                  placeholder="(469) 949-4968 or +14699494968"
                  required
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Provider</label>
                <select
                  value={form.provider}
                  onChange={e => setForm({ ...form, provider: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="signalwire">SignalWire</option>
                  <option value="twilio">Twilio</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={form.is_default}
                  onChange={e => setForm({ ...form, is_default: e.target.checked })}
                  className="rounded bg-gray-800 border-gray-600"
                />
                <label htmlFor="is_default" className="text-sm text-gray-300">Set as default number</label>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Number'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : numbers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg mb-2">No phone numbers added yet</p>
            <p className="text-sm">Add your SignalWire number(s) to use for calls and SMS campaigns.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Label</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Number</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Provider</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Default</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {numbers.map(num => (
                <tr key={num.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{num.label}</td>
                  <td className="px-6 py-4 text-gray-300 font-mono">{num.number}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded text-xs capitalize">
                      {num.provider}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {num.is_default ? (
                      <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded text-xs font-medium">
                        ✓ Default
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSetDefault(num.id)}
                        className="text-xs text-gray-400 hover:text-blue-400 transition-colors"
                      >
                        Set default
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleDelete(num.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 p-4 bg-gray-900/50 border border-gray-800 rounded-lg">
        <p className="text-sm text-gray-400">
          <span className="text-gray-300 font-medium">Note:</span> The selected phone number is used as the "From" number when triggering calls or SMS campaigns. The default number is used automatically unless you override it per campaign.
        </p>
      </div>
    </div>
  );
}
