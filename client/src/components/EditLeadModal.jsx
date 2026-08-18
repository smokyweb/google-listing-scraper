import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function EditLeadModal({ lead, onClose, onSave }) {
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    company: '',
    phone: '',
    email: '',
    address: '',
    website: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (lead) {
      setFormData({
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        company: lead.company || '',
        phone: lead.phone || '',
        email: lead.email || '',
        address: lead.address || '',
        website: lead.website || '',
      });
    }
  }, [lead]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        onSave(response.lead); // Assuming API returns the updated lead
        onClose();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update lead');
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-lg p-6">
        <h3 className="text-xl font-bold text-white mb-4">Edit Lead: {lead?.first_name} {lead?.last_name}</h3>
        {error && <div className="bg-red-900/20 text-red-300 border border-red-700/50 rounded-md p-3 mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="first_name" className="block text-sm font-medium text-gray-300 mb-1">First Name</label>
              <input type="text" id="first_name" name="first_name" value={formData.first_name} onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label htmlFor="last_name" className="block text-sm font-medium text-gray-300 mb-1">Last Name</label>
              <input type="text" id="last_name" name="last_name" value={formData.last_name} onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label htmlFor="company" className="block text-sm font-medium text-gray-300 mb-1">Company <span className="text-gray-500 font-normal">(optional)</span></label>
            <input type="text" id="company" name="company" value={formData.company} onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-300 mb-1">Phone</label>
            <input type="text" id="phone" name="phone" value={formData.phone} onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input type="email" id="email" name="email" value={formData.email} onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-300 mb-1">Address</label>
            <input type="text" id="address" name="address" value={formData.address} onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label htmlFor="website" className="block text-sm font-medium text-gray-300 mb-1">Website</label>
            <input type="text" id="website" name="website" value={formData.website} onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
