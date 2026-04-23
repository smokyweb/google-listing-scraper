import { formatEST } from '../utils/time';
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';

export default function SMSInbox() {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activePhone, setActivePhone] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = () => {
    apiFetch('/sms/inbox').then(data => {
      setMessages(data);
      // Group into conversations by from_number (for inbound) or to_number (for outbound)
      const convMap = {};
      for (const m of data) {
        const phone = m.direction === 'inbound' ? m.from_number : m.to_number;
        if (!phone) continue;
        if (!convMap[phone]) convMap[phone] = { phone, leadName: m.lead_name, unsubscribed: m.lead_unsubscribed, messages: [], unread: 0 };
        convMap[phone].messages.push(m);
        if (m.direction === 'inbound' && !m.read_at) convMap[phone].unread++;
        if (!convMap[phone].leadName && m.lead_name) convMap[phone].leadName = m.lead_name;
      }
      const convList = Object.values(convMap).sort((a, b) => {
        const aLast = a.messages[a.messages.length - 1]?.created_at || '';
        const bLast = b.messages[b.messages.length - 1]?.created_at || '';
        return bLast.localeCompare(aLast);
      });
      setConversations(convList);
    }).catch(() => {});
  };

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activePhone, messages]);

  const activeConv = conversations.find(c => c.phone === activePhone);
  const activeMessages = activeConv?.messages || [];

  const handleSend = async () => {
    if (!replyText.trim() || !activePhone) return;
    setSending(true);
    try {
      await apiFetch('/sms/reply', { method: 'POST', body: JSON.stringify({ to: activePhone, message: replyText }) });
      setReplyText('');
      load();
    } catch (err) {
      alert(err.message);
    } finally { setSending(false); }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">SMS Inbox</h2>
      <div className="flex gap-4 h-[calc(100vh-160px)] min-h-96">
        {/* Conversation List */}
        <div className="w-72 shrink-0 bg-gray-900 border border-gray-800 rounded-xl overflow-y-auto">
          <div className="p-3 border-b border-gray-800">
            <p className="text-xs text-gray-400">{conversations.length} conversations</p>
          </div>
          {conversations.length === 0 && <p className="text-gray-600 text-sm text-center p-6">No messages yet</p>}
          {conversations.map(conv => (
            <button key={conv.phone} onClick={() => setActivePhone(conv.phone)}
              className={`w-full text-left px-4 py-3 border-b border-gray-800 transition-colors ${activePhone === conv.phone ? 'bg-blue-700' : 'hover:bg-gray-800'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-white truncate">{conv.leadName || conv.phone}</span>
                {conv.unread > 0 && <span className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full ml-1 shrink-0">{conv.unread}</span>}
              </div>
              <p className="text-xs text-gray-400 truncate">{conv.phone}</p>
              {conv.unsubscribed ? <span className="text-xs text-red-400">Unsubscribed</span> : null}
              <p className="text-xs text-gray-500 truncate mt-1">
                {conv.messages[conv.messages.length - 1]?.message || ''}
              </p>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
          {!activePhone ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">Select a conversation</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-800 shrink-0">
                <p className="text-white font-medium">{activeConv?.leadName || activePhone}</p>
                <p className="text-xs text-gray-400">{activePhone}</p>
                {activeConv?.unsubscribed ? <span className="text-xs text-red-400">âš  Unsubscribed</span> : null}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {activeMessages.map(m => (
                  <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-4 py-2 rounded-2xl text-sm ${m.direction === 'outbound' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
                      <p>{m.message}</p>
                      <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-blue-200' : 'text-gray-500'}`}>
                        {formatEST(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-4 border-t border-gray-800 shrink-0 flex gap-2">
                <input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder={activeConv?.unsubscribed ? 'Lead is unsubscribed' : 'Type a reply...'}
                  disabled={activeConv?.unsubscribed}
                  className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <button onClick={handleSend} disabled={sending || !replyText.trim() || activeConv?.unsubscribed}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

