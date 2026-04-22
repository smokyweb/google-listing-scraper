import { useState } from 'react';
import { login, setToken } from '../api';

async function salespersonLogin(email, password) {
  const res = await fetch('/api/auth/salesperson-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  setToken(data.token);
  // Store user info for session
  localStorage.setItem('gls_user', JSON.stringify(data.user));
  localStorage.setItem('gls_role', data.role);
  return data;
}

export default function Login({ onLogin }) {
  const [tab, setTab] = useState('admin'); // 'admin' | 'salesperson'
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [spPassword, setSpPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(password);
      localStorage.setItem('gls_role', 'admin');
      localStorage.removeItem('gls_user');
      onLogin();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleSalespersonSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await salespersonLogin(email, spPassword);
      onLogin();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const inp = 'w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-white mb-1 text-center">GLS Portal</h1>
        <p className="text-sm text-gray-500 mb-5 text-center">Google Listing Scraper</p>

        {/* Tabs */}
        <div className="flex rounded-lg bg-gray-800 p-1 mb-6">
          <button onClick={() => { setTab('admin'); setError(''); }}
            className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${tab === 'admin' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            Admin
          </button>
          <button onClick={() => { setTab('salesperson'); setError(''); }}
            className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${tab === 'salesperson' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            Sales Team
          </button>
        </div>

        {error && <div className="bg-red-900/50 border border-red-800 text-red-300 text-sm p-3 rounded-lg mb-4">{error}</div>}

        {tab === 'admin' && (
          <form onSubmit={handleAdminSubmit}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Admin password" className={inp} autoFocus />
            <button type="submit" disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
              {loading ? 'Signing in...' : 'Sign In as Admin'}
            </button>
          </form>
        )}

        {tab === 'salesperson' && (
          <form onSubmit={handleSalespersonSubmit}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="Your email address" className={inp} autoFocus />
            <input type="password" value={spPassword} onChange={e => setSpPassword(e.target.value)}
              placeholder="Your password" className={inp} />
            <button type="submit" disabled={loading}
              className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p className="text-xs text-gray-600 mt-3 text-center">Contact your admin if you need your login credentials.</p>
          </form>
        )}

      <div className="mt-6 pt-4 border-t border-gray-800 text-center">
        <button
          onClick={async () => {
            // Clear all caches and service workers
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map(r => r.unregister()));
            }
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            window.location.reload(true);
          }}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors underline"
        >
          🔄 Force reload (clear cache)
        </button>
      </div>
      </div>
    </div>
  );
}

