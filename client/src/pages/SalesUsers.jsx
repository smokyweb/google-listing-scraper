import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function CalendarConnectButton({ userId, currentEmail }) {
  const [status, setStatus] = useState({ connected: !!currentEmail, email: currentEmail });
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/salesperson-calendar/auth-url?userId=${userId}`);
      const popup = window.open(data.url, 'gcal_oauth', 'width=600,height=700,scrollbars=yes');
      const handler = (e) => {
        if (e.data?.type === 'gcal_connected') {
          setStatus({ connected: true, email: e.data.email });
          window.removeEventListener('message', handler);
          setLoading(false);
          popup?.close();
        }
      };
      window.addEventListener('message', handler);
      // Fallback if popup blocked
      setTimeout(() => { setLoading(false); window.removeEventListener('message', handler); }, 120000);
    } catch (err) {
      alert('Error: ' + err.message);
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar?')) return;
    await apiFetch(`/salesperson-calendar/disconnect?userId=${userId}`, { method: 'POST' });
    setStatus({ connected: false, email: null });
  };

  if (status.connected) return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-green-400">✅ {status.email}</span>
      <button onClick={handleDisconnect} className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
    </div>
  );
  return (
    <button onClick={handleConnect} disabled={loading}
      className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs transition-colors disabled:opacity-50">
      {loading ? 'Opening...' : '📅 Connect Google Calendar'}
    </button>
  );
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

export default function SalesUsers() {
  const [users, setUsers] = useState([]);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ name:'', email:'', password:'', states:[], cities:'', phone_number_id:'', forward_number:'' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => {
    apiFetch('/sales-users').then(setUsers).catch(() => {});
    apiFetch('/phone-numbers').then(setPhoneNumbers).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditUser(null); setForm({ name:'', email:'', password:'', states:[], cities:'', phone_number_id:'', forward_number:'' }); setShowAdd(true); };
  const openEdit = (u) => {
    // Set both editUser and form atomically to avoid stale closure issues
    setEditUser(u);
    setForm({
      name: u.name || '',
      email: u.email || '',
      password: '',
      states: (() => { try { return JSON.parse(u.states || '[]'); } catch { return []; } })(),
      cities: '',
      phone_number_id: u.phone_number_id ? String(u.phone_number_id) : '',
      forward_number: u.forward_number || '',
    });
    setShowAdd(true);
    setMsg(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    // Capture the current editUser.id synchronously at save time
    const saveUserId = editUser ? editUser.id : null;
    try {
      const body = { ...form, states: typeof form.states === 'string' ? form.states.split(',').map(s=>s.trim()).filter(Boolean) : form.states };
      if (!body.password) delete body.password;
      if (saveUserId) await apiFetch(`/sales-users/${saveUserId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/sales-users', { method: 'POST', body: JSON.stringify(body) });
      setMsg({ type: 'success', text: editUser ? 'User updated' : 'User added' });
      setShowAdd(false);
      load();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    await apiFetch(`/sales-users/${id}`, { method: 'DELETE' });
    load();
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Sales Users</h2>
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">+ Add User</button>
      </div>

      {msg && <div className={`mb-4 p-4 rounded-lg text-sm ${msg.type==='error' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>{msg.text}</div>}

      {showAdd && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">{editUser ? 'Edit User' : 'Add Sales User'}</h3>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs text-gray-400">Name *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required className={inp} /></div>
              <div><label className="text-xs text-gray-400">Email *</label><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required className={inp} /></div>
              <div><label className="text-xs text-gray-400">{editUser ? 'New Password (leave blank to keep)' : 'Password *'}</label><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required={!editUser} className={inp} /></div>
              <div><label className="text-xs text-gray-400">Assigned Phone Number</label>
                <select value={form.phone_number_id} onChange={e=>setForm({...form,phone_number_id:e.target.value})} className={inp}>
                  <option value="">None (use default)</option>
                  {phoneNumbers.map(n=><option key={n.id} value={n.id}>{n.label} — {n.number}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-400">Forward Incoming Calls To</label>
                <input value={form.forward_number} onChange={e=>setForm({...form,forward_number:e.target.value})} placeholder="Salesperson's personal cell: (865) 555-1234" className={inp} />
                <p className="text-xs text-gray-600 mt-0.5">Calls to their SignalWire number will forward here</p>
              </div>
              <div className="col-span-2"><label className="text-xs text-gray-400">Restricted to States (comma-separated codes, e.g. TX,CA,FL — leave blank for all)</label>
                <input value={Array.isArray(form.states) ? form.states.join(',') : form.states} onChange={e=>setForm({...form,states:e.target.value})} placeholder="TX,CA,FL" className={inp} /></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50">{saving ? 'Saving...' : editUser ? 'Update' : 'Add User'}</button>
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {users.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No sales users yet. Add users to give them restricted access to leads and campaigns.</div>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">States</th>
              <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Phone</th>
              <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Google Calendar</th>
              <th className="text-left px-4 py-3 text-xs text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-800">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-white font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-gray-300">{u.email}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{JSON.parse(u.states||'[]').join(', ') || 'All states'}</td>
                  <td className="px-4 py-3 text-gray-400 text-sm">{u.phone_number_label || 'Default'}</td>
                  <td className="px-4 py-3"><CalendarConnectButton userId={u.id} currentEmail={u.gcal_email} /></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs ${u.is_active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-3 flex gap-2">
                    <button onClick={() => openEdit(u)} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
                    <button onClick={() => handleDelete(u.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
