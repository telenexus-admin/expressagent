import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';
import { ChartIcon, CheckCircleIcon, WarningIcon, WrenchIcon } from '../components/Icons';

const emptyForm = {
  name: '',
  sku: '',
  category: '',
  quantity: 0,
  reorder_level: 0,
  unit_cost: 0,
  location: '',
  notes: '',
};

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function number(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function SummaryCard({ icon: Icon, label, value, helper, tone }) {
  const tones = {
    blue: 'bg-sky-50 text-sky-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    purple: 'bg-[#efe9ff] text-[#4f35f5]',
  };
  return (
    <div className="rounded-2xl border border-[#e5e9f4] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a92ad]">{label}</p>
          <p className="mt-2 text-2xl font-black text-[#101633]">{value}</p>
          <p className="mt-1 text-xs font-semibold text-[#6d7697]">{helper}</p>
        </div>
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tones[tone] || tones.purple}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder = '', textarea = false }) {
  const props = {
    value,
    onChange: (event) => onChange(event.target.value),
    placeholder,
    className: 'w-full rounded-xl border border-[#dfe5f2] bg-white px-3 py-2.5 text-sm font-semibold text-[#101633] outline-none transition focus:border-[#5b35f5] focus:ring-4 focus:ring-[#eee9ff]',
  };
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#7d86a3]">{label}</span>
      {textarea ? <textarea rows={3} {...props} /> : <input type={type} {...props} />}
    </label>
  );
}

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ active_items: 0, low_stock_items: 0, total_quantity: 0, stock_value: 0 });
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [itemsRes, summaryRes] = await Promise.all([
        api.get(`/inventory?status=${showArchived ? 'archived' : 'active'}`),
        api.get('/inventory/summary'),
      ]);
      setItems(itemsRes.data || []);
      setSummary(summaryRes.data || {});
      setStatus(null);
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to load inventory.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [showArchived]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.name} ${item.sku || ''} ${item.category || ''} ${item.location || ''}`.toLowerCase().includes(needle));
  }, [items, query]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const resetForm = () => { setForm(emptyForm); setEditingId(null); };

  const save = async () => {
    if (!form.name.trim()) {
      setStatus({ type: 'error', message: 'Item name is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        quantity: Number(form.quantity || 0),
        reorder_level: Number(form.reorder_level || 0),
        unit_cost: Number(form.unit_cost || 0),
      };
      if (editingId) {
        const { data } = await api.put(`/inventory/${editingId}`, payload);
        setItems((current) => current.map((item) => item.id === data.id ? data : item));
        setStatus({ type: 'success', message: 'Inventory item updated.' });
      } else {
        const { data } = await api.post('/inventory', payload);
        setItems((current) => [data, ...current]);
        setStatus({ type: 'success', message: 'Inventory item added.' });
      }
      resetForm();
      const { data } = await api.get('/inventory/summary');
      setSummary(data || {});
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to save inventory item.' });
    } finally {
      setSaving(false);
    }
  };

  const edit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      sku: item.sku || '',
      category: item.category || '',
      quantity: item.quantity || 0,
      reorder_level: item.reorder_level || 0,
      unit_cost: item.unit_cost || 0,
      location: item.location || '',
      notes: item.notes || '',
    });
  };

  const changeStatus = async (item, nextStatus) => {
    try {
      await api.patch(`/inventory/${item.id}/status`, { status: nextStatus });
      setItems((current) => current.filter((row) => row.id !== item.id));
      const { data } = await api.get('/inventory/summary');
      setSummary(data || {});
      setStatus({ type: 'success', message: nextStatus === 'archived' ? 'Item archived.' : 'Item restored.' });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to update item.' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8faff] p-5 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-normal text-[#101633]">Inventory</h1>
            <p className="mt-1 text-sm font-medium text-[#657194]">Track routers, cables, ONTs, radios and other stock used by your support and installation teams.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            className="h-11 rounded-xl border border-[#d8def0] bg-white px-5 text-sm font-black text-[#4f35f5] shadow-sm"
          >
            {showArchived ? 'Show Active Stock' : 'Show Archived'}
          </button>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={WrenchIcon} label="Active items" value={summary.active_items || 0} helper="Stock records in use." tone="purple" />
          <SummaryCard icon={WarningIcon} label="Low stock" value={summary.low_stock_items || 0} helper="At or below reorder level." tone="amber" />
          <SummaryCard icon={ChartIcon} label="Total quantity" value={number(summary.total_quantity)} helper="Units currently tracked." tone="blue" />
          <SummaryCard icon={CheckCircleIcon} label="Stock value" value={money(summary.stock_value)} helper="Quantity multiplied by unit cost." tone="green" />
        </div>

        {status && (
          <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-bold ${status.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
            {status.message}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <section className="rounded-[24px] border border-[#dfe5f2] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#101633]">{editingId ? 'Edit Item' : 'Add Stock Item'}</h2>
            <div className="mt-4 space-y-4">
              <Field label="Item name" value={form.name} onChange={(value) => update('name', value)} placeholder="Router, ONT, cable..." />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="SKU" value={form.sku} onChange={(value) => update('sku', value)} placeholder="SKU-001" />
                <Field label="Category" value={form.category} onChange={(value) => update('category', value)} placeholder="Router" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Quantity" type="number" value={form.quantity} onChange={(value) => update('quantity', value)} />
                <Field label="Reorder" type="number" value={form.reorder_level} onChange={(value) => update('reorder_level', value)} />
                <Field label="Unit cost" type="number" value={form.unit_cost} onChange={(value) => update('unit_cost', value)} />
              </div>
              <Field label="Location" value={form.location} onChange={(value) => update('location', value)} placeholder="Main store, van 2..." />
              <Field label="Notes" value={form.notes} onChange={(value) => update('notes', value)} textarea placeholder="Serial batches, supplier, condition..." />
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                {editingId && (
                  <button type="button" onClick={resetForm} className="h-11 flex-1 rounded-xl border border-[#d8def0] bg-white text-sm font-black text-[#657194]">
                    Cancel
                  </button>
                )}
                <button type="button" onClick={save} disabled={saving} className="h-11 flex-1 rounded-xl bg-[#4f35f5] text-sm font-black text-white shadow-[0_10px_24px_rgba(79,53,245,0.2)] disabled:opacity-50">
                  {saving ? 'Saving...' : editingId ? 'Save Item' : 'Add Item'}
                </button>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-[24px] border border-[#dfe5f2] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#edf1f7] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#101633]">{showArchived ? 'Archived Stock' : 'Current Stock'}</h2>
                <p className="mt-1 text-xs font-semibold text-[#7a849f]">{filtered.length} item{filtered.length === 1 ? '' : 's'} shown</p>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, SKU, category or location..."
                className="h-11 rounded-xl border border-[#dfe5f2] bg-[#fbfcff] px-4 text-sm font-semibold outline-none focus:border-[#5b35f5] sm:w-80"
              />
            </div>

            {loading ? (
              <div className="p-10 text-center text-sm font-bold text-[#7a849f]">Loading inventory...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[#fbfcff] text-[10px] font-black uppercase tracking-[0.14em] text-[#8a92ad]">
                    <tr>
                      <th className="px-5 py-4">Item</th>
                      <th className="px-5 py-4">Stock</th>
                      <th className="px-5 py-4">Cost</th>
                      <th className="px-5 py-4">Location</th>
                      <th className="px-5 py-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef2f8]">
                    {filtered.map((item) => {
                      const low = Number(item.quantity || 0) <= Number(item.reorder_level || 0);
                      return (
                        <tr key={item.id} className="align-top">
                          <td className="px-5 py-4">
                            <div className="font-black text-[#101633]">{item.name}</div>
                            <div className="mt-1 text-xs font-semibold text-[#7a849f]">{item.sku || 'No SKU'} {item.category ? `· ${item.category}` : ''}</div>
                            {item.notes && <div className="mt-2 max-w-xs text-xs leading-5 text-[#7a849f]">{item.notes}</div>}
                          </td>
                          <td className="px-5 py-4">
                            <div className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${low ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                              {number(item.quantity)} in stock
                            </div>
                            <div className="mt-2 text-xs font-semibold text-[#7a849f]">Reorder at {number(item.reorder_level)}</div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-[#101633]">{money(item.unit_cost)}</div>
                            <div className="mt-1 text-xs font-semibold text-[#7a849f]">Value {money(Number(item.quantity || 0) * Number(item.unit_cost || 0))}</div>
                          </td>
                          <td className="px-5 py-4 text-sm font-semibold text-[#657194]">{item.location || '-'}</td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              {!showArchived && <button type="button" onClick={() => edit(item)} className="rounded-full bg-[#efe9ff] px-4 py-2 text-xs font-black text-[#4f35f5]">Edit</button>}
                              <button type="button" onClick={() => changeStatus(item, showArchived ? 'active' : 'archived')} className="rounded-full border border-[#d8def0] px-4 py-2 text-xs font-black text-[#657194]">
                                {showArchived ? 'Restore' : 'Archive'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-12 text-center text-sm font-bold text-[#8a92ad]">
                          No inventory items found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
