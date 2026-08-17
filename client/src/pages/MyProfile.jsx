import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function MyProfile() {
  const user = (() => { try { return JSON.parse(localStorage.getItem('gls_user') || 'null'); } catch { return null; } })();
  const [forwardNumber, setForwardNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    // Fetch fresh user data
    apiFetch('/sales-users').then(users => {
      const me = users.find(u => u.id === user.id);
      if (me) { setForwardNumber(me.forward_number || ''); }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    setMsg(null);
    try {
      await apiFetch(`/sales-users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ forward_number: forwardNumber }),
      });
      setMsg({ type: 'success', text: 'Settings saved' });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(false); }
  };

  if (!user) return <div className="text-gray-500 p-8">Not logged in as a salesperson.</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">My Settings</h2>
      <div className="max-w-lg bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <p className="text-sm text-gray-400">Logged in as</p>
          <p className="text-white font-semibold">{user.name}</p>
          <p className="text-gray-400 text-sm">{user.email}</p>
        </div>

        <form onSubmit={handleSave} className="space-y-4 border-t border-gray-800 pt-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Forward Calls To (your personal cell)
            </label>
            <input
              value={forwardNumber}
              onChange={e => setForwardNumber(e.target.value)}
              placeholder="Your mobile number e.g. (469) 361-1077"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-600 mt-1">
              Inbound calls to your SignalWire number and Press 1 transfers will forward here.
            </p>
          </div>

          {msg && (
            <div className={`p-3 rounded-lg text-sm ${msg.type === 'error' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving || !loaded}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </div>
    </div>
  );
}
