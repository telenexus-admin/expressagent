const apiRoot = '/api/billing-workspace';
const cash = (value) => `KSh ${Number(value || 0).toLocaleString()}`;
const authHeaders = () => {
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function shell(content) {
  const host = document.createElement('div');
  host.className = 'billing-crm-overlay';
  host.innerHTML = `<div class="billing-crm-backdrop"></div><section class="billing-crm-panel">${content}</section>`;
  host.querySelector('.billing-crm-backdrop').onclick = () => host.remove();
  document.body.appendChild(host);
  return host;
}

function escape(value) { return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function openCrm(accountNumber) {
  const host = shell('<div class="billing-crm-loading">Loading client profile…</div>');
  try {
    const response = await fetch(`${apiRoot}/subscribers/crm?account_number=${encodeURIComponent(accountNumber)}`, { credentials: 'include', headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load this client');
    const s = data.subscriber;
    const paymentRows = data.payments.length ? data.payments.map((p) => `<li><b>${cash(p.amount)}</b><span>${escape(p.method || 'Payment')} · ${escape(p.reference || 'No reference')}</span></li>`).join('') : '<li class="billing-crm-empty">No payments recorded.</li>';
    const invoiceRows = data.invoices.length ? data.invoices.map((i) => `<li><b>${escape(i.invoice_number)}</b><span>${cash(i.amount)} · ${escape(i.status)}</span></li>`).join('') : '<li class="billing-crm-empty">No invoices issued.</li>';
    const ticketRows = data.tickets.length ? data.tickets.map((t) => `<li><b>#${t.id} · ${escape(t.title)}</b><span>${escape(t.status)} · ${escape(t.category)}</span></li>`).join('') : '<li class="billing-crm-empty">No tickets linked to this phone number.</li>';
    host.querySelector('.billing-crm-panel').innerHTML = `<button class="billing-crm-close" aria-label="Close">×</button><div class="billing-crm-kicker">Client CRM</div><h2>${escape(s.full_name)}</h2><p class="billing-crm-subtitle">${escape(s.account_number)} · ${escape(s.phone || 'No phone saved')}</p><div class="billing-crm-status">${escape(s.service_status)} · ${escape(s.plan_name || 'No package')}</div><div class="billing-crm-sections"><section><h3>Payment history</h3><ul>${paymentRows}</ul></section><section><h3>Invoices</h3><ul>${invoiceRows}</ul></section><section><h3>Support tickets</h3><ul>${ticketRows}</ul></section></div>`;
    host.querySelector('.billing-crm-close').onclick = () => host.remove();
  } catch (error) { host.querySelector('.billing-crm-panel').innerHTML = `<button class="billing-crm-close" aria-label="Close">×</button><p class="billing-crm-empty">${escape(error.message)}</p>`; host.querySelector('.billing-crm-close').onclick = () => host.remove(); }
}

function openAdd() {
  const host = shell(`<button class="billing-crm-close" aria-label="Close">×</button><div class="billing-crm-kicker">Subscribers</div><h2>Add client</h2><form class="billing-add-form"><input name="full_name" required placeholder="Full name"><input name="account_number" required placeholder="Account number"><input name="phone" placeholder="Phone number"><input name="email" type="email" placeholder="Email (optional)"><button>Add client</button></form>`);
  host.querySelector('.billing-crm-close').onclick = () => host.remove();
  const formElement = host.querySelector('form');
  const submitButton = formElement.querySelector('button');
  const packageSelect = document.createElement('select');
  packageSelect.name = 'plan_id';
  packageSelect.innerHTML = '<option value="">Package (select later)</option>';
  const graceInput = document.createElement('input');
  graceInput.name = 'grace_period_days';
  graceInput.type = 'number';
  graceInput.min = '0';
  graceInput.max = '90';
  graceInput.value = '0';
  graceInput.placeholder = 'Grace period (days)';
  formElement.insertBefore(packageSelect, submitButton);
  formElement.insertBefore(graceInput, submitButton);
  fetch(`${apiRoot}/plans`, { credentials: 'include', headers: authHeaders() })
    .then((response) => response.ok ? response.json() : [])
    .then((plans) => plans.forEach((plan) => {
      const option = document.createElement('option');
      option.value = plan.id;
      option.textContent = `${plan.name} · ${cash(plan.price)}`;
      packageSelect.appendChild(option);
    }))
    .catch(() => {});
  host.querySelector('form').onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const body = Object.fromEntries(form.entries()); body.plan_id = body.plan_id || null; body.email = body.email || null; body.phone = body.phone || null; body.grace_period_days = Number(body.grace_period_days || 0); const button = event.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Adding…'; const response = await fetch(`${apiRoot}/subscribers`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (response.ok) { host.remove(); window.location.reload(); } else { button.disabled = false; button.textContent = 'Add client'; let message = host.querySelector('.billing-add-error'); if (!message) { message = document.createElement('p'); message.className = 'billing-add-error'; message.style.cssText = 'color:#dc2626;font-size:12px;margin:4px 0'; event.currentTarget.insertBefore(message, button); } message.textContent = data.error || data.errors?.[0]?.msg || 'Could not add this client.'; } };
}

export function mountSubscriberCrm() {
  const style = document.createElement('style');
  style.textContent = '@media(max-width:767px){.min-h-screen>div>header>div:last-child{display:flex!important}}';
  document.head.appendChild(style);
  const tidySubscriberList = () => {
    document.querySelectorAll('p').forEach((node) => {
      if (node.textContent.trim() === 'Every customer belongs only to this billing account.') node.remove();
    });
  };
  new MutationObserver(tidySubscriberList).observe(document.body, { childList: true, subtree: true });
  tidySubscriberList();
  // BillingWorkspace now owns all add buttons, package/voucher/router dialogs,
  // and subscriber profile navigation. Do not install a document-level capture
  // listener here: it used to classify every button beginning with "+" as an
  // Add client action and cancelled the intended React handler.
}
