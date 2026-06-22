import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const emptyProfile = {
  company_name: '',
  logo_url: '',
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
  signature_image_url: '',
  terms: 'Payment is due by the invoice due date. Please contact us if you have any questions.',
};

const emptyProduct = { name: '', description: '', unit_price: '', tax_rate: 0 };
const today = new Date().toISOString().slice(0, 10);

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Section({ title, action, children }) {
  return (
    <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, type = 'text', textarea = false, placeholder = '' }) {
  const common = {
    value,
    onChange: (event) => onChange(event.target.value),
    placeholder,
    className: 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-red-500 focus:bg-white',
  };
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      {textarea ? <textarea rows={3} {...common} /> : <input type={type} {...common} />}
    </label>
  );
}

function InvoicePreview({ profile, draft }) {
  const items = draft.items || [];
  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);
  const tax = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.tax_rate || 0) / 100), 0);
  const discount = Number(draft.discount_amount || 0);
  const total = Math.max(0, subtotal - discount + tax);
  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-xl">
      <div className="grid grid-cols-[1.1fr_0.9fr]">
        <div className="relative bg-[#171d27] px-6 py-7 text-white">
          <div className="absolute right-[-54px] top-0 h-28 w-36 rounded-bl-[70px] bg-[#e5092f]" />
          {profile.logo_url ? <img src={profile.logo_url} alt="" className="relative z-10 mb-3 max-h-12 max-w-[170px] object-contain" /> : null}
          <div className="relative z-10 text-xl font-black">{profile.company_name || 'Company Name'}</div>
          <div className="relative z-10 text-xs text-slate-300">Professional Invoice</div>
        </div>
        <div className="bg-[#e5092f] px-6 py-6 text-xs font-semibold leading-6 text-white">
          <div>{profile.phone || '+254 XXX XXX XXX'}</div>
          <div>{profile.email || 'billing@company.com'}</div>
          <div>{profile.address || 'Company address'}</div>
        </div>
      </div>
      <div className="p-6">
        <div className="grid gap-6 md:grid-cols-[1fr_250px]">
          <div>
            <div className="text-xs font-black uppercase text-[#e5092f]">Invoice To</div>
            <div className="mt-2 text-2xl font-black text-slate-900">{draft.customer_name || 'Customer Name'}</div>
            <div className="mt-2 text-xs font-semibold leading-6 text-slate-500">
              Phone: {draft.customer_phone || '-'}<br />
              Email: {draft.customer_email || '-'}<br />
              Address: {draft.customer_address || '-'}
            </div>
          </div>
          <div>
            <div className="text-4xl font-black tracking-tight text-slate-900">INVOICE</div>
            <div className="mt-3 text-xs font-semibold leading-6 text-slate-600">
              Invoice No: Auto<br />
              Issue Date: {draft.issue_date || today}<br />
              Due Date: {draft.due_date || '-'}
            </div>
            <div className="mt-4 text-xs font-black uppercase text-[#e5092f]">Payment Method</div>
            <div className="mt-1 text-xs font-semibold leading-6 text-slate-600">
              {profile.payment_method || '-'}<br />
              {profile.account_number || '-'}<br />
              {profile.account_name || '-'}
            </div>
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#e5092f] text-white">
              <tr><th className="p-3">No.</th><th className="p-3">Item Description</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Qty.</th><th className="p-3 text-right">Total</th></tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} className="border-t border-slate-100">
                  <td className="p-3">{String(index + 1).padStart(2, '0')}</td>
                  <td className="p-3 font-semibold text-slate-700">{item.description || 'Invoice item'}</td>
                  <td className="p-3 text-right">{money(item.unit_price)}</td>
                  <td className="p-3 text-right">{item.quantity || 1}</td>
                  <td className="p-3 text-right">{money(Number(item.quantity || 0) * Number(item.unit_price || 0))}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="p-5 text-center text-slate-400">Add invoice items to preview</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_260px]">
          <div>
            <div className="font-black text-slate-900">Thank you for your business with us.</div>
            <div className="mt-3 text-xs font-black uppercase text-[#e5092f]">Terms & Conditions</div>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{profile.terms || emptyProfile.terms}</p>
            <div className="mt-5">
              {profile.signature_image_url ? <img src={profile.signature_image_url} alt="" className="mb-2 max-h-12 max-w-[180px] object-contain" /> : null}
              <div className="w-48 border-t border-slate-300 pt-2 text-center text-xs font-black text-slate-700">
                {profile.signature_name || 'Authorized Signature'}
                <div className="font-semibold text-slate-400">{profile.signature_title}</div>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 text-sm">
            <div className="flex justify-between border-b border-slate-100 px-4 py-3"><span>Subtotal</span><b>{money(subtotal)}</b></div>
            <div className="flex justify-between border-b border-slate-100 px-4 py-3"><span>Discount</span><b>{money(discount)}</b></div>
            <div className="flex justify-between border-b border-slate-100 px-4 py-3"><span>Tax</span><b>{money(tax)}</b></div>
            <div className="flex justify-between bg-[#e5092f] px-4 py-3 font-black text-white"><span>Total</span><span>{money(total)}</span></div>
          </div>
        </div>
      </div>
      <div className="h-8 bg-gradient-to-r from-[#e5092f] from-40% to-[#171d27]" />
    </div>
  );
}

export default function InvoiceManagement() {
  const [tab, setTab] = useState('invoices');
  const [profile, setProfile] = useState(emptyProfile);
  const [products, setProducts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [draft, setDraft] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    customer_address: '',
    issue_date: today,
    due_date: '',
    discount_amount: 0,
    notes: '',
    items: [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0 }],
  });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const dueCount = useMemo(() => invoices.filter((invoice) => ['draft', 'sent', 'overdue'].includes(invoice.status) && invoice.due_date && invoice.due_date <= today).length, [invoices]);

  async function loadAll() {
    setLoading(true);
    try {
      const [profileRes, productRes, invoiceRes] = await Promise.all([
        api.get('/invoices/profile'),
        api.get('/invoices/products'),
        api.get('/invoices'),
      ]);
      setProfile({ ...emptyProfile, ...profileRes.data });
      setProducts(productRes.data);
      setInvoices(invoiceRes.data);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Failed to load invoice management');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const saveProfile = async () => {
    const { data } = await api.put('/invoices/profile', profile);
    setProfile({ ...emptyProfile, ...data });
    setStatus('Invoice profile saved');
  };

  const addProduct = async () => {
    if (!productForm.name.trim()) return setStatus('Product name is required');
    const { data } = await api.post('/invoices/products', productForm);
    setProducts((items) => [data, ...items]);
    setProductForm(emptyProduct);
    setStatus('Product added');
  };

  const updateDraftItem = (index, patch) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const useProduct = (index, productId) => {
    const product = products.find((item) => String(item.id) === String(productId));
    if (!product) return;
    updateDraftItem(index, {
      product_id: product.id,
      description: product.name,
      unit_price: product.unit_price,
      tax_rate: product.tax_rate,
    });
  };

  const createInvoice = async () => {
    if (!draft.customer_name.trim()) return setStatus('Customer name is required');
    const { data } = await api.post('/invoices', draft);
    setInvoices((items) => [data, ...items]);
    setDraft({ ...draft, customer_name: '', customer_phone: '', customer_email: '', customer_address: '', due_date: '', items: [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0 }] });
    setStatus(`Created ${data.invoice_number}`);
  };

  const sendInvoice = async (invoice) => {
    const phone = window.prompt('Send to WhatsApp number:', invoice.customer_phone || '');
    if (phone === null) return;
    const { data } = await api.post(`/invoices/${invoice.id}/send`, { phone });
    setStatus(`Invoice sent to ${data.sent_to}`);
    loadAll();
  };

  const sendDue = async () => {
    if (!window.confirm(`Send WhatsApp reminders for ${dueCount} due invoice(s)?`)) return;
    const { data } = await api.post('/invoices/send-due/bulk');
    setStatus(`Due invoice send complete: ${data.results.filter((r) => r.status === 'sent').length}/${data.total} sent`);
    loadAll();
  };

  if (loading) return <div className="flex-1 p-8 text-sm font-semibold text-slate-500">Loading invoice management...</div>;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f5f6fa] p-5 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-slate-950">Invoice Management</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">Create invoices, manage products, and send due invoices through WhatsApp.</p>
          </div>
          <button onClick={sendDue} disabled={dueCount === 0} className="rounded-xl bg-[#e5092f] px-5 py-3 text-sm font-black text-white shadow-lg disabled:opacity-40">
            Send Due Invoices ({dueCount})
          </button>
        </header>

        {status && <div className="mb-4 rounded-xl border border-red-100 bg-white px-4 py-3 text-sm font-bold text-slate-700">{status}</div>}

        <div className="mb-5 flex flex-wrap gap-2">
          {[
            ['invoices', 'Invoices'],
            ['products', 'Products'],
            ['profile', 'Company Setup'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`rounded-xl px-4 py-2 text-sm font-black ${tab === id ? 'bg-[#171d27] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{label}</button>
          ))}
        </div>

        {tab === 'profile' && (
          <div className="grid gap-5 xl:grid-cols-[1fr_520px]">
            <Section title="Company Branding">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Company name" value={profile.company_name} onChange={(v) => setProfile({ ...profile, company_name: v })} />
                <Field label="Logo URL" value={profile.logo_url} onChange={(v) => setProfile({ ...profile, logo_url: v })} />
                <Field label="Phone" value={profile.phone} onChange={(v) => setProfile({ ...profile, phone: v })} />
                <Field label="Email" value={profile.email} onChange={(v) => setProfile({ ...profile, email: v })} />
                <Field label="Address" value={profile.address} onChange={(v) => setProfile({ ...profile, address: v })} textarea />
                <Field label="Website" value={profile.website} onChange={(v) => setProfile({ ...profile, website: v })} />
                <Field label="Payment method" value={profile.payment_method} onChange={(v) => setProfile({ ...profile, payment_method: v })} />
                <Field label="Account number" value={profile.account_number} onChange={(v) => setProfile({ ...profile, account_number: v })} />
                <Field label="Account name" value={profile.account_name} onChange={(v) => setProfile({ ...profile, account_name: v })} />
                <Field label="Branch name" value={profile.branch_name} onChange={(v) => setProfile({ ...profile, branch_name: v })} />
                <Field label="Signature name" value={profile.signature_name} onChange={(v) => setProfile({ ...profile, signature_name: v })} />
                <Field label="Signature title" value={profile.signature_title} onChange={(v) => setProfile({ ...profile, signature_title: v })} />
                <Field label="Signature image URL" value={profile.signature_image_url} onChange={(v) => setProfile({ ...profile, signature_image_url: v })} />
                <Field label="Terms" value={profile.terms} onChange={(v) => setProfile({ ...profile, terms: v })} textarea />
              </div>
              <button onClick={saveProfile} className="mt-4 rounded-xl bg-[#171d27] px-5 py-3 text-sm font-black text-white">Save Company Setup</button>
            </Section>
            <InvoicePreview profile={profile} draft={draft} />
          </div>
        )}

        {tab === 'products' && (
          <div className="grid gap-5 lg:grid-cols-[390px_1fr]">
            <Section title="Add Product">
              <div className="space-y-3">
                <Field label="Product name" value={productForm.name} onChange={(v) => setProductForm({ ...productForm, name: v })} />
                <Field label="Description" value={productForm.description} onChange={(v) => setProductForm({ ...productForm, description: v })} textarea />
                <Field label="Unit price" type="number" value={productForm.unit_price} onChange={(v) => setProductForm({ ...productForm, unit_price: v })} />
                <Field label="Tax rate %" type="number" value={productForm.tax_rate} onChange={(v) => setProductForm({ ...productForm, tax_rate: v })} />
                <button onClick={addProduct} className="w-full rounded-xl bg-[#e5092f] px-4 py-3 text-sm font-black text-white">Add Product</button>
              </div>
            </Section>
            <Section title="Product Catalog">
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950 text-white"><tr><th className="p-3">Product</th><th className="p-3">Description</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Tax</th></tr></thead>
                  <tbody>{products.map((product) => <tr key={product.id} className="border-t border-slate-100 bg-white"><td className="p-3 font-black">{product.name}</td><td className="p-3 text-slate-500">{product.description}</td><td className="p-3 text-right">{money(product.unit_price)}</td><td className="p-3 text-right">{money(product.tax_rate)}%</td></tr>)}</tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {tab === 'invoices' && (
          <div className="grid gap-5 xl:grid-cols-[1fr_520px]">
            <main className="space-y-5">
              <Section title="Create Invoice">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Customer name" value={draft.customer_name} onChange={(v) => setDraft({ ...draft, customer_name: v })} />
                  <Field label="WhatsApp phone" value={draft.customer_phone} onChange={(v) => setDraft({ ...draft, customer_phone: v })} />
                  <Field label="Customer email" value={draft.customer_email} onChange={(v) => setDraft({ ...draft, customer_email: v })} />
                  <Field label="Due date" type="date" value={draft.due_date} onChange={(v) => setDraft({ ...draft, due_date: v })} />
                  <Field label="Customer address" value={draft.customer_address} onChange={(v) => setDraft({ ...draft, customer_address: v })} textarea />
                  <Field label="Discount" type="number" value={draft.discount_amount} onChange={(v) => setDraft({ ...draft, discount_amount: v })} />
                </div>
                <div className="mt-4 space-y-3">
                  {draft.items.map((item, index) => (
                    <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_100px_110px_80px]">
                        <select value={item.product_id || ''} onChange={(event) => useProduct(index, event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold">
                          <option value="">Select product</option>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                        </select>
                        <input value={item.description} onChange={(event) => updateDraftItem(index, { description: event.target.value })} placeholder="Description" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
                        <input type="number" value={item.quantity} onChange={(event) => updateDraftItem(index, { quantity: event.target.value })} placeholder="Qty" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
                        <input type="number" value={item.unit_price} onChange={(event) => updateDraftItem(index, { unit_price: event.target.value })} placeholder="Price" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
                        <button onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-xl bg-red-50 text-xs font-black text-red-600">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={() => setDraft((current) => ({ ...current, items: [...current.items, { description: '', quantity: 1, unit_price: 0, tax_rate: 0 }] }))} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">Add Item</button>
                  <button onClick={createInvoice} className="rounded-xl bg-[#e5092f] px-5 py-2 text-sm font-black text-white">Create Invoice</button>
                </div>
              </Section>

              <Section title="Recent Invoices">
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-950 text-white"><tr><th className="p-3">Invoice</th><th className="p-3">Customer</th><th className="p-3">Due</th><th className="p-3 text-right">Total</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
                    <tbody>{invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-t border-slate-100 bg-white">
                        <td className="p-3 font-black">{invoice.invoice_number}</td>
                        <td className="p-3">{invoice.customer_name}<div className="text-xs text-slate-400">{invoice.customer_phone}</div></td>
                        <td className="p-3">{invoice.due_date ? invoice.due_date.slice(0, 10) : '-'}</td>
                        <td className="p-3 text-right font-black">{money(invoice.total_amount)}</td>
                        <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black capitalize">{invoice.status}</span></td>
                        <td className="p-3 text-right"><button onClick={() => sendInvoice(invoice)} className="rounded-lg bg-[#171d27] px-3 py-2 text-xs font-black text-white">Send</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Section>
            </main>
            <aside className="xl:sticky xl:top-6 xl:self-start">
              <InvoicePreview profile={profile} draft={draft} />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
