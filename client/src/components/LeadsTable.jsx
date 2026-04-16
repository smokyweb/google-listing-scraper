export default function LeadsTable({ leads, selectedIds, onToggleSelect, onToggleAll, showSelect = false }) {
  const allSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

  const statusBadge = (status) => {
    const colors = {
      pending: 'bg-gray-700 text-gray-300',
      sent: 'bg-green-900 text-green-300',
      called: 'bg-blue-900 text-blue-300',
      failed: 'bg-red-900 text-red-300',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs ${colors[status] || colors.pending}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            {showSelect && (
              <th className="p-3">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="rounded bg-gray-800 border-gray-600" />
              </th>
            )}
            <th className="p-3">Name</th>
            <th className="p-3">Phone</th>
            <th className="p-3">Email</th>
            <th className="p-3">Website</th>
            <th className="p-3">Email</th>
            <th className="p-3">Call</th>
            <th className="p-3">SMS</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
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
              <td className="p-3 font-medium text-white">{lead.name}</td>
              <td className="p-3 text-gray-300">{lead.phone}</td>
              <td className="p-3 text-gray-300">{lead.email || '—'}</td>
              <td className="p-3">
                {lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate block max-w-[200px]">
                    {lead.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : '—'}
              </td>
              <td className="p-3">{statusBadge(lead.email_status)}</td>
              <td className="p-3">{statusBadge(lead.call_status)}</td>
              <td className="p-3">{statusBadge(lead.sms_status)}</td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr><td colSpan={showSelect ? 8 : 7} className="p-8 text-center text-gray-500">No leads found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
