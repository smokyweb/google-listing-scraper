/**
 * VoiceDropModal
 *
 * Supports two target types:
 *   - lead prop (object with .id, .name, .phone) — used from /calls lead rows
 *   - targetPhone prop (string, E.164 or 10-digit) — used from manual Dialer page
 *
 * Two modes (passed as the `mode` prop):
 *
 *   mode='voicemail'  — "Voicemail Drop"
 *     System calls the recipient directly. No salesperson leg.
 *     Audio plays automatically when the call connects (human or voicemail).
 *     After the message the recipient hears the standard Press 1/2/3/4 menu.
 *     UI just shows progress; there is no "Drop" button.
 *
 *   mode='agent'      — "Live Voice Message"
 *     Calls salesperson's forward number first. Salesperson joins conference
 *     in LISTEN-ONLY (muted) mode — they can hear the recipient but the
 *     recipient cannot hear them.
 *     Salesperson clicks "Drop Voice Message" when ready.
 *     After drop, audio plays to recipient only; agent leg is hung up immediately.
 *     Recipient then hears Press 1/2/3/4 menu.
 *     Requires forward_number configured on the salesperson's account.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

// Human-readable state labels per mode
const LABELS = {
  voicemail: {
    initiated: 'Calling recipient…',
    active: 'Call connected — message playing now',
    completed: 'Message delivered ✓',
    failed: 'Call could not be completed.',
    cancelled: 'Call cancelled.',
    mock: 'Mock mode — no call was placed.',
  },
  agent: {
    initiated: 'Calling your forward number…',
    agent_answered: 'Connected. Now calling the recipient…',
    recipient_answered: 'Recipient answered — you are listening. Click Drop when ready.',
    dropping: 'Playing message to recipient…',
    completed: 'Message delivered ✓',
    failed: 'Call could not be completed.',
    cancelled: 'Call cancelled.',
    mock: 'Mock mode — no call was placed.',
  },
};

const TERMINAL = ['completed', 'cancelled', 'failed', 'mock'];

export default function VoiceDropModal({
  lead,          // { id, name, phone } — pass when dropping to a lead row
  targetPhone,   // string — pass when dropping to an arbitrary number (Dialer)
  voiceScripts,
  liveVoiceScripts,
  voicemailScripts,
  selectedScriptId,
  scriptText,
  mode = 'voicemail',
  onClose,
}) {
  const [sessionId, setSessionId] = useState(null);
  const [sessionState, setSessionState] = useState(null);
  const [sessionError, setSessionError] = useState('');
  const [selectedId, setSelectedId] = useState(selectedScriptId || '');
  const [text, setText] = useState(scriptText || '');
  const liveScripts = liveVoiceScripts || (mode === 'agent' ? voiceScripts : []);
  const vmScripts = voicemailScripts || (mode === 'voicemail' ? voiceScripts : []);
  const activeLive = liveScripts.find(s => s.is_active) || liveScripts[0];
  const activeVm = vmScripts.find(s => s.is_active) || vmScripts[0];
  const [liveScriptId, setLiveScriptId] = useState(activeLive ? String(activeLive.id) : '');
  const [liveText, setLiveText] = useState(activeLive?.script || '');
  const [vmScriptId, setVmScriptId] = useState(activeVm ? String(activeVm.id) : '');
  const [vmText, setVmText] = useState(activeVm?.script || '');
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState('');
  const timer = useRef(null);

  const isVoicemail = mode === 'voicemail';
  const isAgent = mode === 'agent';
  const isTerminal = TERMINAL.includes(sessionState);
  const isActive = sessionId && !isTerminal;

  // Display name/number in the header
  const targetLabel = lead
    ? `${lead.name} · ${lead.phone}`
    : targetPhone || '—';

  const modeLabel = isVoicemail ? 'Voicemail Drop' : 'Live Voice Message';

  const stopPolling = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  const poll = async (id) => {
    try {
      const data = await apiFetch(`/voice-drop/session/${id}`);
      setSessionState(data.state);
      if (data.error) setSessionError(data.error);
      if (TERMINAL.includes(data.state)) stopPolling();
    } catch (err) {
      setUiError(err.message);
      stopPolling();
    }
  };

  const start = async () => {
    setBusy(true);
    setUiError('');
    try {
      const payload = {
        scriptText: text,
        voiceScriptId: selectedId ? Number(selectedId) : undefined,
        mode,
      };
      // Pass either leadId or targetPhone — never both
      if (lead) {
        payload.leadId = lead.id;
      } else {
        payload.targetPhone = targetPhone;
      }

      const data = await apiFetch('/voice-drop/start', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const id = data.sessionId;
      setSessionId(id);
      setSessionState(data.state);
      await poll(id);
      if (!TERMINAL.includes(data.state)) {
        timer.current = setInterval(() => poll(id), 2000);
      }
    } catch (err) {
      setUiError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const drop = async (dropText = text, dropScriptId = selectedId) => {
    if (!sessionId) return;
    setBusy(true);
    setUiError('');
    try {
      await apiFetch('/voice-drop/drop-message', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          scriptText: dropText,
          voiceScriptId: dropScriptId ? Number(dropScriptId) : undefined,
        }),
      });
      // State will update via next poll
    } catch (err) {
      setUiError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!sessionId) return onClose();
    setBusy(true);
    try {
      await apiFetch('/voice-drop/cancel', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      stopPolling();
      setSessionState('cancelled');
    } catch (err) {
      setUiError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // State-derived UI values
  const labels = LABELS[mode] || LABELS.voicemail;
  const stateLabel = labels[sessionState] || 'Preparing…';
  const canDrop = isAgent && sessionState === 'recipient_answered';
  const isDropping = sessionState === 'dropping';
  const isSuccess = sessionState === 'completed';
  const isFailed = sessionState === 'failed';

  const statusBorderColor = isSuccess
    ? 'border-green-600 bg-green-900/30'
    : isFailed
    ? 'border-red-700 bg-red-900/30'
    : canDrop
    ? 'border-yellow-500 bg-yellow-900/25'
    : 'border-gray-700 bg-gray-800/70';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">

        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{modeLabel}</h3>
            <p className="mt-0.5 text-sm text-gray-400">{targetLabel}</p>
          </div>
          <button
            onClick={onClose}
            disabled={isActive && !isFailed && !isDropping}
            className="ml-4 text-2xl leading-none text-gray-500 hover:text-white disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Mode description (before session starts) */}
        {!sessionId && (
          <div className="mb-4 rounded-lg bg-gray-800/50 border border-gray-700 p-3 text-xs text-gray-400 space-y-1">
            {isVoicemail ? (
              <>
                <p className="font-medium text-gray-300">📱 Voicemail Drop — no salesperson leg</p>
                <p>
                  The system calls the recipient directly. The message plays automatically whether a
                  human answers or it goes to voicemail. Afterward, the recipient hears the
                  standard Press 1/2/3/4 menu.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-300">🎙️ Live Voice Message — listen-only monitoring</p>
                <p>
                  Your configured forward number is called first. You join the call
                  <strong className="text-white"> muted</strong> — you can hear the recipient
                  but they cannot hear you. Click "Drop Voice Message" when ready. The pre-recorded
                  script plays to the recipient only; your line disconnects immediately after.
                  Recipient then hears Press 1/2/3/4 menu.
                </p>
              </>
            )}
          </div>
        )}

        {/* Script selector + textarea (pre-start) */}
        {!sessionId && (
          <>
            <label className="mb-1 block text-xs text-gray-400">Voice script</label>
            <select
              value={selectedId}
              onChange={e => {
                setSelectedId(e.target.value);
                const found = (voiceScripts || []).find(s => String(s.id) === e.target.value);
                if (found) setText(found.script);
              }}
              className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              <option value="">Custom / current script</option>
              {(voiceScripts || []).map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}{s.is_active ? ' ✓' : ''}
                </option>
              ))}
            </select>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={5}
              placeholder="Message script…"
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </>
        )}

        {/* Status panel (after session starts) */}
        {sessionId && (
          <div className={`rounded-lg border p-4 ${statusBorderColor}`}>
            <p className="font-medium text-white">{stateLabel}</p>
            {sessionError && (
              <p className="mt-1 text-sm text-red-300">{sessionError}</p>
            )}
            {canDrop && (
              <>
              <div className="mb-3 grid gap-2 sm:grid-cols-2 text-xs">
                <label className="text-yellow-100">Live Voice script
                  <select value={liveScriptId} onChange={e => {
                    setLiveScriptId(e.target.value);
                    const found = liveScripts.find(s => String(s.id) === e.target.value);
                    if (found) setLiveText(found.script);
                  }} className="mt-1 w-full rounded border border-yellow-700 bg-gray-800 px-2 py-1.5 text-white">
                    {liveScripts.map(s => <option key={s.id} value={String(s.id)}>{s.name}{s.is_active ? ' âœ“' : ''}</option>)}
                  </select>
                </label>
                <label className="text-blue-200">Voicemail script
                  <select value={vmScriptId} onChange={e => {
                    setVmScriptId(e.target.value);
                    const found = vmScripts.find(s => String(s.id) === e.target.value);
                    if (found) setVmText(found.script);
                  }} className="mt-1 w-full rounded border border-blue-700 bg-gray-800 px-2 py-1.5 text-white">
                    {vmScripts.map(s => <option key={s.id} value={String(s.id)}>{s.name}{s.is_active ? ' âœ“' : ''}</option>)}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs text-yellow-200">
                You are in listen-only mode — the recipient cannot hear you. Click "Drop Voice
                Message" when ready. The pre-recorded script plays to the recipient; your line
                disconnects immediately after. Recipient then hears the Press 1/2/3/4 menu.
              </p>
              </>
            )}
            {isSuccess && isVoicemail && (
              <p className="mt-2 text-xs text-green-300">
                The script was played. The recipient heard the Press 1/2/3/4 menu after.
              </p>
            )}
            {isSuccess && isAgent && (
              <p className="mt-2 text-xs text-green-300">
                Message dropped. Recipient heard the Press 1/2/3/4 menu after.
              </p>
            )}
          </div>
        )}

        {/* UI error */}
        {uiError && (
          <p className="mt-3 rounded-lg bg-red-900/40 p-3 text-sm text-red-300">{uiError}</p>
        )}

        {/* Action buttons */}
        <div className="mt-5 flex flex-wrap justify-end gap-2">

          {/* Pre-start */}
          {!sessionId && (
            <>
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                Back
              </button>
              <button
                onClick={start}
                disabled={busy || !text.trim()}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy
                  ? isVoicemail ? 'Generating audio…' : 'Starting…'
                  : isVoicemail ? '📱 Start Voicemail Drop' : '🎙️ Start Live Voice Message'}
              </button>
            </>
          )}

          {/* Active session */}
          {sessionId && isActive && (
            <>
              <button
                onClick={cancel}
                disabled={busy || isDropping}
                className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
              >
                Cancel
              </button>
              {isAgent && (
                <>
                <button
                  onClick={() => drop(liveText, liveScriptId)}
                  disabled={busy || !canDrop || !liveText.trim()}
                  className="rounded-lg bg-yellow-500 px-5 py-2 text-sm font-bold text-black hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy && isDropping ? 'Dropping…' : '🎙️ Drop Voice Message'}
                </button>
                <button
                  onClick={() => drop(vmText, vmScriptId)}
                  disabled={busy || !canDrop || !vmText.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy && isDropping ? 'Droppingâ€¦' : 'ðŸ“± Drop Voicemail'}
                </button>
                </>
              )}
            </>
          )}

          {/* The recipient may remain on the IVR/transfer call after the
              message is dropped. Let the salesperson close the screen
              without cancelling that live call. */}
          {sessionId && isDropping && (
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg bg-gray-700 px-5 py-2 text-sm text-white hover:bg-gray-600 disabled:opacity-40"
            >
              Close
            </button>
          )}

          {/* Terminal state */}
          {sessionId && isTerminal && (
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-700 px-5 py-2 text-sm text-white hover:bg-gray-600"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
