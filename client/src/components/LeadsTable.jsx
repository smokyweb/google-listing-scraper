/**
 * LeadsTable
 *
 * Props:
 *   leads         - array of lead objects (may include assigned_user_name)
 *   selectedIds   - Set of selected lead ids
 *   onToggleSelect / onToggleAll
 *   showSelect    - show checkbox column
 *   onStatusChange(id, status)
 *   onEdit(lead) / onDelete(id)
 *   onCall(lead) / onSMS(lead) / onEmail(lead)
 *   onNotesSave(id, notes)
 *
 *   isAdmin       - show admin-only Sales User column + assignment control
 *   salesUsers    - array of { id, name, is_active } for assignment dropdown
 *   onAssign(leadId, newAssignedUserId|null) - called when admin changes assignment
 */

const LEAD_STATUS_COLORS = {
  new:            'bg-blue-900/50 text-blue-300',
  callback:       'bg-yellow-900/50 text-yellow-300',
  scheduled:      'bg-purple-900/50 text-purple-300',
  not_interested: 'bg-red-900/50 text-red-300',
  send_quote:     'bg-green-900/50 text-green-300',
  completed:      'bg-gray-700 text-gray-300',
  sent_live_vm:   'bg-yellow-900/50 text-yellow-300',
  voicemail_drop: 'bg-blue-900/50 text-blue-300',
};
const LEAD_STATUSES       = ['new', 'sent_live_vm', 'voicemail_drop', 'callback', 'scheduled', 'not_interested', 'completed'];
const LEAD_STATUS_LABELS  = {
  new: 'New', callback: 'Call Back', scheduled: 'Scheduled',
  not_interested: 'Not Interested', send_quote: 'Send Quote',
  sent_live_vm: 'Sent Live VM', voicemail_drop: 'Voicemail Drop', completed: 'Completed',
};

export default function LeadsTable({
  leads,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  showSelect = false,
  onStatusChange,
  onEdit,
  onDelete,
  onCall,
  onSMS,
  onEmail,
  onNotesSave,
  // Voice drop
  onVoiceDrop,
  // Admin-only props
  isAdmin    = false,
  salesUsers = [],
  onAssign,
}) {
  const allSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

  // Only show active sales users in the assignment dropdown.
  const activeSalesUsers = salesUsers.filter(u => u.is_active);

  const channelBadge = (status) => {
    const colors = {
      pending: 'bg-gray-700 text-gray-400',
      sent:    'bg-green-900 text-green-300',
      called:  'bg-blue-900 text-blue-300',
      failed:  'bg-red-900 text-red-300',
    };
    return (
      <span className={`px-1.5 py-0.5 rounded text-xs ${colors[status] || colors.pending}`}>
        {status}
      </span>
    );
  };

  const handleAssignChange = (leadId, value) => {
    if (onAssign) {
      onAssign(leadId, value === '' ? null : Number(value));
    }
  };

  // Total colspan for "No leads" row
  const colCount =
    (showSelect ? 1 : 0) +
    10 + // First Name, Last Name, Company, Phone, Email, Website, Status, Opens, Notes, Channels
    (isAdmin ? 1 : 0) +
    (onEdit || onDelete || onCall || onSMS || onEmail || onVoiceDrop ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            {showSelect && (
              <th className="p-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="rounded bg-gray-800 border-gray-600"
                />
              </th>
            )}
            <th className="p-3">First Name</th>
            <th className="p-3">Last Name</th>
            <th className="p-3">Company</th>
            <th className="p-3">Phone</th>
            <th className="p-3">Email</th>
            <th className="p-3">Website</th>
            <th className="p-3">Status</th>
            <th className="p-3">Opens</th>
            <th className="p-3">Notes</th>
            <th className="p-3">Channels</th>
            {isAdmin && <th className="p-3">Sales User</th>}
            {(onEdit || onDelete) && <th className="p-3"></th>}
          </tr>
        </thead>
        <tbody>
          {leads.map(lead => (
            <tr key={lead.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
              {showSelect && (
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => onToggleSelect(lead.id)}
                    className="rounded bg-gray-800 border-gray-600"
                  />
                </td>
              )}

              {/* First Name */}
              <td className="p-3 font-medium text-white">
                {lead.first_name}
                {lead.source === 'manual' && (
                  <span className="ml-1 text-xs text-purple-400">manual</span>
                )}
              </td>

              {/* Last Name */}
              <td className="p-3 font-medium text-white">{lead.last_name}</td>

              {/* Company */}
              <td className="p-3 text-gray-400">{lead.company || '—'}</td>

              {/* Phone */}
              <td className="p-3 text-gray-300">{lead.phone || '—'}</td>

              {/* Email */}
              <td className="p-3 text-gray-300">
                {lead.email ? (
                  <span>
                    {lead.email}
                    {lead.email_opens > 0 && (
                      <span className="ml-1 text-xs text-green-400">👁 {lead.email_opens}</span>
                    )}
                  </span>
                ) : '—'}
              </td>

              {/* Website */}
              <td className="p-3">
                {lead.website ? (
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline truncate block max-w-[160px]"
                  >
                    {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                ) : '—'}
              </td>

              {/* Status */}
              <td className="p-3">
                {onStatusChange ? (
                  <select
                    value={lead.status || 'new'}
                    onChange={e => onStatusChange(lead.id, e.target.value)}
                    className={`px-2 py-1 rounded text-xs border-0 focus:outline-none cursor-pointer ${LEAD_STATUS_COLORS[lead.status || 'new'] || 'bg-gray-700 text-gray-300'}`}
                  >
                    {LEAD_STATUSES.map(s => (
                      <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`px-2 py-0.5 rounded text-xs ${LEAD_STATUS_COLORS[lead.status || 'new'] || 'bg-gray-700 text-gray-300'}`}>
                    {LEAD_STATUS_LABELS[lead.status || 'new'] || lead.status}
                  </span>
                )}
              </td>

              {/* Opens */}
              <td className="p-3 text-gray-400 text-xs">
                {lead.email_opens > 0
                  ? <span className="text-green-400">{lead.email_opens} opens</span>
                  : '—'}
              </td>

              {/* Notes */}
              <td className="p-3">
                {onNotesSave ? (
                  <input
                    defaultValue={lead.notes || ''}
                    onBlur={e => {
                      if (e.target.value !== (lead.notes || '')) {
                        onNotesSave(lead.id, e.target.value);
                      }
                    }}
                    placeholder="Add note..."
                    className="w-full min-w-[120px] px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                ) : (
                  <span className="text-gray-400 text-xs">{lead.notes || '—'}</span>
                )}
              </td>

              {/* Channels */}
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {channelBadge(lead.email_status)}
                  {channelBadge(lead.call_status)}
                  {channelBadge(lead.sms_status)}
                </div>
              </td>

              {/* Sales User — admin only */}
              {isAdmin && (
                <td className="p-3">
                  {onAssign && activeSalesUsers.length > 0 ? (
                    <select
                      value={lead.assigned_user_id || ''}
                      onChange={e => handleAssignChange(lead.id, e.target.value)}
                      className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-blue-500 min-w-[120px]"
                    >
                      <option value="">Unassigned</option>
                      {activeSalesUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`text-xs ${lead.assigned_user_name ? 'text-blue-300' : 'text-gray-500'}`}>
                      {lead.assigned_user_name || 'Unassigned'}
                    </span>
                  )}
                </td>
              )}

              {/* Actions */}
              {(onEdit || onDelete || onCall || onSMS || onEmail || onVoiceDrop) && (
                <td className="p-3">
                  <div className="flex gap-1.5 flex-wrap items-center">
                    {onCall  && lead.phone && (
                      <button
                        onClick={() => onCall(lead)}
                        title="Call lead"
                        className="px-2 py-1 bg-green-800 hover:bg-green-700 text-green-200 rounded text-xs transition-colors"
                      >📞</button>
                    )}
                    {onSMS   && lead.phone && (
                      <button
                        onClick={() => onSMS(lead)}
                        title="Send SMS"
                        className="px-2 py-1 bg-blue-800 hover:bg-blue-700 text-blue-200 rounded text-xs transition-colors"
                      >💬</button>
                    )}
                    {onEmail && lead.email && (
                      <button
                        onClick={() => onEmail(lead)}
                        title="Send Email"
                        className="px-2 py-1 bg-purple-800 hover:bg-purple-700 text-purple-200 rounded text-xs transition-colors"
                      >✉</button>
                    )}
                    {/* Voice Drop buttons — always visible when lead has a phone */}
                    {onVoiceDrop && lead.phone && (
                      <>
                        <button
                          onClick={() => onVoiceDrop(lead, 'voicemail')}
                          title="Voicemail Drop — system calls recipient automatically"
                          className="flex items-center gap-1 px-2 py-1 bg-blue-700 hover:bg-blue-600 text-blue-100 rounded text-xs font-medium transition-colors"
                        >
                          <span>📱</span>
                          <span>VM Drop</span>
                        </button>
                        <button
                          onClick={() => onVoiceDrop(lead, 'agent')}
                          title="Live Voice Message — you listen in, drop message when ready"
                          className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-500 text-yellow-100 rounded text-xs font-medium transition-colors"
                        >
                          <span>🎙️</span>
                          <span>Live VM</span>
                        </button>
                      </>
                    )}
                    {onEdit && (
                      <button
                        onClick={() => onEdit(lead)}
                        className="text-xs text-gray-400 hover:text-white px-1.5 py-1 rounded hover:bg-gray-700 transition-colors"
                      >✏</button>
                    )}
                    {onDelete && (
                      <button
                        onClick={() => onDelete(lead.id)}
                        className="text-xs text-red-400 hover:text-red-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors"
                      >🗑</button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}

          {leads.length === 0 && (
            <tr>
              <td colSpan={colCount} className="p-8 text-center text-gray-500">
                No leads found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
