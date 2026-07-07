import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';

const emptyEquipment = { inventory_item_id: '', name: '', quantity: 1, unit: 'pcs', notes: '' };
const quickItems = ['ATB', 'Drop cable', 'Router', 'Cable clips', 'Patch cord', 'ONU/ONT', 'RJ45 connectors', 'Power adapter'];

function Field({ label, value, onChange, type = 'text', placeholder = '', textarea = false }) {
  const props = {
    value,
    onChange: (event) => onChange(event.target.value),
    placeholder,
    className: 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#3535FF] focus:ring-4 focus:ring-indigo-50',
  };
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      {textarea ? <textarea rows={4} {...props} /> : <input type={type} {...props} />}
    </label>
  );
}

export default function InstallationWorkOrder() {
  const { token } = useParams();
  const [workOrder, setWorkOrder] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [equipment, setEquipment] = useState([{ ...emptyEquipment }]);
  const [form, setForm] = useState({
    technician_status: 'pending',
    installation_started_at: '',
    installation_completed_at: '',
    installation_time_minutes: '',
    power_dcbs: '',
    signal_power: '',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await api.get(`/public/installation-work-orders/${token}`);
        if (!active) return;
        setWorkOrder(data.work_order);
        setInventory(Array.isArray(data.inventory) ? data.inventory : []);
        const used = Array.isArray(data.work_order?.equipment_used) ? data.work_order.equipment_used : [];
        if (used.length) setEquipment(used.map((item) => ({ ...emptyEquipment, ...item, inventory_item_id: item.inventory_item_id || '' })));
        setForm({
          technician_status: data.work_order?.technician_status || 'pending',
          installation_started_at: data.work_order?.installation_started_at ? String(data.work_order.installation_started_at).slice(0, 16) : '',
          installation_completed_at: data.work_order?.installation_completed_at ? String(data.work_order.installation_completed_at).slice(0, 16) : '',
          installation_time_minutes: data.work_order?.installation_time_minutes || '',
          power_dcbs: data.work_order?.power_dcbs || '',
          signal_power: data.work_order?.signal_power || '',
          notes: data.work_order?.notes || '',
        });
      } catch (err) {
        if (active) setStatus({ type: 'error', message: err.response?.data?.error || 'Could not open installation form.' });
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [token]);

  const inventoryById = useMemo(() => Object.fromEntries(inventory.map((item) => [String(item.id), item])), [inventory]);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateEquipment = (index, field, value) => {
    setEquipment((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, [field]: value };
      if (field === 'inventory_item_id') {
        const selected = inventoryById[String(value)];
        if (selected) {
          next.name = selected.name;
          next.unit = next.unit || 'pcs';
        }
      }
      return next;
    }));
  };

  const addEquipment = (name = '') => setEquipment((current) => [...current, { ...emptyEquipment, name }]);
  const removeEquipment = (index) => setEquipment((current) => current.filter((_, itemIndex) => itemIndex !== index));

  const submit = async () => {
    const cleanEquipment = equipment
      .map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
      }))
      .filter((item) => (item.inventory_item_id || item.name.trim()) && item.quantity > 0);
    if (form.technician_status === 'done' && cleanEquipment.length === 0) {
      setStatus({ type: 'error', message: 'Add at least one equipment item used.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const { data } = await api.post(`/public/installation-work-orders/${token}`, {
        ...form,
        equipment_used: cleanEquipment,
      });
      setWorkOrder(data.work_order);
      setStatus({ type: 'success', message: 'Installation report submitted successfully.' });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to submit installation report.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#f6f8ff] text-sm font-bold text-slate-500">Opening installation form...</div>;

  if (!workOrder) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f8ff] p-5">
        <div className="max-w-md rounded-[28px] bg-white p-7 text-center shadow-xl">
          <h1 className="text-xl font-black text-slate-950">Form unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{status?.message || 'This installation work order could not be found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8ff] px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 rounded-[28px] bg-slate-950 p-6 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200">Technician Site Form</p>
          <h1 className="mt-2 text-2xl font-black">Installation Ticket #{workOrder.ticket_id}</h1>
          <p className="mt-2 text-sm leading-6 text-white/65">
            {workOrder.business_name || workOrder.client_name} · {workOrder.customer_name || 'Customer'} · +{workOrder.customer_phone}
          </p>
          <p className="mt-3 rounded-2xl bg-white/10 px-4 py-3 text-sm leading-6 text-white/75">{workOrder.summary || workOrder.title}</p>
        </div>

        {status && (
          <div className={`mb-5 rounded-2xl px-4 py-3 text-sm font-bold ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {status.message}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
          <section className="rounded-[28px] bg-white p-5 shadow-xl shadow-indigo-100/50">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Installation Details</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-slate-500">Installation status</span>
                <select
                  value={form.technician_status}
                  onChange={(event) => update('technician_status', event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#3535FF] focus:ring-4 focus:ring-indigo-50"
                >
                  <option value="done">Done</option>
                  <option value="pending">Pending</option>
                  <option value="rescheduled">Rescheduled to another day</option>
                </select>
              </label>
              <Field label="Started at" type="datetime-local" value={form.installation_started_at} onChange={(value) => update('installation_started_at', value)} />
              <Field label="Completed at" type="datetime-local" value={form.installation_completed_at} onChange={(value) => update('installation_completed_at', value)} />
              <Field label="Time taken minutes" type="number" value={form.installation_time_minutes} onChange={(value) => update('installation_time_minutes', value)} placeholder="90" />
              <Field label="Power / DCBs" value={form.power_dcbs} onChange={(value) => update('power_dcbs', value)} placeholder="DCB 12V, power level..." />
              <Field label="Signal power" value={form.signal_power} onChange={(value) => update('signal_power', value)} placeholder="-18 dBm" />
            </div>
            <div className="mt-4">
              <Field label="Site notes" value={form.notes} onChange={(value) => update('notes', value)} textarea placeholder="Mounting position, cable route, customer confirmation..." />
            </div>
          </section>

          <section className="rounded-[28px] bg-white p-5 shadow-xl shadow-indigo-100/50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Equipment Used</h2>
              <button type="button" onClick={() => addEquipment()} className="rounded-xl bg-[#3535FF] px-4 py-2 text-xs font-black text-white">Add row</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {quickItems.map((item) => (
                <button key={item} type="button" onClick={() => addEquipment(item)} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-black text-[#3535FF]">
                  + {item}
                </button>
              ))}
            </div>
            <div className="mt-5 space-y-4">
              {equipment.map((item, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_90px_80px]">
                    <label>
                      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Inventory item</span>
                      <select value={item.inventory_item_id || ''} onChange={(event) => updateEquipment(index, 'inventory_item_id', event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none">
                        <option value="">Custom / not in inventory</option>
                        {inventory.map((inventoryItem) => (
                          <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} ({inventoryItem.quantity} left)</option>
                        ))}
                      </select>
                    </label>
                    <Field label="Qty" type="number" value={item.quantity} onChange={(value) => updateEquipment(index, 'quantity', value)} />
                    <Field label="Unit" value={item.unit} onChange={(value) => updateEquipment(index, 'unit', value)} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <Field label="Name / notes" value={item.name} onChange={(value) => updateEquipment(index, 'name', value)} placeholder="ATB, drop cable, router..." />
                    <button type="button" onClick={() => removeEquipment(index)} className="h-11 rounded-xl border border-red-100 bg-red-50 px-4 text-xs font-black text-red-600">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={submit} disabled={saving} className="mt-5 h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white disabled:opacity-50">
              {saving ? 'Submitting...' : 'Submit Installation Report'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
