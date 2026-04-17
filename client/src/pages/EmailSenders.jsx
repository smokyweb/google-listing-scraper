import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function EmailSenders() {
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', email: '', name: '', is_default: false });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => apiFetch('/email-senders').then(data => { setSenders(data); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/email-senders', { method: 'POST', body: JSON.stringify(form) });
      setMsg({ type: 'success', text: 'Email sender added' });
      setForm({ label: '', email: '', name: '', is_default: false });
      setShowAdd(false); load();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    finally { setSaving(false); }
  };

  const handleSetDefault = async (id) => {
    await apiFetch(`/email-senders/${id}/set-default`, { method: 'POST' });
    setMsg({ type: 'success', text: 'Default sender updated' });
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this sender?')) return;
    await apiFetch(`/email-senders/${id}`, { method: 'DELETE' });
    load();
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Email Senders</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
          + Add Sender
        </button>
      </div>

      <div className="mb-4 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-sm text-gray-400">
        <p className="font-medium text-gray-300 mb-1">How to add a Mailgun sender:</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Log into <strong>app.mailgun.com</strong> → Sending → Domains</li>
          <li>Verify your domain OR add a specific sender under "Authorized Recipients" (sandbox mode)</li>
          <li>Add the verified email address below — it will appear in the "From" dropdown on email campaigns</li>
          <li>Each sales user can be assigned a default sender in <strong>Sales Users</strong></li>
        </ol>
      </div>

      {msg && <div className={`mb-4 p-4 rounded-lg text-sm ${msg.type==='error' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>{msg.text}</div>}

      {showAdd && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Add Email Sender</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs text-gray-400">Label *</label><input value={form.label} onChange={e=>setForm({...form,label:e.target.value})} placeholder="e.g. Sales Team" required className={inp} /></div>
              <div><label className="text-xs text-gray-400">Email Address *</label><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="sales@yourdomain.com" required className={inp} /></div>
              <div><label className="text-xs text-gray-400">Display Name (optional)</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Bluestone Sales" className={inp} /></div>
              <div className="flex items-center gap-3 pt-5">
                <input type="checkbox" id="is_default" checked={form.is_default} onChange={e=>setForm({...form,is_default:e.target.checked})} className="rounded bg-gray-800 border-gray-600" />
                <label htmlFor="is_default" className="text-sm text-gray-300">Set as default sender</label>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50">{saving ? 'Adding...' : 'Add Sender'}</button>
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : senders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg mb-2">No email senders added yet</p>
            <p className="text-sm">Add verified Mailgun email addresses to use as "From" addresses in campaigns.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Label</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Email</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Display Name</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Default</th>
                <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {senders.map(s => (
                <tr key={s.id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{s.label}</td>
                  <td className="px-6 py-4 text-gray-300 font-mono text-sm">{s.email}</td>
                  <td className="px-6 py-4 text-gray-400">{s.name || '—'}</td>
                  <td className="px-6 py-4">
                    {s.is_default ? (
                      <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded text-xs font-medium">✓ Default</span>
                    ) : (
                      <button onClick={() => handleSetDefault(s.id)} className="text-xs text-gray-400 hover:text-blue-400 transition-colors">Set default</button>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
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
