import { NavLink } from 'react-router-dom';
import { clearToken } from '../api';

const nav = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/scraper', label: 'Scraper', icon: '🔍' },
  { to: '/history', label: 'Scrape History', icon: '📜' },
  { to: '/leads', label: 'Leads', icon: '👥' },
  { to: '/import', label: 'Import Leads', icon: '📂' },
  { to: '/email', label: 'Email Campaign', icon: '✉️' },
  { to: '/email-senders', label: 'Email Senders', icon: '📧' },
  { to: '/quick-email', label: 'Quick Email', icon: '✏️' },
  { to: '/calls', label: 'Phone Calls', icon: '📞' },
  { to: '/dialer', label: 'Dialer', icon: '☎️' },
  { to: '/voice', label: 'Voice Message', icon: '🎙️' },
  { to: '/callbacks', label: 'Call Backs', icon: '🔔' },
  { to: '/voicemail-drop', label: 'Voicemail Drop', icon: '📩' },
  { to: '/sms', label: 'SMS', icon: '💬' },
  { to: '/sms-inbox', label: 'SMS Inbox', icon: '📨' },
  { to: '/sales-users', label: 'Sales Users', icon: '👥' },
  { to: '/phone-numbers', label: 'Phone Numbers', icon: '📱' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  ...(isAdmin ? [{ to: '/settings', label: 'Settings', icon: '⚙️' }] : [{ to: '/my-profile', label: 'My Settings', icon: '⚙️' }]),
];

export default function Sidebar() {
  const role = localStorage.getItem('gls_role') || 'admin';
  const user = (() => { try { return JSON.parse(localStorage.getItem('gls_user') || 'null'); } catch { return null; } })();
  const isAdmin = role === 'admin';

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white">GLS Portal</h1>
        <p className="text-xs text-gray-500">Google Listing Scraper</p>
        {user ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold shrink-0">{user.name?.[0]?.toUpperCase() || 'S'}</div>
            <div className="min-w-0">
              <p className="text-xs text-white font-medium truncate">{user.name}</p>
              <span className="text-xs text-blue-400">Sales Team</span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-600 mt-1 block">Admin</span>
        )}
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={() => { clearToken(); window.location.href = '/login'; }}
          className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
