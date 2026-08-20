/**
 * Dialer — manual outbound dialer for arbitrary phone numbers.
 *
 * Tabs:
 *   📞 Make a Call  — agent-first or direct call (existing behaviour)
 *   💬 Send SMS     — manual SMS (existing behaviour)
 *   🎙️ Voice Drop   — NEW: Voicemail Drop or Live Voice Message to any number.
 *                     Uses the logged-in salesperson's assigned SignalWire
 *                     number / forward number — same rules as /calls rows.
 *                     No lead_id required.
 *
 * Voice Drop tab behaviour:
 *   • Phone input validated to E.164 / 10-digit US before starting.
 *   • "Voicemail Drop" → mode='voicemail'  (system calls recipient directly,
 *     plays script, no salesperson leg).
 *   • "Live Voice Message" → mode='agent'  (salesperson's forward number rings
 *     first, they join muted/listen-only, then manually drop the script).
 *   • Active session panel shows real-time state via 2-second polling.
 *   • "Drop Voice Message" button appears only after recipient answers (agent mode).
 *   • Cancel button hangs up all legs.
 *   • All controls reset after a terminal state so a new session can be started.
 */

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';

// ── Constants ──────────────────────────────────────────────────────────────

const TERMINAL = ['completed', 'cancelled', 'failed', 'mock'];

const STATE_LABELS = {
  voicemail: {
    initiated:  'Calling recipient…',
    active:     'Call connected — message playing now',
    completed:  'Message delivered ✓',
    failed:     'Call could not be completed.',
    cancelled:  'Cancelled.',
    mock:       'Mock mode — no call was placed.',
  },
  agent: {
    initiated:        'Calling your forward number…',
    agent_answered:   'Connected. Now calling the recipient…',
    recipient_answered: 'Recipient answered — you are listening (muted). Click Drop when ready.',
    dropping:         'Playing message to recipient…',
    completed:        'Message delivered ✓',
    failed:           'Call could not be completed.',
    cancelled:        'Cancelled.',
    mock:             'Mock mode — no call was placed.',
  },
};

// ── Phone validation helper ─────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return '';
  let n = raw.replace(/\D/g, '');
  if (n.length === 10) n = '1' + n;
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}

function isValidPhone(raw) {
  const n = normalizePhone(raw);
  return /^\+\d{10,15}$/.test(n);
}

// ── Component ───────────────────────────────────────────────────────────────

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

  // Voice drop state
  const [voiceScripts, setVoiceScripts] = useState([]);
  const [vdScriptId, setVdScriptId] = useState('');
  const [vdScriptText, setVdScriptText] = useState('');

  // Active session state
  const [vdSession, setVdSession] = useState(null);    // { sessionId, mode }
  const [vdState, setVdState] = useState(null);        // string state from server
  const [vdStateError, setVdStateError] = useState('');
  const [vdBusy, setVdBusy] = useState(false);
  const [vdUiError, setVdUiError] = useState('');
  const vdTimer = useRef(null);

  // Derived voice-drop state
  const vdTerminal = TERMINAL.includes(vdState);
  const vdActive = vdSession && !vdTerminal;
  const vdCanDrop = vdSession?.mode === 'agent' && vdState === 'recipient_answered';
  const vdIsDropping = vdState === 'dropping';

  useEffect(() => {
    apiFetch('/phone-numbers').then(data => {
      setPhoneNumbers(data);
      const def = data.find(n => n.is_default);
      if (def) setFromNumberId(String(def.id));
    }).catch(() => {});

    apiFetch('/voice-scripts').then(data => {
      setVoiceScripts(data);
      const active = data.find(s => s.is_active);
      if (active) {
        setVdScriptId(String(active.id));
        setVdScriptText(active.script);
      }
    }).catch(() => {});
  }, []);

  // Cleanup polling on unmount
  useEffect(() => () => stopVdPolling(), []);

  // ── Voice drop polling ──────────────────────────────────────────────────

  const stopVdPolling = () => {
    if (vdTimer.current) { clearInterval(vdTimer.current); vdTimer.current = null; }
  };

  const pollSession = async (sessionId) => {
    try {
      const data = await apiFetch(`/voice-drop/session/${sessionId}`);
      setVdState(data.state);
      if (data.error) setVdStateError(data.error);
      if (TERMINAL.includes(data.state)) stopVdPolling();
    } catch (err) {
      setVdUiError(err.message);
      stopVdPolling();
    }
  };

  // ── Voice drop actions ──────────────────────────────────────────────────

  const startVoiceDrop = async (mode) => {
    if (!toNumber) { setVdUiError('Enter a phone number first.'); return; }
    if (!isValidPhone(toNumber)) {
      setVdUiError('Invalid phone number. Enter a 10-digit US number or E.164 (+1XXXXXXXXXX).');
      return;
    }
    if (!vdScriptText.trim()) { setVdUiError('Enter or select a script first.'); return; }

    setVdBusy(true);
    setVdUiError('');
    setVdStateError('');
    setVdSession(null);
    setVdState(null);
    stopVdPolling();

    try {
      const data = await apiFetch('/voice-drop/start', {
        method: 'POST',
        body: JSON.stringify({
          targetPhone: toNumber,
          scriptText: vdScriptText,
          voiceScriptId: vdScriptId ? Number(vdScriptId) : undefined,
          mode,
        }),
      });
      const session = { sessionId: data.sessionId, mode };
      setVdSession(session);
      setVdState(data.state);
      await pollSession(data.sessionId);
      if (!TERMINAL.includes(data.state)) {
        vdTimer.current = setInterval(() => pollSession(data.sessionId), 2000);
      }
    } catch (err) {
      setVdUiError(err.message);
    } finally {
      setVdBusy(false);
    }
  };

  const dropVoiceMessage = async () => {
    if (!vdSession) return;
    setVdBusy(true);
    setVdUiError('');
    try {
      await apiFetch('/voice-drop/drop-message', {
        method: 'POST',
        body: JSON.stringify({ sessionId: vdSession.sessionId }),
      });
      // State will update on next poll
    } catch (err) {
      setVdUiError(err.message);
    } finally {
      setVdBusy(false);
    }
  };

  const cancelVoiceDrop = async () => {
    if (!vdSession) { resetVdSession(); return; }
    setVdBusy(true);
    try {
      await apiFetch('/voice-drop/cancel', {
        method: 'POST',
        body: JSON.stringify({ sessionId: vdSession.sessionId }),
      });
      stopVdPolling();
      setVdState('cancelled');
    } catch (err) {
      setVdUiError(err.message);
    } finally {
      setVdBusy(false);
    }
  };

  const resetVdSession = () => {
    stopVdPolling();
    setVdSession(null);
    setVdState(null);
    setVdStateError('');
    setVdUiError('');
  };

  // ── Regular call / SMS handlers (unchanged) ─────────────────────────────

  const handleCall = async () => {
    if (!toNumber) return;
    setCalling(true); setCallResult(null);
    try {
      const data = await apiFetch('/dialer/call', {
        method: 'POST',
        body: JSON.stringify({
          toNumber,
          fromNumberId: fromNumberId || undefined,
          agentNumber: agentNumber || undefined,
        }),
      });
      setCallResult({
        success: true,
        message: data.mock
          ? `[Mock] Call queued to ${toNumber}`
          : data.mode === 'agent-first'
          ? `✅ Your phone will ring first — answer to connect to ${toNumber}`
          : `✅ Call initiated to ${toNumber}`,
      });
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
        body: JSON.stringify({
          toNumber,
          message,
          fromNumberId: fromNumberId || undefined,
        }),
      });
      setSmsResult({
        success: true,
        message: data.mock ? `[Mock] SMS sent to ${toNumber}` : `✅ SMS sent to ${toNumber}`,
      });
      setMessage('');
    } catch (err) {
      setSmsResult({ success: false, message: err.message });
    } finally { setSending(false); }
  };

  // ── UI helpers ──────────────────────────────────────────────────────────

  const inp = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

  const vdStateLabels = vdSession
    ? STATE_LABELS[vdSession.mode] || STATE_LABELS.voicemail
    : STATE_LABELS.voicemail;

  const vdStateLabel = vdStateLabels[vdState] || 'Preparing…';

  const vdStatusBg = vdState === 'completed'
    ? 'border-green-600 bg-green-900/30 text-green-200'
    : vdState === 'failed' || vdState === 'cancelled'
    ? 'border-red-700 bg-red-900/30 text-red-200'
    : vdCanDrop
    ? 'border-yellow-500 bg-yellow-900/25 text-yellow-100'
    : 'border-gray-700 bg-gray-800/70 text-gray-200';

  const tabs = [
    { id: 'call', label: '📞 Make a Call' },
    { id: 'sms',  label: '💬 Send SMS' },
    { id: 'vd',   label: '🎙️ Voice Drop' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Dialer</h2>
      <div className="max-w-lg">
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-3 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-4">

            {/* Shared: Caller ID / From number */}
            {phoneNumbers.length > 0 && activeTab !== 'vd' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {activeTab === 'call' ? 'Caller ID' : 'Sending From'}
                </label>
                <select
                  value={fromNumberId}
                  onChange={e => setFromNumberId(e.target.value)}
                  className={inp}
                >
                  <option value="">Use default number</option>
                  {phoneNumbers.map(n => (
                    <option key={n.id} value={String(n.id)}>
                      {n.label} — {n.number}{n.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Shared: Target phone number */}
            {activeTab !== 'vd' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {activeTab === 'call' ? "Lead's Phone Number" : 'Send To'}
                </label>
                <input
                  value={toNumber}
                  onChange={e => setToNumber(e.target.value)}
                  placeholder="(555) 123-4567 or +15551234567"
                  className={inp}
                  onKeyDown={e => e.key === 'Enter' && activeTab === 'sms' && handleSMS()}
                />
              </div>
            )}

            {/* ── CALL TAB ── */}
            {activeTab === 'call' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Your Phone Number{' '}
                    <span className="text-gray-600">(optional — rings your phone first, then bridges to lead)</span>
                  </label>
                  <input
                    value={agentNumber}
                    onChange={e => setAgentNumber(e.target.value)}
                    placeholder="Your mobile: (865) 237-1364"
                    className={inp}
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    If set: your phone rings → you answer → auto-connects to lead. For salespeople, leaving this blank uses your configured forward number. Leave blank for a direct call when no forward number is configured.
                  </p>
                </div>
                <button
                  onClick={handleCall}
                  disabled={calling || !toNumber}
                  className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-lg"
                >
                  {calling ? 'Calling...' : '📞 Call Now'}
                </button>
                {callResult && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      callResult.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                    }`}
                  >
                    {callResult.message}
                  </div>
                )}
              </>
            )}

            {/* ── SMS TAB ── */}
            {activeTab === 'sms' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Message</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={4}
                    placeholder="Type your message..."
                    className={`${inp} resize-none`}
                  />
                  <p className="text-xs text-gray-600 mt-1">{message.length}/160 characters</p>
                </div>
                <button
                  onClick={handleSMS}
                  disabled={sending || !toNumber || !message}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-lg"
                >
                  {sending ? 'Sending...' : '💬 Send SMS'}
                </button>
                {smsResult && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      smsResult.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                    }`}
                  >
                    {smsResult.message}
                  </div>
                )}
              </>
            )}

            {/* ── VOICE DROP TAB ── */}
            {activeTab === 'vd' && (
              <div className="space-y-4">

                {/* Phone input — with E.164 hint */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Recipient Phone Number <span className="text-gray-600">(E.164 or 10-digit US)</span>
                  </label>
                  <input
                    value={toNumber}
                    onChange={e => { setToNumber(e.target.value); setVdUiError(''); }}
                    placeholder="+15551234567 or (555) 123-4567"
                    className={`${inp} ${
                      toNumber && !isValidPhone(toNumber)
                        ? 'border-red-600 focus:border-red-500'
                        : toNumber && isValidPhone(toNumber)
                        ? 'border-green-600 focus:border-green-500'
                        : ''
                    }`}
                    disabled={!!vdSession && !vdTerminal}
                  />
                  {toNumber && !isValidPhone(toNumber) && (
                    <p className="text-xs text-red-400 mt-1">
                      Enter a valid US number (10 digits) or E.164 (+1XXXXXXXXXX).
                    </p>
                  )}
                  {toNumber && isValidPhone(toNumber) && (
                    <p className="text-xs text-green-400 mt-1">
                      ✓ {normalizePhone(toNumber)}
                    </p>
                  )}
                </div>

                {/* Script picker + editor — only before session starts */}
                {!vdSession && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Voice Script</label>
                      <select
                        value={vdScriptId}
                        onChange={e => {
                          setVdScriptId(e.target.value);
                          const found = voiceScripts.find(s => String(s.id) === e.target.value);
                          if (found) setVdScriptText(found.script);
                        }}
                        className={inp}
                      >
                        <option value="">— Custom script —</option>
                        {voiceScripts.map(s => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name}{s.is_active ? ' ✓ (active)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Script Text</label>
                      <textarea
                        value={vdScriptText}
                        onChange={e => { setVdScriptText(e.target.value); setVdScriptId(''); }}
                        rows={5}
                        placeholder="Enter the message to play to the recipient…"
                        className={`${inp} resize-none`}
                      />
                    </div>
                  </>
                )}

                {/* Mode descriptions — shown before starting */}
                {!vdSession && (
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-1">
                      <p className="font-medium text-blue-300">📱 Voicemail Drop</p>
                      <p>System calls recipient directly. Script plays automatically (human or voicemail). No salesperson leg created.</p>
                    </div>
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-1">
                      <p className="font-medium text-yellow-300">🎙️ Live Voice Message</p>
                      <p>Your forward number rings first. You join <strong className="text-white">muted</strong> (listen-only). Click Drop when ready to play the script.</p>
                    </div>
                  </div>
                )}

                {/* Action buttons — pre-session */}
                {!vdSession && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => startVoiceDrop('voicemail')}
                      disabled={vdBusy || !toNumber || !isValidPhone(toNumber) || !vdScriptText.trim()}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm"
                    >
                      {vdBusy ? 'Starting…' : '📱 Voicemail Drop'}
                    </button>
                    <button
                      onClick={() => startVoiceDrop('agent')}
                      disabled={vdBusy || !toNumber || !isValidPhone(toNumber) || !vdScriptText.trim()}
                      className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm"
                    >
                      {vdBusy ? 'Starting…' : '🎙️ Live Voice Message'}
                    </button>
                  </div>
                )}

                {/* Active session status panel */}
                {vdSession && (
                  <div className={`rounded-lg border p-4 space-y-2 ${vdStatusBg}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide opacity-70">
                          {vdSession.mode === 'voicemail' ? '📱 Voicemail Drop' : '🎙️ Live Voice Message'}
                        </p>
                        <p className="font-medium mt-0.5">{vdStateLabel}</p>
                      </div>
                      {/* Animated spinner for active states */}
                      {vdActive && !vdCanDrop && (
                        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60 shrink-0 ml-2" />
                      )}
                    </div>

                    {vdStateError && (
                      <p className="text-xs text-red-300">{vdStateError}</p>
                    )}

                    {vdCanDrop && (
                      <p className="text-xs opacity-80">
                        You are in listen-only mode — the recipient cannot hear you. Click "Drop Voice
                        Message" when ready. Your line disconnects immediately after the script plays.
                      </p>
                    )}

                    {vdState === 'completed' && (
                      <p className="text-xs opacity-80">
                        Script delivered. Recipient heard the Press 1/2/3/4 menu after.
                      </p>
                    )}
                  </div>
                )}

                {/* Session controls */}
                {vdSession && vdActive && (
                  <div className="flex gap-2">
                    {vdIsDropping ? (
                      <button
                        onClick={resetVdSession}
                        disabled={vdBusy}
                        className="flex-1 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-600 disabled:opacity-40"
                      >
                        Close
                      </button>
                    ) : (
                    <button
                      onClick={cancelVoiceDrop}
                      disabled={vdBusy}
                      className="flex-1 py-2 border border-gray-600 text-gray-300 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    )}
                    {vdSession.mode === 'agent' && (
                      <button
                        onClick={dropVoiceMessage}
                        disabled={vdBusy || !vdCanDrop}
                        className="flex-1 py-2 bg-yellow-500 text-black font-bold rounded-lg text-sm hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {vdIsDropping ? 'Dropping…' : '🎙️ Drop Voice Message'}
                      </button>
                    )}
                  </div>
                )}

                {/* After terminal state — start new session button */}
                {vdSession && vdTerminal && (
                  <button
                    onClick={resetVdSession}
                    className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
                  >
                    ← Start Another Voice Drop
                  </button>
                )}

                {/* UI error */}
                {vdUiError && (
                  <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-sm text-red-300">
                    {vdUiError}
                  </div>
                )}

                {/* Note about number resolution */}
                {!vdSession && (
                  <p className="text-xs text-gray-600">
                    Your assigned SignalWire number and forward number are used automatically.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Help text — only for Call and SMS tabs */}
        {activeTab === 'call' && (
          <div className="mt-4 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-xs text-gray-500">
            <p className="font-medium text-gray-400 mb-1">How calls work:</p>
            <p>• <strong>With your number:</strong> SignalWire calls YOUR phone first → you pick up → auto-bridges to lead (your caller ID shows to lead)</p>
            <p>• <strong>Without your number:</strong> SignalWire calls the lead directly from the selected caller ID</p>
          </div>
        )}

        {activeTab === 'vd' && !vdSession && (
          <div className="mt-4 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-400">Voice Drop — how it works:</p>
            <p>• <strong>Voicemail Drop:</strong> SignalWire calls the recipient directly. Script plays immediately on connect. Works for live answers and voicemail boxes. No salesperson leg — fully automated.</p>
            <p>• <strong>Live Voice Message:</strong> SignalWire calls your forward number first. You join <em>muted</em> so you can hear but the recipient cannot hear you. Click "Drop Voice Message" in the app to play the pre-recorded script. Your line disconnects immediately after the script plays.</p>
            <p>• After the script, the recipient hears the Press 1/2/3/4 IVR menu (connect / callback / meeting / opt-out).</p>
          </div>
        )}
      </div>
    </div>
  );
}
