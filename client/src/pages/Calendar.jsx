import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/calendar/events');
      setEvents(data.events || []);
      setIsMock(data.mock);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const data = await apiFetch('/calendar/auth');
      if (data.mock) {
        alert('Google Calendar OAuth not configured. Set Client ID and Secret in Settings.');
      } else if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiFetch('/calendar/disconnect', { method: 'POST' });
      fetchEvents();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Calendar</h2>
        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {connecting ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
          {!isMock && (
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {isMock && (
        <div className="bg-yellow-900/30 border border-yellow-800 text-yellow-300 p-4 rounded-xl mb-6 text-sm">
          Google Calendar not connected. Showing mock data. Configure OAuth credentials in Settings and click Connect.
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No upcoming events</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {events.map((event) => (
              <div key={event.id} className="p-4 hover:bg-gray-800/50 flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center text-blue-400 text-lg shrink-0">
                  📅
                </div>
                <div>
                  <p className="text-white font-medium">{event.summary}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    {formatDate(event.start)} — {formatDate(event.end)}
                  </p>
                  {event.location && (
                    <p className="text-sm text-gray-500 mt-1">{event.location}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
