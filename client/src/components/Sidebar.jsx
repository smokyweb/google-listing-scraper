import { NavLink } from 'react-router-dom';
import { clearToken } from '../api';

const nav = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/scraper', label: 'Scraper', icon: '🔍' },
  { to: '/history', label: 'Scrape History', icon: '📜' },
  { to: '/leads', label: 'Leads', icon: '👥' },
  { to: '/email', label: 'Email Campaign', icon: '✉️' },
  { to: '/calls', label: 'Phone Calls', icon: '📞' },
  { to: '/voice', label: 'Voice Message', icon: '🎙️' },
  { to: '/callbacks', label: 'Call Backs', icon: '🔔' },
  { to: '/sms', label: 'SMS', icon: '💬' },
  { to: '/sms-inbox', label: 'SMS Inbox', icon: '📨' },
  { to: '/sales-users', label: 'Sales Users', icon: '👥' },
  { to: '/phone-numbers', label: 'Phone Numbers', icon: '📱' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white">GLS Admin</h1>
        <p className="text-xs text-gray-500">Google Listing Scraper</p>
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
