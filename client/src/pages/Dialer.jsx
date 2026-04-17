import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function Dialer() {
  const [toNumber, setToNumber] = useState('');
  const [agentNumber, setAgentNumber] = useState('');
  const [fromNumberId, setFromNumberId] = useState('');
  const [message, setMessage] = useState('');
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [smsResult, setSmsResult] = useState(null);
  const [activeTab, setActiveTab] = useState('call');

  useEffect(() => {
    apiFetch('/phone-numbers').then(data => {
      setPhoneNumbers(data);
      const def = data.find(n => n.is_default);
      if (def) setFromNumberId(String(def.id));
    }).catch(() => {});
    // Pre-fill agent number from transfer number setting
    apiFetch('/settings').then(s => { if (s.transfer_phone_number) setAgentNumber(s.transfer_phone_number.replace(/\D/g,'').replace(/^1/,'')); }).catch(()=>{});
  }, []);

  const handleCall = async () => {
    if (!toNumber) return;
    setCalling(true); setCallResult(null);
    try {
      const data = await apiFetch('/dialer/call', {
        method: 'POST',
        body: JSON.stringify({ toNumber, fromNumberId: fromNumberId || undefined, agentNumber: agentNumber || undefined }),
      });
      setCallResult({ success: true, message: data.mock ? `[Mock] Call queued to ${toNumber}` : data.mode === 'agent-first' ? `✅ Your phone will ring first — answer to connect to ${toNumber}` : `✅ Call initiated to ${toNumber}` });
    } catch (err) {
      setCallResult({ success: false, message: err.message });
    } finally { setCalling(false); }
  };

  const handleSMS = async () => {
    if (!toNumber || !message) return;
    setSending(true); setSmsResult(null);
    try {
      const data = await apiFetch('/dialer/sms', {
        method: 'POST',
        body: JSON.stringify({ toNumber, message, fromNumberId: fromNumberId || undefined }),
      });
      setSmsResult({ success: true, message: data.mock ? `[Mock] SMS sent to ${toNumber}` : `✅ SMS sent to ${toNumber}` });
      setMessage('');
    } catch (err) {
      setSmsResult({ success: false, message: err.message });
    } finally { setSending(false); }
  };

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Dialer</h2>
      <div className="max-w-lg">
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            {[{id:'call',label:'📞 Make a Call'},{id:'sms',label:'💬 Send SMS'}].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab===tab.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-4">
            {/* Caller ID */}
            {phoneNumbers.length > 0 && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">{activeTab==='call' ? 'Caller ID' : 'Sending From'}</label>
                <select value={fromNumberId} onChange={e => setFromNumberId(e.target.value)} className={inp}>
                  <option value="">Use default number</option>
                  {phoneNumbers.map(n => <option key={n.id} value={String(n.id)}>{n.label} — {n.number}{n.is_default?' (default)':''}</option>)}
                </select>
              </div>
            )}

            {/* To number */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{activeTab==='call' ? "Lead's Phone Number" : 'Send To'}</label>
              <input value={toNumber} onChange={e => setToNumber(e.target.value)} placeholder="(555) 123-4567 or +15551234567"
                className={inp} onKeyDown={e => e.key === 'Enter' && activeTab === 'sms' && handleSMS()} />
            </div>

            {activeTab === 'call' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Your Phone Number (optional — rings your phone first, then bridges to lead)</label>
                  <input value={agentNumber} onChange={e => setAgentNumber(e.target.value)} placeholder="Your mobile: (865) 237-1364"
                    className={inp} />
                  <p className="text-xs text-gray-600 mt-1">If set: your phone rings → you answer → auto-connects to lead. Leave blank for direct call.</p>
                </div>
                <button onClick={handleCall} disabled={calling || !toNumber}
                  className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-lg">
                  {calling ? 'Calling...' : '📞 Call Now'}
                </button>
                {callResult && (
                  <div className={`p-3 rounded-lg text-sm ${callResult.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                    {callResult.message}
                  </div>
                )}
              </>
            )}

            {activeTab === 'sms' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Message</label>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Type your message..."
                    className={`${inp} resize-none`} />
                  <p className="text-xs text-gray-600 mt-1">{message.length}/160 characters</p>
                </div>
                <button onClick={handleSMS} disabled={sending || !toNumber || !message}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-lg">
                  {sending ? 'Sending...' : '💬 Send SMS'}
                </button>
                {smsResult && (
                  <div className={`p-3 rounded-lg text-sm ${smsResult.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                    {smsResult.message}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-xs text-gray-500">
          <p className="font-medium text-gray-400 mb-1">How calls work:</p>
          <p>• <strong>With your number:</strong> SignalWire calls YOUR phone first → you pick up → auto-bridges to lead (your caller ID shows to lead)</p>
          <p>• <strong>Without your number:</strong> SignalWire calls the lead directly from the selected caller ID</p>
        </div>
      </div>
    </div>
  );
}
