const LEAD_STATUS_COLORS = {
  new: 'bg-blue-900/50 text-blue-300',
  callback: 'bg-yellow-900/50 text-yellow-300',
  scheduled: 'bg-purple-900/50 text-purple-300',
  not_interested: 'bg-red-900/50 text-red-300',
  send_quote: 'bg-green-900/50 text-green-300',
  completed: 'bg-gray-700 text-gray-300',
};
const LEAD_STATUSES = ['new','callback','scheduled','not_interested','send_quote','completed'];
const LEAD_STATUS_LABELS = { new:'New', callback:'Call Back', scheduled:'Scheduled', not_interested:'Not Interested', send_quote:'Send Quote', completed:'Completed' };

export default function LeadsTable({ leads, selectedIds, onToggleSelect, onToggleAll, showSelect=false, onStatusChange, onEdit, onDelete, onCall, onSMS, onEmail, onNotesSave }) {
  const allSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

  const channelBadge = (status) => {
    const colors = { pending:'bg-gray-700 text-gray-400', sent:'bg-green-900 text-green-300', called:'bg-blue-900 text-blue-300', failed:'bg-red-900 text-red-300' };
    return <span className={`px-1.5 py-0.5 rounded text-xs ${colors[status]||colors.pending}`}>{status}</span>;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            {showSelect && <th className="p-3"><input type="checkbox" checked={allSelected} onChange={onToggleAll} className="rounded bg-gray-800 border-gray-600" /></th>}
            <th className="p-3">Name</th>
            <th className="p-3">Phone</th>
            <th className="p-3">Email</th>
            <th className="p-3">Website</th>
            <th className="p-3">Status</th>
            <th className="p-3">Opens</th>
            <th className="p-3">Notes</th>
            <th className="p-3">Channels</th>
            {(onEdit || onDelete) && <th className="p-3"></th>}
          </tr>
        </thead>
        <tbody>
          {leads.map(lead => (
            <tr key={lead.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
              {showSelect && <td className="p-3"><input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => onToggleSelect(lead.id)} className="rounded bg-gray-800 border-gray-600" /></td>}
              <td className="p-3 font-medium text-white">
                {lead.name}
                {lead.source === 'manual' && <span className="ml-1 text-xs text-purple-400">manual</span>}
              </td>
              <td className="p-3 text-gray-300">{lead.phone || '—'}</td>
              <td className="p-3 text-gray-300">
                {lead.email ? <span>{lead.email}{lead.email_opens > 0 && <span className="ml-1 text-xs text-green-400">👁 {lead.email_opens}</span>}</span> : '—'}
              </td>
              <td className="p-3">
                {lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate block max-w-[160px]">{lead.website.replace(/^https?:\/\/(www\.)?/, '')}</a> : '—'}
              </td>
              <td className="p-3">
                {onStatusChange ? (
                  <select value={lead.status || 'new'} onChange={e => onStatusChange(lead.id, e.target.value)}
                    className={`px-2 py-1 rounded text-xs border-0 focus:outline-none cursor-pointer ${LEAD_STATUS_COLORS[lead.status||'new'] || 'bg-gray-700 text-gray-300'}`}>
                    {LEAD_STATUSES.map(s => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
                  </select>
                ) : (
                  <span className={`px-2 py-0.5 rounded text-xs ${LEAD_STATUS_COLORS[lead.status||'new'] || 'bg-gray-700 text-gray-300'}`}>{LEAD_STATUS_LABELS[lead.status||'new'] || lead.status}</span>
                )}
              </td>
              <td className="p-3 text-gray-400 text-xs">{lead.email_opens > 0 ? <span className="text-green-400">{lead.email_opens} opens</span> : '—'}</td>
              <td className="p-3">
                {onNotesSave ? (
                  <input
                    defaultValue={lead.notes || ''}
                    onBlur={e => { if (e.target.value !== (lead.notes||'')) onNotesSave(lead.id, e.target.value); }}
                    placeholder="Add note..."
                    className="w-full min-w-[120px] px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                ) : (
                  <span className="text-gray-400 text-xs">{lead.notes || '—'}</span>
                )}
              </td>
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {channelBadge(lead.email_status)}
                  {channelBadge(lead.call_status)}
                  {channelBadge(lead.sms_status)}
                </div>
              </td>
              {(onEdit || onDelete || onCall || onSMS || onEmail) && (
                <td className="p-3">
                  <div className="flex gap-1.5 flex-wrap">
                    {onCall && lead.phone && <button onClick={() => onCall(lead)} title="Call lead" className="px-2 py-1 bg-green-800 hover:bg-green-700 text-green-200 rounded text-xs transition-colors">📞</button>}
                    {onSMS && lead.phone && <button onClick={() => onSMS(lead)} title="Send SMS" className="px-2 py-1 bg-blue-800 hover:bg-blue-700 text-blue-200 rounded text-xs transition-colors">💬</button>}
                    {onEmail && lead.email && <button onClick={() => onEmail(lead)} title="Send Email" className="px-2 py-1 bg-purple-800 hover:bg-purple-700 text-purple-200 rounded text-xs transition-colors">✉</button>}
                    {onEdit && <button onClick={() => onEdit(lead)} className="text-xs text-gray-400 hover:text-white px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">✏</button>}
                    {onDelete && <button onClick={() => onDelete(lead.id)} className="text-xs text-red-400 hover:text-red-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">🗑</button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {leads.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-gray-500">No leads found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
