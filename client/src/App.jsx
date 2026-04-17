import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { verifyToken } from './api';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Scraper from './pages/Scraper';
import Leads from './pages/Leads';
import EmailCampaign from './pages/EmailCampaign';
import PhoneCalls from './pages/PhoneCalls';
import SMS from './pages/SMS';
import Calendar from './pages/Calendar';
import Settings from './pages/Settings';
import PhoneNumbers from './pages/PhoneNumbers';
import ScrapeHistory from './pages/ScrapeHistory';
import ScrapeDetail from './pages/ScrapeDetail';
import VoiceMessage from './pages/VoiceMessage';
import Callbacks from './pages/Callbacks';
import SMSInbox from './pages/SMSInbox';
import SalesUsers from './pages/SalesUsers';
import VoicemailDrop from './pages/VoicemailDrop';
import ImportLeads from './pages/ImportLeads';
import Dialer from './pages/Dialer';
import EmailSenders from './pages/EmailSenders';
import QuickEmail from './pages/QuickEmail';

function Layout({ children }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    verifyToken().then(setAuthed);
  }, []);

  if (authed === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={() => setAuthed(true)} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<Layout><Dashboard /></Layout>} />
      <Route path="/scraper" element={<Layout><Scraper /></Layout>} />
      <Route path="/history" element={<Layout><ScrapeHistory /></Layout>} />
      <Route path="/scrapes/:id" element={<Layout><ScrapeDetail /></Layout>} />
      <Route path="/leads" element={<Layout><Leads /></Layout>} />
      <Route path="/email" element={<Layout><EmailCampaign /></Layout>} />
      <Route path="/calls" element={<Layout><PhoneCalls /></Layout>} />
      <Route path="/sms" element={<Layout><SMS /></Layout>} />
      <Route path="/voice" element={<Layout><VoiceMessage /></Layout>} />
      <Route path="/callbacks" element={<Layout><Callbacks /></Layout>} />
      <Route path="/sms-inbox" element={<Layout><SMSInbox /></Layout>} />
      <Route path="/sales-users" element={<Layout><SalesUsers /></Layout>} />
      <Route path="/voicemail-drop" element={<Layout><VoicemailDrop /></Layout>} />
      <Route path="/import" element={<Layout><ImportLeads /></Layout>} />
      <Route path="/dialer" element={<Layout><Dialer /></Layout>} />
      <Route path="/email-senders" element={<Layout><EmailSenders /></Layout>} />
      <Route path="/quick-email" element={<Layout><QuickEmail /></Layout>} />
      <Route path="/phone-numbers" element={<Layout><PhoneNumbers /></Layout>} />
      <Route path="/calendar" element={<Layout><Calendar /></Layout>} />
      <Route path="/settings" element={<Layout><Settings /></Layout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
