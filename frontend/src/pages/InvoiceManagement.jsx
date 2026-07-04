import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../utils/api';

const today = new Date().toISOString().slice(0, 10);

const emptyProfile = {
  company_name: '',
  template_key: 'classic_red',
  logo_data_url: '',
  phone: '',
  email: '',
  address: '',
  website: '',
  payment_method: '',
  account_name: '',
  account_number: '',
  branch_name: '',
  signature_name: '',
  signature_title: '',
  signature_data_url: '',
  terms: 'Payment is due by the invoice due date. Please contact us if you have any questions.',
};

const emptyDraft = {
  customer_name: '',
  customer_phone: '',
  customer_email: '',
  customer_address: '',
  issue_date: today,
  due_date: '',
  discount_amount: 0,
  notes: '',
  items: [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0 }],
};

const emptyProduct = { name: '', description: '', unit_price: '', tax_rate: 0 };

const invoiceTemplates = [
  { key: 'classic_red', name: 'Red Corporate', accent: '#e5092f', note: 'Sharp black and red business invoice.' },
  { key: 'modern_blue_orange', name: 'Blue Modern', accent: '#172b72', note: 'Clean navy invoice with orange accents.' },
];

function Icon({ name, className = 'h-5 w-5' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'settings') return <svg {...common}><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9c.2.61.78 1 1.56 1H21a2 2 0 1 1 0 4h-.09c-.78 0-1.36.39-1.51 1Z" /></svg>;
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
  if (name === 'send') return <svg {...common}><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></svg>;
  if (name === 'message') return <svg {...common}><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6a8 8 0 1 1 18-5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>;
  if (name === 'mail') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
  if (name === 'file') return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>;
  if (name === 'wallet') return <svg {...common}><path d="M19 7V6a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7" /><path d="M16 14h.01" /></svg>;
  if (name === 'pen') return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
  if (name === 'calendar') return <svg {...common}><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /></svg>;
  if (name === 'filter') return <svg {...common}><path d="M3 5h18M6 12h12M10 19h4" /></svg>;
  return <svg {...common}><path d="M12 3v18M3 12h18" /></svg>;
}

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function totals(items = [], discount = 0) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const tax = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.tax_rate || 0) / 100, 0);
  return { subtotal, tax, total: Math.max(0, subtotal - Number(discount || 0) + tax) };
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return reject(new Error('Use PNG, JPG or WEBP image.'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Image must be 2 MB or smaller.'));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

function Field({ label, value, onChange, type = 'text', textarea = false, placeholder = '', className = '' }) {
  const props = {
    value: value ?? '',
    onChange: (event) => onChange(event.target.value),
    placeholder,
    className: `w-full rounded-2xl border border-[#dfe5f2] bg-white px-4 py-3 text-sm font-bold text-[#121a3d] outline-none transition focus:border-[#6d35ff] ${className}`,
  };
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-[#8a93ad]">{label}</span>
      {textarea ? <textarea rows={3} {...props} /> : <input type={type} {...props} />}
    </label>
  );
}

function StatusPill({ children, tone = 'slate' }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-rose-50 text-rose-700',
    purple: 'bg-[#efe9ff] text-[#5d2df5]',
    slate: 'bg-slate-100 text-slate-600',
  };
  return <span className={`rounded-full px-3 py-1 text-[11px] font-black capitalize ${tones[tone] || tones.slate}`}>{children}</span>;
}

function SummaryCard({ label, value, helper, icon, tone = 'purple' }) {
  const toneClasses = {
    purple: 'bg-[#efe9ff] text-[#5d2df5]',
    red: 'bg-[#fff0f1] text-[#ff4d6a]',
    blue: 'bg-[#eef6ff] text-[#2563eb]',
    green: 'bg-[#eafff6] text-[#17c98f]',
  };
  return (
    <div className="min-w-0 rounded-[22px] border border-[#dfe5f2] bg-white p-4 shadow-[0_18px_40px_rgba(30,41,59,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${toneClasses[tone]}`}>
          <Icon name={icon} className="h-5 w-5" />
        </div>
        <div className="h-8 w-20 rounded-full bg-gradient-to-r from-transparent via-[#765cff]/25 to-[#765cff]/70 opacity-80" />
      </div>
      <p className="mt-3 text-xs font-black text-[#6d7697]">{label}</p>
      <p className="mt-1 truncate text-2xl font-black text-[#08103f]">{value}</p>
      <p className="mt-1 text-xs font-bold text-[#8a93ad]">{helper}</p>
    </div>
  );
}

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#101827';
    ctx.lineWidth = 2.6;
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = value;
    }
  }, [value]);

  const point = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (event) => {
    event.preventDefault();
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const stop = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  return (
    <div className="rounded-[22px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#08103f]">Draft signature</p>
          <p className="text-xs font-semibold text-[#7b86aa]">Draw here with mouse, touchpad or phone screen.</p>
        </div>
        <button type="button" onClick={clear} className="rounded-xl border border-[#dfe5f2] bg-white px-3 py-2 text-xs font-black text-[#59607a]">Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        width="720"
        height="210"
        className="h-36 w-full touch-none rounded-2xl border border-dashed border-[#cfd8ec] bg-white"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
      />
    </div>
  );
}

function InvoiceMiniPreview({ profile, draft }) {
  const calc = totals(draft.items, draft.discount_amount);
  const modern = profile.template_key === 'modern_blue_orange';
  return (
    <div className="overflow-hidden rounded-[28px] border border-[#dfe5f2] bg-white shadow-[0_24px_60px_rgba(30,41,59,0.12)]">
      <div className={`relative min-h-[132px] p-6 text-white ${modern ? 'bg-[#172b72]' : 'bg-[#171d27]'}`}>
        <div className={`absolute right-0 top-8 h-12 w-44 ${modern ? 'bg-[#ff9f05]' : 'bg-[#e5092f]'} -skew-y-12`} />
        {profile.logo_data_url ? <img src={profile.logo_data_url} alt="" className="relative z-10 mb-2 max-h-10 max-w-[160px] object-contain" /> : null}
        <p className="relative z-10 text-4xl font-black tracking-tight">INVOICE</p>
        <p className="relative z-10 mt-1 text-sm font-semibold">{profile.company_name || 'Company Name'}</p>
      </div>
      <div className="p-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
          <div>
            <p className={`text-[11px] font-black uppercase ${modern ? 'text-[#172b72]' : 'text-[#e5092f]'}`}>Invoice to</p>
            <p className="mt-1 text-xl font-black text-[#08103f]">{draft.customer_name || 'Customer Name'}</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#637098]">{draft.customer_phone || 'Phone number'}<br />{draft.customer_email || 'Email address'}</p>
          </div>
          <div className="rounded-2xl bg-[#f7f9fe] p-4 text-xs font-bold text-[#637098]">
            <p>Issue: {draft.issue_date || today}</p>
            <p>Due: {draft.due_date || '-'}</p>
            <p className="mt-2 text-[#08103f]">Template: {modern ? 'Blue Modern' : 'Red Corporate'}</p>
          </div>
        </div>
        <div className="mt-5 overflow-hidden rounded-2xl border border-[#e4e9f4]">
          <table className="w-full text-left text-xs">
            <thead className={`${modern ? 'bg-[#172b72]' : 'bg-[#e5092f]'} text-white`}>
              <tr><th className="p-3">Item</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Total</th></tr>
            </thead>
            <tbody>
              {draft.items.slice(0, 4).map((item, index) => (
                <tr key={index} className="border-t border-[#edf2f8]">
                  <td className="p-3 font-bold text-[#263150]">{item.description || 'Invoice item'}</td>
                  <td className="p-3 text-right font-bold text-[#637098]">{item.quantity || 1}</td>
                  <td className="p-3 text-right font-black text-[#08103f]">{money(Number(item.quantity || 0) * Number(item.unit_price || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_210px]">
          <div className="text-xs font-semibold leading-5 text-[#637098]">
            <p className="font-black text-[#08103f]">Payment details</p>
            <p>{profile.payment_method || 'Payment method'}<br />{profile.account_number || 'Account number'}<br />{profile.account_name || 'Account name'}</p>
            <div className="mt-4">
              {profile.signature_data_url ? <img src={profile.signature_data_url} alt="" className="mb-1 max-h-10 max-w-[150px] object-contain" /> : null}
              <div className="w-40 border-t border-[#cbd0df] pt-1 text-center text-[11px] font-black text-[#263150]">{profile.signature_name || 'Authorized Signature'}</div>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#e4e9f4] text-sm">
            <div className="flex justify-between px-4 py-2 text-[#637098]"><span>Subtotal</span><b>{money(calc.subtotal)}</b></div>
            <div className="flex justify-between px-4 py-2 text-[#637098]"><span>Tax</span><b>{money(calc.tax)}</b></div>
            <div className={`flex justify-between px-4 py-3 font-black text-white ${modern ? 'bg-[#172b72]' : 'bg-[#e5092f]'}`}><span>Total</span><span>{money(calc.total)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceManagement() {
  const [profile, setProfile] = useState(emptyProfile);
  const [products, setProducts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [lookup, setLookup] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryTarget, setDeliveryTarget] = useState(null);
  const [deliveryChannel, setDeliveryChannel] = useState('whatsapp');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const calc = useMemo(() => totals(draft.items, draft.discount_amount), [draft.items, draft.discount_amount]);
  const selectedInvoice = useMemo(() => invoices.find((invoice) => invoice.id === selectedId) || invoices[0] || null, [invoices, selectedId]);
  const dueCount = useMemo(() => invoices.filter((invoice) => ['draft', 'sent', 'overdue'].includes(invoice.status) && invoice.due_date && invoice.due_date <= today).length, [invoices]);
  const dueSoon = useMemo(() => {
    const limit = new Date();
    limit.setMonth(limit.getMonth() + 1);
    return invoices.filter((invoice) => invoice.due_date && new Date(invoice.due_date) <= limit && ['draft', 'sent', 'overdue'].includes(invoice.status));
  }, [invoices]);
  const paidAmount = useMemo(() => invoices.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0), [invoices]);
  const overdueAmount = useMemo(() => invoices.filter((invoice) => invoice.due_date && invoice.due_date <= today && invoice.status !== 'paid').reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0), [invoices]);
  const filteredInvoices = useMemo(() => {
    const key = query.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;
      const haystack = `${invoice.invoice_number} ${invoice.customer_name} ${invoice.customer_phone}`.toLowerCase();
      return matchesStatus && (!key || haystack.includes(key));
    });
  }, [invoices, query, statusFilter]);

  async function loadAll() {
    setLoading(true);
    try {
      const [profileRes, productRes, invoiceRes] = await Promise.all([api.get('/invoices/profile'), api.get('/invoices/products'), api.get('/invoices')]);
      setProfile({ ...emptyProfile, ...profileRes.data });
      setProducts(productRes.data || []);
      setInvoices(invoiceRes.data || []);
      setSelectedId((current) => current || invoiceRes.data?.[0]?.id || null);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to load invoice management.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleUpload(field, event) {
    try {
      const dataUrl = await readImage(event.target.files?.[0]);
      if (dataUrl) setProfile((current) => ({ ...current, [field]: dataUrl }));
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function saveProfile() {
    setBusy(true);
    try {
      const { data } = await api.put('/invoices/profile', profile);
      setProfile({ ...emptyProfile, ...data });
      setStatus('Invoice settings saved.');
      setSettingsOpen(false);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not save invoice setup.');
    } finally {
      setBusy(false);
    }
  }

  async function autofillInvoice() {
    if (!lookup.trim()) {
      setStatus('Type a customer name, phone, account number or username first.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/invoices/autofill', { query: lookup });
      setDraft((current) => ({ ...current, ...data, issue_date: today }));
      setStatus(`Autofilled invoice for ${data.customer_name || lookup}.`);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Customer was not found in billing.');
    } finally {
      setBusy(false);
    }
  }

  async function createInvoice(send = false, delivery = null) {
    if (!draft.customer_name.trim()) {
      setStatus('Customer name is required.');
      return false;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/invoices', draft);
      if (send) {
        await api.post(`/invoices/${data.id}/send`, {
          channel: delivery?.channel || 'whatsapp',
          phone: delivery?.channel === 'whatsapp' ? delivery?.address : draft.customer_phone,
          email: delivery?.channel === 'email' ? delivery?.address : draft.customer_email,
        });
      }
      setDraft(emptyDraft);
      setLookup('');
      setStatus(send ? `Created and sent ${data.invoice_number}.` : `Created draft ${data.invoice_number}.`);
      await loadAll();
      setSelectedId(data.id);
      return true;
    } catch (err) {
      setStatus(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not create invoice.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openDraftDelivery() {
    if (!draft.customer_name.trim()) {
      setStatus('Customer name is required.');
      return;
    }
    setDeliveryTarget({ type: 'draft' });
    setDeliveryChannel(draft.customer_email ? 'email' : 'whatsapp');
    setDeliveryAddress(draft.customer_email || draft.customer_phone || '');
    setDeliveryOpen(true);
  }

  function openInvoiceDelivery(invoice) {
    setDeliveryTarget({ type: 'invoice', invoice });
    setDeliveryChannel(invoice.customer_email ? 'email' : 'whatsapp');
    setDeliveryAddress(invoice.customer_email || invoice.customer_phone || '');
    setDeliveryOpen(true);
  }

  async function confirmDelivery() {
    if (!deliveryTarget) return;
    if (!deliveryAddress.trim()) {
      setStatus(deliveryChannel === 'email' ? 'Enter the customer email address.' : 'Enter the customer WhatsApp number.');
      return;
    }
    setBusy(true);
    try {
      if (deliveryTarget.type === 'draft') {
        const created = await createInvoice(true, { channel: deliveryChannel, address: deliveryAddress });
        if (!created) return;
      } else {
        await api.post(`/invoices/${deliveryTarget.invoice.id}/send`, {
          channel: deliveryChannel,
          phone: deliveryChannel === 'whatsapp' ? deliveryAddress : undefined,
          email: deliveryChannel === 'email' ? deliveryAddress : undefined,
        });
        setStatus(`Invoice sent by ${deliveryChannel === 'email' ? 'email' : 'WhatsApp'}.`);
        await loadAll();
      }
      setDeliveryOpen(false);
      setDeliveryTarget(null);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Invoice could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function addProduct() {
    if (!productForm.name.trim()) {
      setStatus('Product name is required.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/invoices/products', productForm);
      setProducts((items) => [data, ...items]);
      setProductForm(emptyProduct);
      setProductOpen(false);
      setStatus('Product added.');
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not add product.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(product) {
    if (!window.confirm(`Delete product "${product.name}" from the catalog?`)) return;
    setBusy(true);
    try {
      await api.delete(`/invoices/products/${product.id}`);
      setProducts((items) => items.filter((item) => item.id !== product.id));
      setDraft((current) => ({
        ...current,
        items: current.items.map((item) => item.product_id === product.id ? { ...item, product_id: '' } : item),
      }));
      setStatus('Product deleted.');
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not delete product.');
    } finally {
      setBusy(false);
    }
  }

  function updateItem(index, patch) {
    setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  }

  function useProduct(index, id) {
    const product = products.find((item) => String(item.id) === String(id));
    if (!product) return;
    updateItem(index, { product_id: product.id, description: product.name, unit_price: product.unit_price, tax_rate: product.tax_rate });
  }

  async function sendInvoice(invoice) {
    openInvoiceDelivery(invoice);
  }

  async function sendDue() {
    if (!window.confirm(`Send WhatsApp reminders for ${dueCount} due invoice(s)?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/invoices/send-due/bulk');
      setStatus(`Due send complete: ${data.results.filter((item) => item.status === 'sent').length}/${data.total} sent.`);
      await loadAll();
    } catch (err) {
      setStatus(err.response?.data?.error || 'Due invoices could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="h-full min-h-0 overflow-y-auto p-6 text-sm font-black text-[#637098]">Loading invoice management...</div>;

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-[#f6f8ff] p-3 sm:p-5">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6d35ff]">Invoice control center</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#08103f]">Invoices</h1>
            <p className="mt-1 text-sm font-semibold text-[#637098]">Manage, generate, send and style customer invoices in one workspace.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSettingsOpen(true)} className="flex h-11 items-center gap-2 rounded-2xl border border-[#dfe5f2] bg-white px-4 text-sm font-black text-[#263150] shadow-sm">
              <Icon name="settings" className="h-4 w-4" />
              Invoice Settings
            </button>
            <button type="button" onClick={openDraftDelivery} disabled={busy} className="flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] px-5 text-sm font-black text-white shadow-[0_16px_34px_rgba(81,53,245,0.25)] disabled:opacity-60">
              <Icon name="plus" className="h-4 w-4" />
              Create invoice
            </button>
          </div>
        </header>

        {status && <div className="rounded-2xl border border-[#dfe5f2] bg-white px-4 py-3 text-sm font-black text-[#263150]">{status}</div>}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Overdue" value={money(overdueAmount)} helper={`${dueCount} due invoice(s)`} icon="wallet" tone="red" />
          <SummaryCard label="Due within next month" value={money(dueSoon.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0))} helper={`${dueSoon.length} upcoming invoice(s)`} icon="calendar" tone="purple" />
          <SummaryCard label="Average time to get paid" value="--" helper="Shown after paid invoices have dates" icon="file" tone="blue" />
          <SummaryCard label="Available for instant payout" value={money(paidAmount)} helper="Paid invoices recorded" icon="wallet" tone="green" />
        </section>

        <section className="grid min-h-0 gap-4 2xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="order-2 min-w-0 overflow-hidden rounded-[28px] bg-[#101427] text-white shadow-[0_20px_60px_rgba(15,23,42,0.18)] 2xl:order-1">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black">Invoice queue</p>
                  <p className="text-xs font-semibold text-white/55">{filteredInvoices.length} of {invoices.length}</p>
                </div>
                <button type="button" onClick={sendDue} disabled={dueCount === 0 || busy} className="rounded-full bg-white px-4 py-2 text-xs font-black text-[#101427] disabled:opacity-40">Send due</button>
              </div>
              <div className="mt-4 rounded-2xl bg-white/8 p-2">
                <div className="flex items-center gap-2 rounded-xl bg-[#0a0e1d] px-3 py-2">
                  <Icon name="search" className="h-4 w-4 text-white/55" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice or customer..." className="min-w-0 flex-1 bg-transparent text-xs font-bold text-white outline-none placeholder:text-white/35" />
                </div>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#0a0e1d] px-3 text-xs font-black text-white outline-none">
                  <option value="all">All invoices</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="overdue">Overdue</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
            <div className="max-h-[480px] space-y-2 overflow-y-auto p-3">
              {filteredInvoices.length === 0 && <p className="p-5 text-center text-sm font-bold text-white/45">No invoices match your filters.</p>}
              {filteredInvoices.map((invoice) => {
                const active = selectedInvoice?.id === invoice.id;
                return (
                  <button
                    key={invoice.id}
                    type="button"
                    onClick={() => setSelectedId(invoice.id)}
                    className={`w-full rounded-2xl p-3 text-left transition ${active ? 'bg-gradient-to-r from-[#3158ff] to-[#812cff] shadow-[0_12px_30px_rgba(81,53,245,0.3)]' : 'bg-white/6 hover:bg-white/10'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">#{invoice.invoice_number}</p>
                        <p className="mt-1 truncate text-xs font-semibold text-white/70">{invoice.customer_name}</p>
                      </div>
                      <StatusPill tone={invoice.status === 'paid' ? 'green' : invoice.status === 'overdue' ? 'red' : active ? 'slate' : 'purple'}>{invoice.status}</StatusPill>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs font-black">
                      <span className="text-white/60">{invoice.due_date ? `Due ${invoice.due_date.slice(0, 10)}` : 'No due date'}</span>
                      <span>{money(invoice.total_amount)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="order-1 min-w-0 rounded-[28px] border border-[#dfe5f2] bg-white p-4 shadow-[0_22px_60px_rgba(30,41,59,0.08)] 2xl:order-2">
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-4">
                <section className="rounded-[24px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="min-w-0 flex-1">
                      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-[#8a93ad]">Customer lookup</span>
                      <div className="flex h-12 items-center gap-3 rounded-2xl border border-[#dfe5f2] bg-white px-4">
                        <Icon name="search" className="h-4 w-4 text-[#8a93ad]" />
                        <input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Name, phone, account number or username" className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[#121a3d] outline-none placeholder:text-[#9aa4bf]" />
                      </div>
                    </label>
                    <button type="button" onClick={autofillInvoice} disabled={busy} className="h-12 rounded-2xl bg-[#101427] px-5 text-sm font-black text-white disabled:opacity-50">Fetch details</button>
                  </div>
                </section>

                <section className="rounded-[24px] border border-[#dfe5f2] bg-white p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-[#08103f]">Invoice details</p>
                      <p className="text-xs font-semibold text-[#637098]">Autofill from billing or draft manually.</p>
                    </div>
                    <StatusPill tone="purple">Total {money(calc.total)}</StatusPill>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Customer name" value={draft.customer_name} onChange={(v) => setDraft({ ...draft, customer_name: v })} />
                    <Field label="Phone / WhatsApp" value={draft.customer_phone} onChange={(v) => setDraft({ ...draft, customer_phone: v })} />
                    <Field label="Email" value={draft.customer_email} onChange={(v) => setDraft({ ...draft, customer_email: v })} />
                    <Field label="Due date" type="date" value={draft.due_date} onChange={(v) => setDraft({ ...draft, due_date: v })} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="Address" value={draft.customer_address} onChange={(v) => setDraft({ ...draft, customer_address: v })} textarea />
                    <Field label="Notes" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} textarea />
                  </div>
                </section>

                <section className="rounded-[24px] border border-[#dfe5f2] bg-white p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-[#08103f]">Items</p>
                      <p className="text-xs font-semibold text-[#637098]">Pick products or type custom invoice lines.</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setProductOpen(true)} className="rounded-xl border border-[#dfe5f2] bg-white px-3 py-2 text-xs font-black text-[#263150]">Add product</button>
                      <button type="button" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, { description: '', quantity: 1, unit_price: 0, tax_rate: 0 }] }))} className="rounded-xl bg-[#efe9ff] px-3 py-2 text-xs font-black text-[#5d2df5]">Add item</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {draft.items.map((item, index) => (
                      <div key={index} className="rounded-2xl border border-[#e4e9f4] bg-[#fbfcff] p-3">
                        <div className="grid gap-2 lg:grid-cols-[1fr_1.25fr_80px_110px_76px]">
                          <select value={item.product_id || ''} onChange={(event) => useProduct(index, event.target.value)} className="h-11 rounded-xl border border-[#dfe5f2] bg-white px-3 text-xs font-black text-[#263150] outline-none">
                            <option value="">Catalog</option>
                            {products.filter((product) => product.is_active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                          </select>
                          <input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} placeholder="Package or invoice item" className="h-11 rounded-xl border border-[#dfe5f2] bg-white px-3 text-xs font-bold text-[#263150] outline-none" />
                          <input type="number" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} className="h-11 rounded-xl border border-[#dfe5f2] bg-white px-3 text-xs font-bold text-[#263150] outline-none" />
                          <input type="number" value={item.unit_price} onChange={(event) => updateItem(index, { unit_price: event.target.value })} className="h-11 rounded-xl border border-[#dfe5f2] bg-white px-3 text-xs font-bold text-[#263150] outline-none" />
                          <button type="button" onClick={() => setDraft((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((_, itemIndex) => itemIndex !== index) : current.items }))} className="h-11 rounded-xl bg-rose-50 text-xs font-black text-rose-600">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => createInvoice(false)} disabled={busy} className="h-11 rounded-2xl bg-[#101427] px-5 text-sm font-black text-white disabled:opacity-50">Save draft</button>
                    <button type="button" onClick={openDraftDelivery} disabled={busy} className="flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] px-5 text-sm font-black text-white disabled:opacity-50">
                      <Icon name="send" className="h-4 w-4" />
                      Create and send
                    </button>
                  </div>
                </section>
              </div>

              <aside className="min-w-0 space-y-4">
                {selectedInvoice && (
                  <section className="rounded-[24px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#6d35ff]">Selected invoice</p>
                        <h2 className="mt-1 truncate text-2xl font-black text-[#08103f]">#{selectedInvoice.invoice_number}</h2>
                        <p className="mt-1 text-sm font-semibold text-[#637098]">{selectedInvoice.customer_name}</p>
                      </div>
                      <StatusPill tone={selectedInvoice.status === 'paid' ? 'green' : selectedInvoice.status === 'overdue' ? 'red' : 'purple'}>{selectedInvoice.status}</StatusPill>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-[#637098]">
                      <div className="rounded-2xl bg-white p-3"><span className="block text-[#8a93ad]">Total</span><b className="text-[#08103f]">{money(selectedInvoice.total_amount)}</b></div>
                      <div className="rounded-2xl bg-white p-3"><span className="block text-[#8a93ad]">Due</span><b className="text-[#08103f]">{selectedInvoice.due_date ? selectedInvoice.due_date.slice(0, 10) : '-'}</b></div>
                    </div>
                    <button type="button" onClick={() => sendInvoice(selectedInvoice)} disabled={busy} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#101427] text-sm font-black text-white disabled:opacity-50">
                      <Icon name="send" className="h-4 w-4" />
                      Send invoice
                    </button>
                  </section>
                )}
                <InvoiceMiniPreview profile={profile} draft={draft} />
              </aside>
            </div>
          </main>
        </section>

        {settingsOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center">
            <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[30px] border border-[#dfe5f2] bg-white p-5 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6d35ff]">Invoice settings</p>
                  <h2 className="mt-1 text-2xl font-black text-[#08103f]">Brand, payment and signature</h2>
                  <p className="mt-1 text-sm font-semibold text-[#637098]">These settings appear on every generated invoice PDF.</p>
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-2xl border border-[#dfe5f2] bg-white px-4 py-3 text-sm font-black text-[#263150]">Close</button>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
                <div className="space-y-5">
                  <section className="rounded-[24px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
                    <p className="mb-3 text-sm font-black text-[#08103f]">Template</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {invoiceTemplates.map((template) => {
                        const selected = (profile.template_key || 'classic_red') === template.key;
                        return (
                          <button
                            key={template.key}
                            type="button"
                            onClick={() => setProfile({ ...profile, template_key: template.key })}
                            className={`rounded-[22px] border p-4 text-left transition ${selected ? 'border-[#6d35ff] bg-[#efe9ff]' : 'border-[#dfe5f2] bg-white'}`}
                          >
                            <div className="mb-3 flex h-20 overflow-hidden rounded-2xl bg-white">
                              <div className="flex-1 p-3 text-xs font-black text-white" style={{ backgroundColor: template.accent }}>INVOICE</div>
                              <div className="w-14" style={{ backgroundColor: template.key === 'modern_blue_orange' ? '#ff9f05' : '#171d27' }} />
                              <div className="flex-1 p-3"><div className="h-2 rounded bg-slate-200" /><div className="mt-2 h-2 rounded bg-slate-100" /></div>
                            </div>
                            <p className="text-sm font-black text-[#08103f]">{template.name}</p>
                            <p className="mt-1 text-xs font-semibold text-[#637098]">{template.note}</p>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
                    <p className="mb-3 text-sm font-black text-[#08103f]">Company details</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-[#cfd8ec] bg-white p-4">
                        <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-2xl bg-[#f7f9fe]">
                          {profile.logo_data_url ? <img src={profile.logo_data_url} alt="" className="h-full w-full object-contain" /> : <span className="text-xs font-black text-[#8a93ad]">Logo</span>}
                        </div>
                        <div><p className="text-sm font-black text-[#08103f]">Upload logo</p><p className="text-xs font-semibold text-[#637098]">PNG, JPG or WEBP</p></div>
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => handleUpload('logo_data_url', event)} />
                      </label>
                      <Field label="Company name" value={profile.company_name} onChange={(v) => setProfile({ ...profile, company_name: v })} />
                      <Field label="Phone" value={profile.phone} onChange={(v) => setProfile({ ...profile, phone: v })} />
                      <Field label="Email" value={profile.email} onChange={(v) => setProfile({ ...profile, email: v })} />
                      <Field label="Website" value={profile.website} onChange={(v) => setProfile({ ...profile, website: v })} />
                      <Field label="Address" value={profile.address} onChange={(v) => setProfile({ ...profile, address: v })} textarea />
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
                    <p className="mb-3 text-sm font-black text-[#08103f]">Payment details</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Payment method" value={profile.payment_method} onChange={(v) => setProfile({ ...profile, payment_method: v })} placeholder="M-Pesa Paybill, Bank..." />
                      <Field label="Account number" value={profile.account_number} onChange={(v) => setProfile({ ...profile, account_number: v })} />
                      <Field label="Account name" value={profile.account_name} onChange={(v) => setProfile({ ...profile, account_name: v })} />
                      <Field label="Branch / reference" value={profile.branch_name} onChange={(v) => setProfile({ ...profile, branch_name: v })} />
                      <Field label="Terms" value={profile.terms} onChange={(v) => setProfile({ ...profile, terms: v })} textarea />
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-[#dfe5f2] bg-[#fbfcff] p-4">
                    <p className="mb-3 text-sm font-black text-[#08103f]">Signature builder</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Signer name" value={profile.signature_name} onChange={(v) => setProfile({ ...profile, signature_name: v })} />
                      <Field label="Signer title" value={profile.signature_title} onChange={(v) => setProfile({ ...profile, signature_title: v })} />
                    </div>
                    <div className="mt-3">
                      <SignaturePad value={profile.signature_data_url} onChange={(value) => setProfile((current) => ({ ...current, signature_data_url: value }))} />
                    </div>
                    <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-[#cfd8ec] bg-white p-3">
                      <Icon name="pen" className="h-5 w-5 text-[#6d35ff]" />
                      <span className="text-sm font-black text-[#263150]">Or upload signature image</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => handleUpload('signature_data_url', event)} />
                    </label>
                  </section>
                </div>

                <aside className="space-y-4">
                  <InvoiceMiniPreview profile={profile} draft={draft} />
                  <button type="button" onClick={saveProfile} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] text-sm font-black text-white disabled:opacity-60">
                    <Icon name="settings" className="h-4 w-4" />
                    Save invoice settings
                  </button>
                </aside>
              </div>
            </div>
          </div>
        )}

        {productOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center">
            <div className="w-full max-w-lg rounded-[28px] border border-[#dfe5f2] bg-white p-5 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-[#08103f]">Add product</h2>
                  <p className="text-sm font-semibold text-[#637098]">Create reusable catalog items for invoice lines.</p>
                </div>
                <button type="button" onClick={() => setProductOpen(false)} className="rounded-xl border border-[#dfe5f2] bg-white px-3 py-2 text-xs font-black text-[#59607a]">Cancel</button>
              </div>
              <div className="space-y-3">
                <Field label="Product name" value={productForm.name} onChange={(v) => setProductForm({ ...productForm, name: v })} />
                <Field label="Description" value={productForm.description} onChange={(v) => setProductForm({ ...productForm, description: v })} textarea />
                <Field label="Unit price" type="number" value={productForm.unit_price} onChange={(v) => setProductForm({ ...productForm, unit_price: v })} />
                <Field label="Tax rate %" type="number" value={productForm.tax_rate} onChange={(v) => setProductForm({ ...productForm, tax_rate: v })} />
                <button type="button" onClick={addProduct} disabled={busy} className="h-12 w-full rounded-2xl bg-[#101427] text-sm font-black text-white disabled:opacity-50">Save product</button>
              </div>
              <div className="mt-5 border-t border-[#dfe5f2] pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-[#08103f]">Catalog products</p>
                    <p className="text-xs font-semibold text-[#637098]">Delete products you no longer want admins to pick.</p>
                  </div>
                  <StatusPill tone="purple">{products.filter((product) => product.is_active !== false).length} active</StatusPill>
                </div>
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {products.filter((product) => product.is_active !== false).length === 0 && (
                    <div className="rounded-2xl border border-dashed border-[#dfe5f2] bg-[#fbfcff] p-4 text-center text-xs font-bold text-[#8a93ad]">
                      No saved products yet.
                    </div>
                  )}
                  {products.filter((product) => product.is_active !== false).map((product) => (
                    <div key={product.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e4e9f4] bg-[#fbfcff] p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[#08103f]">{product.name}</p>
                        <p className="truncate text-xs font-semibold text-[#637098]">{money(product.unit_price)}{Number(product.tax_rate || 0) ? ` - Tax ${product.tax_rate}%` : ''}</p>
                      </div>
                      <button type="button" onClick={() => deleteProduct(product)} disabled={busy} className="shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 disabled:opacity-50">
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {deliveryOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 sm:items-center">
            <div className="w-full max-w-xl rounded-[28px] border border-[#dfe5f2] bg-white p-5 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6d35ff]">Delivery method</p>
                  <h2 className="mt-1 text-xl font-black text-[#08103f]">Send invoice</h2>
                  <p className="mt-1 text-sm font-semibold text-[#637098]">Choose how this online invoice should reach the customer.</p>
                </div>
                <button type="button" onClick={() => setDeliveryOpen(false)} className="rounded-xl border border-[#dfe5f2] bg-white px-3 py-2 text-xs font-black text-[#59607a]">Cancel</button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryChannel('whatsapp');
                    setDeliveryAddress(deliveryTarget?.type === 'invoice' ? (deliveryTarget.invoice.customer_phone || '') : (draft.customer_phone || ''));
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${deliveryChannel === 'whatsapp' ? 'border-[#6d35ff] bg-[#efe9ff]' : 'border-[#dfe5f2] bg-[#fbfcff]'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#5d2df5]"><Icon name="message" className="h-5 w-5" /></span>
                    <div>
                      <p className="text-sm font-black text-[#08103f]">WhatsApp</p>
                      <p className="text-xs font-semibold text-[#637098]">Send the PDF to the customer chat.</p>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryChannel('email');
                    setDeliveryAddress(deliveryTarget?.type === 'invoice' ? (deliveryTarget.invoice.customer_email || '') : (draft.customer_email || ''));
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${deliveryChannel === 'email' ? 'border-[#6d35ff] bg-[#efe9ff]' : 'border-[#dfe5f2] bg-[#fbfcff]'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#5d2df5]"><Icon name="mail" className="h-5 w-5" /></span>
                    <div>
                      <p className="text-sm font-black text-[#08103f]">Email</p>
                      <p className="text-xs font-semibold text-[#637098]">Send the invoice link by email.</p>
                    </div>
                  </div>
                </button>
              </div>

              <div className="mt-4">
                <Field
                  label={deliveryChannel === 'email' ? 'Email address' : 'WhatsApp number'}
                  value={deliveryAddress}
                  onChange={setDeliveryAddress}
                  placeholder={deliveryChannel === 'email' ? 'customer@example.com' : '+2547...'}
                />
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setDeliveryOpen(false)} className="h-12 rounded-2xl border border-[#dfe5f2] bg-white px-5 text-sm font-black text-[#263150]">
                  Cancel
                </button>
                <button type="button" onClick={confirmDelivery} disabled={busy} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3158ff] to-[#812cff] px-5 text-sm font-black text-white disabled:opacity-50">
                  <Icon name="send" className="h-4 w-4" />
                  Send by {deliveryChannel === 'email' ? 'Email' : 'WhatsApp'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
