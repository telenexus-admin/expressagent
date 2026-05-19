import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const ROLE_STYLES = {
  superadmin: 'bg-[#3535FF] text-white',
  admin: 'bg-gray-100 text-gray-600',
};

export default function AdminManagement() {
  const { admin: currentAdmin } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'admin' });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    try {
      const { data } = await api.get('/admins');
      setAdmins(data);
    } catch (err) {
      console.error('Failed to fetch admins:', err.message);
    }
  };

  const openModal = () => {
    setForm({ name: '', email: '', password: '', role: 'admin' });
    setFormError('');
    setShowModal(true);
  };

  const createAdmin = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormError('All fields are required');
      return;
    }
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }
    setFormLoading(true);
    setFormError('');
    try {
      await api.post('/admins', form);
      setShowModal(false);
      fetchAdmins();
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to create admin';
      setFormError(msg);
    } finally {
      setFormLoading(false);
    }
  };

  const deleteAdmin = async (id, name) => {
    if (!window.confirm(`Delete admin "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/admins/${id}`);
      fetchAdmins();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete admin');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Management</h1>
            <p className="text-sm text-gray-500 mt-1">Manage who has access to this dashboard</p>
          </div>
          <button
            onClick={openModal}
            className="bg-[#3535FF] hover:bg-[#2828DD] text-white px-5 py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5"
          >
            <span className="text-lg leading-none">+</span>
            Add Admin
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {admins.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#3535FF] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{a.name}</span>
                      {a.id === currentAdmin.id && (
                        <span className="text-[10px] bg-[#E8E9FF] text-[#3535FF] px-2 py-0.5 rounded-full font-semibold">You</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{a.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${ROLE_STYLES[a.role]}`}>
                      {a.role === 'superadmin' ? 'Super Admin' : 'Admin'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-500">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {a.id !== currentAdmin.id && (
                      <button
                        onClick={() => deleteAdmin(a.id, a.name)}
                        className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {admins.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                    No admins found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Add New Admin</h2>
              <p className="text-sm text-gray-500 mt-0.5">Create a new dashboard account</p>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-sm">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  placeholder="jane@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label>
                <input
                  type="password"
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                >
                  <option value="admin">Admin</option>
                  <option value="superadmin">Super Admin</option>
                </select>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createAdmin}
                disabled={formLoading}
                className="flex-1 bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white py-2.5 rounded-full text-sm font-semibold transition-colors"
              >
                {formLoading ? 'Creating...' : 'Create Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
