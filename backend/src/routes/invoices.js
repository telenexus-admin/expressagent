const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { sendClientText } = require('../services/clientEvolution');
const { lookupInvoiceCustomer } = require('../services/billing');

const router = express.Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '';

let schemaReady;

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number * 100) / 100);
}

function cleanPhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function cleanDataUri(value, allowed = /^image\/(png|jpe?g|webp)$/i) {
  const raw = String(value || '').trim();
  if (!raw) return { data: null, mime: null };
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match || !allowed.test(match[1])) return { data: null, mime: null };
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Uploaded image must be 2 MB or smaller');
  return { data: buffer, mime: match[1].toLowerCase() };
}

function dataUrl(data, mimeType) {
  if (!data || !mimeType) return '';
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function resolveTargetClient(req, res) {
  if (req.scope.clientId) return req.scope.clientId;
  res.status(400).json({ error: 'Select a client before managing invoices' });
  return null;
}

async function ensureInvoiceSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS invoice_profiles (
          client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
          company_name VARCHAR(180),
          logo_url TEXT,
          logo_mime_type VARCHAR(100),
          logo_data BYTEA,
          phone VARCHAR(80),
          email VARCHAR(180),
          address TEXT,
          website VARCHAR(180),
          payment_method VARCHAR(120),
          account_name VARCHAR(160),
          account_number VARCHAR(120),
          branch_name VARCHAR(120),
          signature_name VARCHAR(160),
          signature_title VARCHAR(120),
          signature_image_url TEXT,
          signature_mime_type VARCHAR(100),
          signature_data BYTEA,
          terms TEXT,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS invoice_products (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          name VARCHAR(180) NOT NULL,
          description TEXT,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS invoices (
          id SERIAL PRIMARY KEY,
          client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          invoice_number VARCHAR(40) NOT NULL,
          customer_name VARCHAR(180) NOT NULL,
          customer_phone VARCHAR(80),
          customer_email VARCHAR(180),
          customer_address TEXT,
          issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
          due_date DATE,
          status VARCHAR(20) NOT NULL DEFAULT 'draft',
          subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
          discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          notes TEXT,
          public_token VARCHAR(80) UNIQUE NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE (client_id, invoice_number),
          CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled'))
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
          id SERIAL PRIMARY KEY,
          invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES invoice_products(id) ON DELETE SET NULL,
          description TEXT NOT NULL,
          quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
          line_total NUMERIC(12,2) NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_invoice_products_client ON invoice_products(client_id, is_active, name);
        CREATE INDEX IF NOT EXISTS idx_invoices_client_due ON invoices(client_id, status, due_date DESC);
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
      `);
      await db.query(`ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS logo_mime_type VARCHAR(100)`);
      await db.query(`ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS logo_data BYTEA`);
      await db.query(`ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS signature_mime_type VARCHAR(100)`);
      await db.query(`ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS signature_data BYTEA`);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function nextInvoiceNumber(clientId) {
  const prefix = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const result = await db.query(
    `SELECT invoice_number FROM invoices
     WHERE client_id = $1 AND invoice_number LIKE $2
     ORDER BY id DESC LIMIT 1`,
    [clientId, `${prefix}-%`]
  );
  const last = result.rows[0]?.invoice_number || '';
  const lastCount = Number.parseInt(last.split('-').pop(), 10) || 0;
  return `${prefix}-${String(lastCount + 1).padStart(4, '0')}`;
}

function calculateItems(items = [], discountAmount = 0) {
  const cleanItems = items.map((item) => {
    const quantity = Math.max(0.01, Number(item.quantity || 1));
    const unitPrice = money(item.unit_price);
    const taxRate = Math.max(0, Number(item.tax_rate || 0));
    const base = money(quantity * unitPrice);
    return {
      product_id: item.product_id || null,
      description: cleanText(item.description || item.name, 300),
      quantity,
      unit_price: unitPrice,
      tax_rate: taxRate,
      line_total: base,
    };
  }).filter((item) => item.description && item.line_total >= 0);

  const subtotal = money(cleanItems.reduce((sum, item) => sum + item.line_total, 0));
  const discount = Math.min(money(discountAmount), subtotal);
  const taxAmount = money(cleanItems.reduce((sum, item) => sum + (item.line_total * item.tax_rate / 100), 0));
  const total = money(subtotal - discount + taxAmount);
  return { items: cleanItems, subtotal, discount, taxAmount, total };
}

async function loadInvoice(clientId, invoiceId) {
  const invoice = await db.query(
    `SELECT i.*, c.business_name, c.name AS client_name, c.meta_phone_number_id, c.meta_access_token,
            c.evolution_instance_name
     FROM invoices i
     JOIN clients c ON c.id = i.client_id
     WHERE i.client_id = $1 AND i.id = $2`,
    [clientId, invoiceId]
  );
  if (!invoice.rows[0]) return null;
  const items = await db.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`, [invoiceId]);
  return { ...invoice.rows[0], items: items.rows };
}

function invoiceUrl(token, req = null) {
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (base) return `${base}/api/public/invoices/${token}`;
  if (req) {
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0];
    return `${proto}://${req.get('host')}/api/public/invoices/${token}`;
  }
  return `/api/public/invoices/${token}`;
}

function invoiceMessage(invoice, url) {
  return [
    `Hello ${invoice.customer_name},`,
    `Your invoice ${invoice.invoice_number} for ${Number(invoice.total_amount).toFixed(2)} is ready.`,
    invoice.due_date ? `Due date: ${new Date(invoice.due_date).toISOString().slice(0, 10)}` : '',
    `View invoice: ${url}`,
    'Thank you.',
  ].filter(Boolean).join('\n');
}

async function sendInvoiceNotice(client, phone, message) {
  if (client.evolution_instance_name) {
    await sendClientText(client, phone, message);
    return;
  }
  if (!client.meta_phone_number_id || !client.meta_access_token) {
    throw new Error('WhatsApp credentials are not configured for this client');
  }
  await sendWhatsAppMessage(client.meta_phone_number_id, client.meta_access_token, phone, message);
}

function invoiceProfileResponse(row = {}) {
  const { logo_data, signature_data, ...safe } = row;
  return {
    ...safe,
    logo_data_url: dataUrl(logo_data, row.logo_mime_type),
    signature_data_url: dataUrl(signature_data, row.signature_mime_type),
  };
}

function invoiceProfileForRender(row = {}) {
  return {
    ...row,
    logo_url: dataUrl(row.logo_data, row.logo_mime_type) || row.logo_url || '',
    signature_image_url: dataUrl(row.signature_data, row.signature_mime_type) || row.signature_image_url || '',
  };
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function renderPublicInvoice({ invoice, profile }) {
  const company = profile.company_name || invoice.business_name || invoice.client_name || 'Company';
  const items = invoice.items || [];
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(invoice.invoice_number)} Invoice</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef0f4;font-family:Inter,Arial,sans-serif;color:#1f2430}.page{max-width:940px;margin:28px auto;background:#fff;box-shadow:0 28px 70px rgba(15,23,42,.18);overflow:hidden}.top{display:grid;grid-template-columns:1.2fr 1fr;min-height:135px}.brand{background:#161d28;color:#fff;padding:38px 48px;position:relative}.brand:after{content:"";position:absolute;right:-70px;top:0;width:180px;height:140px;background:#e90d2d;border-bottom-left-radius:90px}.logo{height:58px;max-width:210px;object-fit:contain;display:block;margin-bottom:12px}.company{font-size:28px;font-weight:900;letter-spacing:.02em}.tag{font-size:12px;color:#cbd5e1;margin-top:4px}.contact{background:#e90d2d;color:#fff;padding:28px 42px;font-size:13px;line-height:1.8}.main{padding:42px 50px}.grid{display:grid;grid-template-columns:1fr 300px;gap:42px}.muted{color:#6b7280}.red{color:#e90d2d}.h1{font-size:44px;font-weight:900;letter-spacing:.02em;margin:0 0 18px}.box-title{font-size:13px;font-weight:900;text-transform:uppercase;color:#e90d2d;margin-bottom:8px}.customer{font-size:24px;font-weight:900;margin:0 0 10px}.meta{font-size:14px;line-height:1.9}.table{width:100%;border-collapse:separate;border-spacing:0;margin-top:36px;border:1px solid #edf0f5;border-radius:14px;overflow:hidden}.table th{background:#e90d2d;color:#fff;text-align:left;font-size:12px;text-transform:uppercase;padding:16px}.table td{border-top:1px solid #edf0f5;padding:16px;font-size:14px}.table th:nth-child(n+3),.table td:nth-child(n+3){text-align:right}.footer{display:grid;grid-template-columns:1fr 310px;gap:40px;margin-top:30px}.totals{border:1px solid #edf0f5;border-radius:14px;overflow:hidden}.totals div{display:flex;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #edf0f5;font-size:14px}.totals div:last-child{border:0;background:#e90d2d;color:#fff;font-weight:900;font-size:18px}.thanks{font-weight:900;margin-bottom:18px}.terms{font-size:13px;line-height:1.7;color:#5b6472}.signature{margin-top:34px}.signature img{max-height:58px;max-width:210px;object-fit:contain}.sigline{width:220px;border-top:1px solid #cbd5e1;padding-top:8px;text-align:center;font-size:12px;font-weight:800}.bottom{height:42px;background:linear-gradient(90deg,#e90d2d 0 38%,#161d28 38%)}@media(max-width:760px){.top,.grid,.footer{grid-template-columns:1fr}.main{padding:30px 22px}.brand,.contact{padding:28px 24px}.h1{font-size:34px}.table{font-size:12px}.table th,.table td{padding:12px 9px}}
</style></head><body>
<div class="page">
  <div class="top"><div class="brand">${profile.logo_url ? `<img class="logo" src="${esc(profile.logo_url)}">` : ''}<div class="company">${esc(company)}</div><div class="tag">Professional Invoice</div></div><div class="contact">${esc(profile.phone || '')}<br>${esc(profile.email || '')}<br>${esc(profile.address || '')}</div></div>
  <main class="main">
    <div class="grid"><section><div class="box-title">Invoice To</div><h2 class="customer">${esc(invoice.customer_name)}</h2><div class="meta muted">Phone: ${esc(invoice.customer_phone || '-')}<br>Email: ${esc(invoice.customer_email || '-')}<br>Address: ${esc(invoice.customer_address || '-')}</div></section><section><h1 class="h1">INVOICE</h1><div class="meta">Invoice No: <strong>${esc(invoice.invoice_number)}</strong><br>Issue Date: ${esc(new Date(invoice.issue_date).toISOString().slice(0,10))}<br>Due Date: ${invoice.due_date ? esc(new Date(invoice.due_date).toISOString().slice(0,10)) : '-'}</div><div class="box-title" style="margin-top:22px">Payment Method</div><div class="meta">Method: ${esc(profile.payment_method || '-')}<br>Account: ${esc(profile.account_number || '-')}<br>Name: ${esc(profile.account_name || '-')}<br>Branch: ${esc(profile.branch_name || '-')}</div></section></div>
    <table class="table"><thead><tr><th>No.</th><th>Item Description</th><th>Price</th><th>Qty.</th><th>Total</th></tr></thead><tbody>${items.map((item, index) => `<tr><td>${String(index + 1).padStart(2,'0')}</td><td>${esc(item.description)}</td><td>${Number(item.unit_price).toFixed(2)}</td><td>${Number(item.quantity).toFixed(2)}</td><td>${Number(item.line_total).toFixed(2)}</td></tr>`).join('')}</tbody></table>
    <div class="footer"><section><div class="thanks">Thank you for your business with us.</div><div class="box-title">Terms & Conditions</div><div class="terms">${esc(profile.terms || invoice.notes || 'Payment is due by the invoice due date. Please contact us if you have any questions.').replace(/\n/g,'<br>')}</div><div class="signature">${profile.signature_image_url ? `<img src="${esc(profile.signature_image_url)}">` : ''}<div class="sigline">${esc(profile.signature_name || 'Authorized Signature')}<br><span class="muted">${esc(profile.signature_title || '')}</span></div></div></section><section class="totals"><div><span>Subtotal</span><strong>${Number(invoice.subtotal).toFixed(2)}</strong></div><div><span>Discount</span><strong>${Number(invoice.discount_amount).toFixed(2)}</strong></div><div><span>Tax</span><strong>${Number(invoice.tax_amount).toFixed(2)}</strong></div><div><span>Total</span><strong>${Number(invoice.total_amount).toFixed(2)}</strong></div></section></div>
  </main><div class="bottom"></div>
</div></body></html>`;
}

router.use(authMiddleware, scopeMiddleware);

router.get('/profile', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const result = await db.query(`SELECT * FROM invoice_profiles WHERE client_id = $1`, [clientId]);
    res.json(invoiceProfileResponse(result.rows[0] || {}));
  } catch (err) {
    console.error('GET /invoices/profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/profile', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const logo = cleanDataUri(req.body.logo_data_url);
    const signature = cleanDataUri(req.body.signature_data_url);
    const fields = ['company_name', 'phone', 'email', 'address', 'website', 'payment_method', 'account_name', 'account_number', 'branch_name', 'signature_name', 'signature_title', 'terms'];
    const values = fields.map((field) => cleanText(req.body[field], field.includes('url') ? 1000 : 500));
    const logoSql = logo.data ? ', logo_data = $14, logo_mime_type = $15' : '';
    const signatureSql = signature.data ? ', signature_data = $16, signature_mime_type = $17' : '';
    const insertFields = ['client_id', ...fields, 'logo_data', 'logo_mime_type', 'signature_data', 'signature_mime_type'];
    const insertValues = [
      clientId,
      ...values,
      logo.data || null,
      logo.mime || null,
      signature.data || null,
      signature.mime || null,
    ];
    const result = await db.query(
      `INSERT INTO invoice_profiles (${insertFields.join(', ')})
       VALUES (${insertFields.map((_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (client_id) DO UPDATE SET
         ${fields.map((field, index) => `${field} = $${index + 2}`).join(', ')}
         ${logoSql}
         ${signatureSql},
         updated_at = NOW()
       RETURNING *`,
      insertValues
    );
    res.json(invoiceProfileResponse(result.rows[0]));
  } catch (err) {
    console.error('PUT /invoices/profile error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/lookup-customer', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const result = await lookupInvoiceCustomer({ clientId, query: req.query.q });
    if (!result.success) return res.status(404).json({ error: result.error || 'Customer not found' });
    res.json(result.customer);
  } catch (err) {
    console.error('GET /invoices/lookup-customer error:', err.message);
    res.status(500).json({ error: 'Customer lookup failed' });
  }
});

router.get('/products', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const result = await db.query(`SELECT * FROM invoice_products WHERE client_id = $1 ORDER BY is_active DESC, name ASC`, [clientId]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /invoices/products error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/products', [
  body('name').trim().notEmpty().withMessage('Product name is required'),
], async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await ensureInvoiceSchema();
    const result = await db.query(
      `INSERT INTO invoice_products (client_id, name, description, unit_price, tax_rate)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [clientId, cleanText(req.body.name, 180), cleanText(req.body.description, 500), money(req.body.unit_price), money(req.body.tax_rate)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /invoices/products error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/products/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const result = await db.query(
      `UPDATE invoice_products SET name = $1, description = $2, unit_price = $3, tax_rate = $4, is_active = $5, updated_at = NOW()
       WHERE client_id = $6 AND id = $7 RETURNING *`,
      [cleanText(req.body.name, 180), cleanText(req.body.description, 500), money(req.body.unit_price), money(req.body.tax_rate), req.body.is_active !== false, clientId, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /invoices/products/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const status = cleanText(req.query.status, 20);
    const dueOnly = req.query.due === 'true';
    const params = [clientId];
    const where = ['client_id = $1'];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (dueOnly) where.push(`status IN ('draft', 'sent', 'overdue') AND due_date <= CURRENT_DATE`);
    const result = await db.query(
      `SELECT * FROM invoices WHERE ${where.join(' AND ')} ORDER BY due_date ASC NULLS LAST, created_at DESC LIMIT 120`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /invoices error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', [
  body('customer_name').trim().notEmpty().withMessage('Customer name is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one invoice item is required'),
], async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const client = await db.connect();
  try {
    await ensureInvoiceSchema();
    const calculated = calculateItems(req.body.items, req.body.discount_amount);
    if (!calculated.items.length) return res.status(400).json({ error: 'Add at least one valid invoice item' });
    await client.query('BEGIN');
    const invoiceNumber = cleanText(req.body.invoice_number, 40) || await nextInvoiceNumber(clientId);
    const invoice = await client.query(
      `INSERT INTO invoices (
         client_id, invoice_number, customer_name, customer_phone, customer_email, customer_address,
         issue_date, due_date, status, subtotal, discount_amount, tax_amount, total_amount, notes, public_token
       ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8::date,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        clientId,
        invoiceNumber,
        cleanText(req.body.customer_name, 180),
        cleanPhone(req.body.customer_phone),
        cleanText(req.body.customer_email, 180),
        cleanText(req.body.customer_address, 500),
        req.body.issue_date || null,
        req.body.due_date || null,
        ['draft', 'sent', 'paid', 'overdue', 'cancelled'].includes(req.body.status) ? req.body.status : 'draft',
        calculated.subtotal,
        calculated.discount,
        calculated.taxAmount,
        calculated.total,
        cleanText(req.body.notes, 1000),
        crypto.randomBytes(24).toString('hex'),
      ]
    );
    for (const item of calculated.items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [invoice.rows[0].id, item.product_id, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(await loadInvoice(clientId, invoice.rows[0].id));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /invoices error:', err.message);
    res.status(500).json({ error: err.code === '23505' ? 'Invoice number already exists' : 'Server error' });
  } finally {
    client.release();
  }
});

async function createInvoiceFromBillingCustomer({ clientId, customer, status = 'draft' }) {
  const calculated = calculateItems([{
    description: customer.plan ? `${customer.plan} internet package` : 'Internet service package',
    quantity: 1,
    unit_price: customer.price || 0,
    tax_rate: 0,
  }], 0);
  if (!calculated.items.length || calculated.total <= 0) {
    throw new Error('Could not create invoice because billing did not return a package price');
  }
  const invoiceNumber = await nextInvoiceNumber(clientId);
  const dueDate = customer.expiry ? String(customer.expiry).slice(0, 10) : null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const invoice = await client.query(
      `INSERT INTO invoices (
         client_id, invoice_number, customer_name, customer_phone, customer_email, customer_address,
         issue_date, due_date, status, subtotal, discount_amount, tax_amount, total_amount, notes, public_token
       ) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7::date,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        clientId,
        invoiceNumber,
        cleanText(customer.name || customer.account || 'Customer', 180),
        cleanPhone(customer.phone),
        cleanText(customer.email, 180),
        cleanText(customer.address, 500),
        dueDate,
        status,
        calculated.subtotal,
        calculated.discount,
        calculated.taxAmount,
        calculated.total,
        cleanText(`Autogenerated from billing system. Account: ${customer.account || '-'}. Expiry: ${customer.expiry || '-'}.`, 1000),
        crypto.randomBytes(24).toString('hex'),
      ]
    );
    for (const item of calculated.items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [invoice.rows[0].id, item.product_id, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total]
      );
    }
    await client.query('COMMIT');
    return loadInvoice(clientId, invoice.rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

router.post('/autofill', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const lookup = await lookupInvoiceCustomer({ clientId, query: req.body.query || req.body.customer_name || req.body.phone });
    if (!lookup.success) return res.status(404).json({ error: lookup.error || 'Customer not found' });
    const customer = lookup.customer;
    res.json({
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      customer_address: customer.address,
      due_date: customer.expiry ? String(customer.expiry).slice(0, 10) : '',
      notes: `Autofilled from billing. Account: ${customer.account || '-'}, status: ${customer.status || '-'}.`,
      items: [{
        description: customer.plan ? `${customer.plan} internet package` : 'Internet service package',
        quantity: 1,
        unit_price: customer.price || 0,
        tax_rate: 0,
      }],
      billing_customer: customer,
    });
  } catch (err) {
    console.error('POST /invoices/autofill error:', err.message);
    res.status(500).json({ error: 'Could not autofill invoice from billing' });
  }
});

router.get('/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const invoice = await loadInvoice(clientId, req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ ...invoice, public_url: invoiceUrl(invoice.public_token, req) });
  } catch (err) {
    console.error('GET /invoices/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/send', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const invoice = await loadInvoice(clientId, req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const phone = cleanPhone(req.body.phone || invoice.customer_phone);
    if (!/^[0-9]{9,15}$/.test(phone)) return res.status(400).json({ error: 'A valid WhatsApp number is required' });
    const url = invoiceUrl(invoice.public_token, req);
    await sendInvoiceNotice(invoice, phone, invoiceMessage(invoice, url));
    await db.query(`UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [invoice.id]);
    res.json({ success: true, sent_to: phone, public_url: url });
  } catch (err) {
    console.error('POST /invoices/:id/send error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Invoice could not be sent' });
  }
});

router.post('/send-due/bulk', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const due = await db.query(
      `SELECT i.*, c.meta_phone_number_id, c.meta_access_token
              , c.evolution_instance_name
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.client_id = $1 AND i.status IN ('draft', 'sent', 'overdue') AND i.due_date <= CURRENT_DATE
       ORDER BY i.due_date ASC LIMIT 50`,
      [clientId]
    );
    const results = [];
    for (const invoice of due.rows) {
      const phone = cleanPhone(invoice.customer_phone);
      if (!/^[0-9]{9,15}$/.test(phone)) {
        results.push({ id: invoice.id, status: 'skipped', error: 'Invalid phone' });
        continue;
      }
      try {
        const url = invoiceUrl(invoice.public_token, req);
        await sendInvoiceNotice(invoice, phone, invoiceMessage(invoice, url));
        await db.query(`UPDATE invoices SET status = 'overdue', sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [invoice.id]);
        results.push({ id: invoice.id, status: 'sent', phone });
      } catch (err) {
        results.push({ id: invoice.id, status: 'failed', error: err.message });
      }
    }
    res.json({ success: true, total: results.length, results });
  } catch (err) {
    console.error('POST /invoices/send-due/bulk error:', err.message);
    res.status(500).json({ error: 'Due invoices could not be sent' });
  }
});

router.publicInvoiceHandler = async (req, res) => {
  try {
    await ensureInvoiceSchema();
    const invoiceResult = await db.query(
      `SELECT i.*, c.business_name, c.name AS client_name
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.public_token = $1`,
      [req.params.token]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) return res.status(404).send('Invoice not found');
    const items = await db.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`, [invoice.id]);
    const profile = await db.query(`SELECT * FROM invoice_profiles WHERE client_id = $1`, [invoice.client_id]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPublicInvoice({ invoice: { ...invoice, items: items.rows }, profile: invoiceProfileForRender(profile.rows[0] || {}) }));
  } catch (err) {
    console.error('GET /public/invoices/:token error:', err.message);
    res.status(500).send('Invoice unavailable');
  }
};

router.createAndSendCustomerInvoice = async function createAndSendCustomerInvoice({ client, customerPhone, customerName, messageText, req = null }) {
  await ensureInvoiceSchema();
  const lookup = await lookupInvoiceCustomer({
    clientId: client.id,
    query: messageText || customerPhone || customerName,
    customerPhone,
  });
  if (!lookup.success) {
    return {
      success: false,
      reply: 'I could not find your billing account yet. Please send your registered phone number, account number, or username so I can generate the invoice.',
    };
  }
  const invoice = await createInvoiceFromBillingCustomer({ clientId: client.id, customer: lookup.customer, status: 'sent' });
  const url = invoiceUrl(invoice.public_token, req);
  const phone = cleanPhone(customerPhone || lookup.customer.phone);
  if (!/^[0-9]{9,15}$/.test(phone)) {
    return { success: false, reply: 'I found the account, but I need a valid WhatsApp number before sending the invoice.' };
  }
  await sendInvoiceNotice({ ...client, ...invoice }, phone, invoiceMessage(invoice, url));
  return {
    success: true,
    invoice,
    public_url: url,
    reply: `I have generated invoice ${invoice.invoice_number} and sent it here. You can also view it here: ${url}`,
  };
};

module.exports = router;
