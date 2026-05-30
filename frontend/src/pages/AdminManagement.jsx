import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const ROLE_STYLES = {
  superadmin: 'bg-[#3535FF] text-white',
  admin: 'bg-gray-100 text-gray-600',
};

const PERMISSION_OPTIONS = [
  { key: 'statistics', label: 'Dashboard' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'escalations', label: 'Human Handover' },
  { key: 'installations', label: 'Installations' },
  { key: 'complaints', label: 'Complaints' },
  { key: 'ai_health', label: 'AI Health' },
  { key: 'admins', label: 'Admin Management' },
  { key: 'employees', label: 'Employees' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'agent', label: 'Agent' },
  { key: 'settings', label: 'Settings' },
];

const DEFAULT_PERMISSIONS = ['statistics', 'conversations', 'tickets'];

function permissionLabel(key) {
  return PERMISSION_OPTIONS.find((p) => p.key === key)?.label || key;
}

export default function AdminManagement() {
  const { admin: currentAdmin } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'admin',
    permissions: DEFAULT_PERMISSIONS,
  });
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
    setForm({ name: '', email: '', password: '', role: 'admin', permissions: DEFAULT_PERMISSIONS });
    setFormError('');
    setShowModal(true);
  };

  const togglePermission = (key) => {
    setForm((prev) => {
      const exists = prev.permissions.includes(key);
      const permissions = exists
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key];
      return { ...prev, permissions };
    });
  };

  const selectAllPermissions = () => {
    setForm((prev) => ({ ...prev, permissions: PERMISSION_OPTIONS.map((p) => p.key) }));
  };

  const clearPermissions = () => {
    setForm((prev) => ({ ...prev, permissions: [] }));
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
    if (form.role !== 'superadmin' && form.permissions.length === 0) {
      setFormError('Select at least one tab this admin can access');
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
    <div className="flex-1 overflow-y-auto p-5 sm:p-8 bg-[#f8f6ff]">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center rounded-full bg-[#efe9ff] text-[#4B16B5] px-4 py-2 text-xs font-black mb-3">
              Team access control
            </div>
            <h1 className="text-3xl font-black text-slate-950 tracking-tight">Admin Management</h1>
            <p className="text-sm text-gray-500 mt-1">Create dashboard users and choose exactly which tabs they can access.</p>
          </div>
          <button
            onClick={openModal}
            className="bg-[#4B16B5] hover:bg-[#37108A] text-white px-5 py-3 rounded-2xl text-sm font-black transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-purple-200"
          >
            <span className="text-lg leading-none">+</span>
            Add Admin
          </button>
        </div>

        <div className="bg-white rounded-[30px] border border-white shadow-xl shadow-purple-100/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="bg-[#fbfaff] border-b border-purple-50">
                  <th className="text-left px-5 py-4 text-[10px] font-black text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-4 text-[10px] font-black text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="text-left px-5 py-4 text-[10px] font-black text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-5 py-4 text-[10px] font-black text-gray-500 uppercase tracking-wider">Allowed tabs</th>
                  <th className="text-left px-5 py-4 text-[10px] font-black text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-5 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-50">
                {admins.map((a) => {
                  const permissions = Array.isArray(a.permissions) ? a.permissions : [];
                  return (
                    <tr key={a.id} className="hover:bg-[#fbfaff] transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-[#4B16B5] flex items-center justify-center text-white text-sm font-black shrink-0">
                            {a.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-bold text-gray-900">{a.name}</span>
                          {a.id === currentAdmin.id && (
                            <span className="text-[10px] bg-[#E8E9FF] text-[#3535FF] px-2 py-0.5 rounded-full font-black">You</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">{a.email}</td>
                      <td className="px-5 py-4">
                        <span className={`text-[10px] px-2.5 py-1 rounded-full font-black ${ROLE_STYLES[a.role]}`}>
                          {a.role === 'superadmin' ? 'Super Admin' : 'Admin'}
                        </span>
                      </td>
                      <td className="px-5 py-4 max-w-[320px]">
                        {a.role === 'superadmin' ? (
                          <span className="text-xs text-[#4B16B5] font-bold">Full system access</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {permissions.slice(0, 4).map((p) => (
                              <span key={p} className="text-[10px] bg-purple-50 text-[#4B16B5] rounded-full px-2 py-1 font-bold">
                                {permissionLabel(p)}
                              </span>
                            ))}
                            {permissions.length > 4 && (
                              <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-1 font-bold">+{permissions.length - 4}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {new Date(a.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {a.id !== currentAdmin.id && (
                          <button
                            onClick={() => deleteAdmin(a.id, a.name)}
                            className="text-xs text-red-500 hover:text-red-700 font-black transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {admins.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                      No admins found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-black text-gray-900">Add New Admin</h2>
              <p className="text-sm text-gray-500 mt-0.5">Create a new dashboard account and assign tab access.</p>
            </div>
            <div className="p-6 space-y-4 max-h-[72vh] overflow-y-auto">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-sm">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    placeholder="Jane Smith"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    placeholder="jane@company.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Password</label>
                  <input
                    type="password"
                    placeholder="Min. 8 characters"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value, permissions: e.target.value === 'superadmin' ? PERMISSION_OPTIONS.map((p) => p.key) : form.permissions })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                  >
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
              </div>

              {form.role !== 'superadmin' && (
                <div className="bg-[#fbfaff] border border-purple-50 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-sm font-black text-gray-900">Allowed tabs</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Choose the dashboard sections this admin can open.</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={selectAllPermissions} className="text-[11px] font-black text-[#4B16B5] bg-white rounded-full px-3 py-1.5 border border-purple-100">All</button>
                      <button type="button" onClick={clearPermissions} className="text-[11px] font-black text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-100">Clear</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PERMISSION_OPTIONS.map((option) => {
                      const checked = form.permissions.includes(option.key);
                      return (
                        <label
                          key={option.key}
                          className={`flex items-center gap-3 rounded-xl px-3 py-3 cursor-pointer border transition-all ${
                            checked ? 'bg-white border-[#4B16B5] text-[#4B16B5] shadow-sm' : 'bg-white/60 border-gray-100 text-gray-600 hover:bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(option.key)}
                            className="w-4 h-4 accent-[#4B16B5]"
                          />
                          <span className="text-sm font-bold">{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createAdmin}
                disabled={formLoading}
                className="flex-1 bg-[#4B16B5] hover:bg-[#37108A] disabled:opacity-50 text-white py-2.5 rounded-full text-sm font-black transition-colors"
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
