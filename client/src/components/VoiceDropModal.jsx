import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

const LABELS = {
  initiated: 'Calling your configured forward number…',
  agent_answered: 'You are connected. Calling the lead…',
  recipient_answered: 'Lead answered. You can drop the message now.',
  dropping: 'Playing the voice message to the lead…',
  completed: 'Voice message completed.',
  cancelled: 'Call cancelled.',
  failed: 'The call could not be completed.',
  mock: 'Mock mode: no call was placed.',
};

export default function VoiceDropModal({ lead, voiceScripts, selectedScriptId, scriptText, onClose }) {
  const [session, setSession] = useState(null);
  const [selectedId, setSelectedId] = useState(selectedScriptId || '');
  const [text, setText] = useState(scriptText || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const stopPolling = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  };

  const poll = async (id) => {
    try {
      const data = await apiFetch(`/voice-drop/session/${id}`);
      setSession(data);
      if (['completed', 'cancelled', 'failed', 'mock'].includes(data.state)) stopPolling();
    } catch (err) { setError(err.message); stopPolling(); }
  };

  useEffect(() => () => stopPolling(), []);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const data = await apiFetch('/voice-drop/start', {
        method: 'POST',
        body: JSON.stringify({ leadId: lead.id, scriptText: text, voiceScriptId: selectedId ? Number(selectedId) : undefined }),
      });
      setSession(data);
      if (data.sessionId) {
        await poll(data.sessionId);
        timer.current = setInterval(() => poll(data.sessionId), 2000);
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const drop = async () => {
    if (!session?.sessionId && !session?.id) return;
    setBusy(true); setError('');
    try {
      const data = await apiFetch('/voice-drop/drop-message', {
        method: 'POST', body: JSON.stringify({ sessionId: session.sessionId || session.id }),
      });
      setSession(s => ({ ...s, ...data }));
      await poll(session.sessionId || session.id);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    const id = session?.sessionId || session?.id;
    if (!id) return onClose();
    setBusy(true); setError('');
    try {
      await apiFetch('/voice-drop/cancel', { method: 'POST', body: JSON.stringify({ sessionId: id }) });
      stopPolling(); setSession(s => ({ ...s, state: 'cancelled' }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const state = session?.state;
  const active = state && !['completed', 'cancelled', 'failed', 'mock'].includes(state);
  const canDrop = state === 'recipient_answered';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div><h3 className="text-lg font-semibold text-white">Agent-assisted voice drop</h3><p className="mt-1 text-sm text-gray-400">{lead.name} · {lead.phone}</p></div>
          <button onClick={onClose} disabled={active || busy} className="text-2xl leading-none text-gray-500 hover:text-white disabled:opacity-40" aria-label="Close">×</button>
        </div>

        {!session && <>
          <p className="mb-3 text-sm text-gray-400">Your configured forward number is called first. Once you and the lead are connected, you choose when to play the message.</p>
          <label className="mb-1 block text-xs text-gray-400">Voice script</label>
          <select value={selectedId} onChange={e => { setSelectedId(e.target.value); const found = voiceScripts.find(s => String(s.id) === e.target.value); if (found) setText(found.script); }} className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white">
            <option value="">Custom / current script</option>{voiceScripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
        </>}

        {session && <div className={`rounded-lg border p-4 ${canDrop ? 'border-green-600 bg-green-900/30' : state === 'failed' ? 'border-red-700 bg-red-900/30' : 'border-gray-700 bg-gray-800/70'}`}>
          <p className="font-medium text-white">{LABELS[state] || 'Preparing call…'}</p>
          {session.error && <p className="mt-1 text-sm text-red-300">{session.error}</p>}
          {canDrop && <p className="mt-2 text-xs text-green-300">The message will play only to the lead, then both call legs will end.</p>}
        </div>}

        {error && <p className="mt-3 rounded-lg bg-red-900/40 p-3 text-sm text-red-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {!session && <><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">Back</button><button onClick={start} disabled={busy || !text.trim()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Starting…' : '📞 Start agent-assisted call'}</button></>}
          {session && active && <><button onClick={cancel} disabled={busy} className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">Cancel</button><button onClick={drop} disabled={busy || !canDrop} className="rounded-lg bg-yellow-500 px-5 py-2 text-sm font-bold text-black hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Working…' : '🎙️ Drop Voice Message'}</button></>}
          {session && !active && <button onClick={onClose} className="rounded-lg bg-gray-700 px-5 py-2 text-sm text-white hover:bg-gray-600">Close</button>}
        </div>
      </div>
    </div>
  );
}
