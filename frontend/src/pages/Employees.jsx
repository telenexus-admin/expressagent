import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { CheckCircleIcon, WarningIcon } from '../components/Icons';

const ROLE_OPTIONS = [
  { value: 'technician', label: 'Technician' },
  { value: 'support', label: 'Customer Support' },
  { value: 'manager', label: 'Manager' },
  { value: 'other', label: 'Other' },
];

const ROLE_LABELS = ROLE_OPTIONS.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), {});

const PHONE_REGEX = /^\+?[0-9][0-9\s\-()]{6,19}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY_FORM = {
  name: '',
  role: 'technician',
  location: '',
  phone: '',
  email: '',
  is_active: true,
};

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/employees');
      setEmployees(data);
    } catch (err) {
      console.error('Failed to fetch employees:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({
      name: e.name,
      role: e.role,
      location: e.location,
      phone: e.phone,
      email: e.email,
      is_active: e.is_active,
    });
    setFormError('');
    setShowModal(true);
  };

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.name.trim() || !form.location.trim() || !form.phone.trim() || !form.email.trim()) {
      setFormError('All fields are required.');
      return;
    }
    if (!PHONE_REGEX.test(form.phone.trim())) {
      setFormError('Enter a valid phone number (e.g. +254712345678).');
      return;
    }
    if (!EMAIL_REGEX.test(form.email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }

    setFormLoading(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        role: form.role,
        location: form.location.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        is_active: !!form.is_active,
      };
      if (editingId) {
        await api.put(`/employees/${editingId}`, payload);
      } else {
        await api.post('/employees', payload);
      }
      setShowModal(false);
      fetchEmployees();
    } catch (err) {
      setFormError(
        err.response?.data?.error ||
          err.response?.data?.errors?.[0]?.msg ||
          'Failed to save employee'
      );
    } finally {
      setFormLoading(false);
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete employee "${e.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/employees/${e.id}`);
      fetchEmployees();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete employee');
    }
  };

  const toggleActive = async (e) => {
    try {
      await api.put(`/employees/${e.id}`, { is_active: !e.is_active });
      fetchEmployees();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update employee');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
            <p className="text-sm text-gray-500 mt-1">
              Team roster used by automated workflows (escalations, dispatch, follow-ups).
            </p>
          </div>
          <button
            onClick={openCreate}
            className="bg-[#3535FF] hover:bg-[#2828DD] text-white px-5 py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5"
          >
            <span className="text-lg leading-none">+</span>
            Add Employee
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Location</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Phone</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">
                    Loading employees...
                  </td>
                </tr>
              )}
              {!loading && employees.map((e) => (
                <tr key={e.id} className={`hover:bg-gray-50 transition-colors ${!e.is_active ? 'opacity-60' : ''}`}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#3535FF] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {e.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{e.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-700">
                    <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-semibold capitalize">
                      {ROLE_LABELS[e.role] || e.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">{e.location}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 font-mono text-xs">{e.phone}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{e.email}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => toggleActive(e)}
                      className={`text-[10px] px-2.5 py-1 rounded-full font-semibold transition-colors ${
                        e.is_active
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                      title="Click to toggle"
                    >
                      {e.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(e)}
                      className="text-xs text-[#3535FF] hover:text-[#2828DD] font-semibold transition-colors mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(e)}
                      className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && employees.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">
                    No employees yet. Click "Add Employee" to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? 'Edit Employee' : 'Add Employee'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {editingId ? 'Update the details below' : 'Add a new team member to the roster'}
              </p>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-sm flex items-start gap-1.5">
                  <WarningIcon className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  placeholder="Jane Mwangi"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => updateField('role', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Location / Area</label>
                <input
                  type="text"
                  placeholder="Githurai 45"
                  value={form.location}
                  onChange={(e) => updateField('location', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Phone Number</label>
                <input
                  type="tel"
                  placeholder="+254712345678"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  placeholder="jane@example.com"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => updateField('is_active', e.target.checked)}
                  className="w-4 h-4 accent-[#3535FF]"
                />
                <span className="text-sm text-gray-700">
                  Active <span className="text-xs text-gray-400">(eligible for automated workflows)</span>
                </span>
              </label>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-full text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={formLoading}
                className="flex-1 bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                {formLoading ? 'Saving...' : (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    {editingId ? 'Save Changes' : 'Add Employee'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
