import { NavLink } from 'react-router-dom';
import { clearToken } from '../api';

// Admin-only nav items
const adminNav = [
  { to: '/email-senders', label: 'Email Senders' },
  { to: '/sales-users', label: 'Sales Users' },
  { to: '/phone-numbers', label: 'Phone Numbers' },
  { to: '/settings', label: 'Settings' },
];

// Shared nav items (admin + salesperson)
const sharedNav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/reports', label: 'Reports' },
  { to: '/scraper', label: 'Scraper' },
  { to: '/history', label: 'Scrape History' },
  { to: '/leads', label: 'Leads' },
  { to: '/import', label: 'Import Leads' },
  { to: '/email', label: 'Email Campaign' },
  { to: '/quick-email', label: 'Quick Email' },
  { to: '/calls', label: 'Phone Calls' },
  { to: '/dialer', label: 'Dialer' },
  { to: '/voice', label: 'Voice Message' },
  { to: '/callbacks', label: 'Call Backs' },
  { to: '/voicemail-drop', label: 'Voicemail Drop' },
  { to: '/sms', label: 'SMS' },
  { to: '/sms-inbox', label: 'SMS Inbox' },
  { to: '/calendar', label: 'Calendar' },
];

const linkClass = (isActive) =>
  `flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
    isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
  }`;

export default function Sidebar() {
  const role = localStorage.getItem('gls_role') || 'admin';
  const user = (() => { try { return JSON.parse(localStorage.getItem('gls_user') || 'null'); } catch { return null; } })();
  const isAdmin = role === 'admin';
  const visibleNav = isAdmin ? [...sharedNav, ...adminNav] : [...sharedNav, { to: '/my-profile', label: 'My Settings' }];

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white">GLS Portal</h1>
        <p className="text-xs text-gray-500">Google Listing Scraper</p>
        {user ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user.name?.[0]?.toUpperCase() || 'S'}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-white font-medium truncate">{user.name}</p>
              <span className="text-xs text-blue-400">Sales Team</span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-600 mt-1 block">Admin</span>
        )}
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => linkClass(isActive)}
          >
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={() => { clearToken(); localStorage.removeItem('gls_role'); localStorage.removeItem('gls_user'); window.location.href = '/login'; }}
          className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
