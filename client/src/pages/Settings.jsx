import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const SECTIONS = [
  {
    title: 'Google Places API',
    fields: [
      { key: 'google_places_api_key', label: 'API Key', type: 'password' },
    ],
  },
  {
    title: 'SignalWire',
    fields: [
      { key: 'signalwire_project_id', label: 'Project ID' },
      { key: 'signalwire_token', label: 'API Token', type: 'password' },
      { key: 'signalwire_space_url', label: 'Space URL', placeholder: 'example.signalwire.com' },
      { key: 'signalwire_phone_number', label: 'Phone Number', placeholder: '+15551234567' },
      { key: 'transfer_phone_number', label: 'Transfer Phone Number', placeholder: '+15559876543' },
    ],
  },
  {
    title: 'AI (Gemini)',
    fields: [
      { key: 'gemini_api_key', label: 'Gemini API Key', type: 'password', placeholder: 'AIza...' },
    ],
  },
  {
    title: 'ElevenLabs',
    fields: [
      { key: 'elevenlabs_api_key', label: 'API Key', type: 'password' },
      { key: 'elevenlabs_voice_id', label: 'Voice ID', placeholder: '21m00Tcm4TlvDq8ikWAM' },
    ],
  },
  {
    title: 'SMTP (Email)',
    fields: [
      { key: 'smtp_host', label: 'Host', placeholder: 'smtp.gmail.com' },
      { key: 'smtp_port', label: 'Port', placeholder: '587' },
      { key: 'smtp_user', label: 'Username' },
      { key: 'smtp_pass', label: 'Password', type: 'password' },
      { key: 'smtp_from', label: 'From Address', placeholder: 'you@example.com' },
    ],
  },
  {
    title: 'Google Calendar OAuth',
    fields: [
      { key: 'google_calendar_client_id', label: 'Client ID' },
      { key: 'google_calendar_client_secret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    title: 'Admin',
    fields: [
      { key: 'admin_password', label: 'Admin Password', type: 'password' },
    ],
  },
];

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiFetch('/settings')
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await apiFetch('/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      });
      setMessage('Settings saved successfully');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-xl text-sm ${message.startsWith('Error') ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
          {message}
        </div>
      )}

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.title} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">{section.title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {section.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm text-gray-400 mb-1">{field.label}</label>
                  <input
                    type={field.type || 'text'}
                    value={settings[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder || ''}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Environment Variables</h3>
        <p className="text-sm text-gray-400 mb-3">
          Settings can also be configured via environment variables. Env vars take priority over database settings.
        </p>
        <div className="bg-gray-800 rounded-lg p-4 font-mono text-xs text-gray-400 overflow-x-auto">
          <pre>{`GOOGLE_PLACES_API_KEY=
SIGNALWIRE_PROJECT_ID=
SIGNALWIRE_TOKEN=
SIGNALWIRE_SPACE_URL=
SIGNALWIRE_PHONE_NUMBER=
TRANSFER_PHONE_NUMBER=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
ADMIN_PASSWORD=admin
JWT_SECRET=change-me`}</pre>
        </div>
      </div>
    </div>
  );
}
