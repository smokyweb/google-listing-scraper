import { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import StatCard from '../components/StatCard';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/stats')
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Leads" value={stats?.totalLeads ?? 0} icon="👥" />
        <StatCard label="Emails Sent" value={stats?.emailsSent ?? 0} icon="✉️" />
        <StatCard label="Calls Made" value={stats?.callsMade ?? 0} icon="📞" />
        <StatCard label="SMS Sent" value={stats?.smsSent ?? 0} icon="💬" />
        <StatCard label="Meetings Booked" value={stats?.meetingsBooked ?? 0} icon="📅" />
      </div>
    </div>
  );
}
