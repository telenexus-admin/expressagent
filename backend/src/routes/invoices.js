const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { sendWhatsAppButtons, sendWhatsAppMediaMessage } = require('../services/whatsapp');
const { sendClientButtons, sendClientMedia } = require('../services/clientEvolution');
const { lookupInvoiceCustomer } = require('../services/billing');
const { startInvoicePaymentPrompt } = require('../services/payhero');
const { sendEmail, isEmailConfigured } = require('../services/email');

const router = express.Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '';
const DEFAULT_INVOICE_TEMPLATE = 'classic_red';
const INVOICE_TEMPLATES = new Set([DEFAULT_INVOICE_TEMPLATE, 'modern_blue_orange']);

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

function cleanInvoiceTemplate(value) {
  const key = String(value || '').trim();
  return INVOICE_TEMPLATES.has(key) ? key : DEFAULT_INVOICE_TEMPLATE;
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
          template_key VARCHAR(40) NOT NULL DEFAULT 'classic_red',
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
      await db.query(`ALTER TABLE invoice_profiles ADD COLUMN IF NOT EXISTS template_key VARCHAR(40) NOT NULL DEFAULT 'classic_red'`);
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
            c.evolution_instance_name,
            c.email_provider, c.email_enabled, c.email_from_name, c.email_from_address, c.email_reply_to,
            c.email_smtp_host, c.email_smtp_port, c.email_smtp_secure, c.email_smtp_username, c.email_smtp_password
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
    `Your PDF invoice ${invoice.invoice_number} for ${Number(invoice.total_amount).toFixed(2)} is ready.`,
    invoice.due_date ? `Due date: ${new Date(invoice.due_date).toISOString().slice(0, 10)}` : '',
    'Thank you.',
  ].filter(Boolean).join('\n');
}

function pdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function pdfMoney(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function invoicePdfBufferClassic({ invoice, profile }) {
  const company = profile.company_name || invoice.business_name || invoice.client_name || 'Company';
  const lines = [
    { x: 52, y: 745, size: 22, text: company, color: 'white' },
    { x: 408, y: 745, size: 12, text: profile.phone || '', color: 'white' },
    { x: 408, y: 725, size: 12, text: profile.email || '', color: 'white' },
    { x: 52, y: 655, size: 12, text: 'INVOICE TO', color: 'red' },
    { x: 52, y: 630, size: 18, text: invoice.customer_name, color: 'black' },
    { x: 52, y: 608, size: 10, text: `Phone: ${invoice.customer_phone || '-'}`, color: 'gray' },
    { x: 52, y: 592, size: 10, text: `Email: ${invoice.customer_email || '-'}`, color: 'gray' },
    { x: 358, y: 655, size: 30, text: 'INVOICE', color: 'black' },
    { x: 358, y: 620, size: 10, text: `Invoice No: ${invoice.invoice_number}`, color: 'black' },
    { x: 358, y: 604, size: 10, text: `Issue Date: ${new Date(invoice.issue_date).toISOString().slice(0, 10)}`, color: 'black' },
    { x: 358, y: 588, size: 10, text: `Due Date: ${invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : '-'}`, color: 'black' },
    { x: 358, y: 560, size: 11, text: 'Payment Method', color: 'red' },
    { x: 358, y: 542, size: 10, text: `Method: ${profile.payment_method || '-'}`, color: 'black' },
    { x: 358, y: 526, size: 10, text: `Account: ${profile.account_number || '-'}`, color: 'black' },
    { x: 358, y: 510, size: 10, text: `Name: ${profile.account_name || '-'}`, color: 'black' },
  ];
  let y = 452;
  (invoice.items || []).slice(0, 12).forEach((item, index) => {
    lines.push(
      { x: 58, y, size: 9, text: String(index + 1).padStart(2, '0'), color: 'black' },
      { x: 98, y, size: 9, text: item.description, color: 'black' },
      { x: 330, y, size: 9, text: pdfMoney(item.unit_price), color: 'black' },
      { x: 420, y, size: 9, text: Number(item.quantity).toFixed(2), color: 'black' },
      { x: 485, y, size: 9, text: pdfMoney(item.line_total), color: 'black' }
    );
    y -= 28;
  });
  lines.push(
    { x: 52, y: 185, size: 12, text: 'Thank you for your business with us.', color: 'black' },
    { x: 52, y: 160, size: 10, text: profile.terms || invoice.notes || 'Payment is due by the invoice due date.', color: 'gray' },
    { x: 52, y: 100, size: 10, text: profile.signature_name || 'Authorized Signature', color: 'black' },
    { x: 380, y: 190, size: 10, text: `Subtotal: ${pdfMoney(invoice.subtotal)}`, color: 'black' },
    { x: 380, y: 168, size: 10, text: `Discount: ${pdfMoney(invoice.discount_amount)}`, color: 'black' },
    { x: 380, y: 146, size: 10, text: `Tax: ${pdfMoney(invoice.tax_amount)}`, color: 'black' },
    { x: 380, y: 112, size: 15, text: `Total: ${pdfMoney(invoice.total_amount)}`, color: 'white' }
  );
  const color = (name) => {
    if (name === 'red') return '0.89 0.05 0.16 rg';
    if (name === 'white') return '1 1 1 rg';
    if (name === 'gray') return '0.36 0.40 0.45 rg';
    return '0.08 0.10 0.15 rg';
  };
  const textOps = lines.map((line) => `BT /F1 ${line.size} Tf ${color(line.color)} ${line.x} ${line.y} Td (${pdfText(line.text).slice(0, 92)}) Tj ET`).join('\n');
  const stream = [
    '0.09 0.11 0.16 rg 40 705 310 78 re f',
    '0.89 0.05 0.16 rg 350 705 205 78 re f',
    '0.89 0.05 0.16 rg 52 468 503 28 re f',
    'BT /F1 9 Tf 1 1 1 rg 58 477 Td (NO.) Tj ET',
    'BT /F1 9 Tf 1 1 1 rg 98 477 Td (ITEM DESCRIPTION) Tj ET',
    'BT /F1 9 Tf 1 1 1 rg 330 477 Td (PRICE) Tj ET',
    'BT /F1 9 Tf 1 1 1 rg 420 477 Td (QTY.) Tj ET',
    'BT /F1 9 Tf 1 1 1 rg 485 477 Td (TOTAL) Tj ET',
    '0.89 0.05 0.16 rg 370 96 185 38 re f',
    '0.09 0.11 0.16 rg 220 35 335 28 re f',
    textOps,
  ].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function invoicePdfBufferModern({ invoice, profile }) {
  const company = profile.company_name || invoice.business_name || invoice.client_name || 'Company';
  const issueDate = new Date(invoice.issue_date).toISOString().slice(0, 10);
  const dueDate = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : '-';
  const navy = '0.06 0.13 0.38 rg';
  const orange = '1 0.60 0.02 rg';
  const black = '0.04 0.05 0.12 rg';
  const gray = '0.35 0.39 0.49 rg';
  const light = '0.93 0.92 0.94 rg';
  const white = '1 1 1 rg';
  const lines = [
    { x: 54, y: 745, size: 42, text: 'INVOICE', color: white },
    { x: 56, y: 717, size: 18, text: company, color: white },
    { x: 56, y: 678, size: 10, text: `INVOICE NO: ${invoice.invoice_number}`, color: white },
    { x: 56, y: 662, size: 10, text: issueDate, color: white },
    { x: 365, y: 686, size: 11, text: 'Invoice to:', color: black },
    { x: 365, y: 658, size: 24, text: invoice.customer_name, color: black },
    { x: 365, y: 638, size: 10, text: invoice.customer_email || invoice.customer_phone || '-', color: black },
    { x: 365, y: 622, size: 10, text: invoice.customer_address || '-', color: black },
    { x: 62, y: 255, size: 14, text: 'PAYMENT DETAILS:', color: black },
    { x: 62, y: 224, size: 11, text: profile.payment_method || 'Payment method', color: black },
    { x: 62, y: 208, size: 10, text: profile.account_number || '-', color: black },
    { x: 62, y: 184, size: 11, text: profile.account_name || 'Account name', color: black },
    { x: 62, y: 168, size: 10, text: profile.branch_name || '-', color: black },
    { x: 62, y: 116, size: 14, text: 'CONTACT US', color: black },
    { x: 62, y: 88, size: 10, text: profile.phone || '-', color: black },
    { x: 62, y: 70, size: 10, text: profile.website || profile.email || '-', color: black },
    { x: 62, y: 52, size: 10, text: profile.address || '-', color: black },
    { x: 370, y: 102, size: 26, text: 'Thank You!', color: black },
    { x: 390, y: 52, size: 10, text: profile.signature_name || 'Administrator', color: black },
  ];
  const colorOp = (value) => value;
  const textOps = lines.map((line) => `BT /F1 ${line.size} Tf ${colorOp(line.color)} ${line.x} ${line.y} Td (${pdfText(line.text).slice(0, 88)}) Tj ET`).join('\n');
  const rowOps = [];
  let y = 500;
  (invoice.items || []).slice(0, 8).forEach((item, index) => {
    if (index % 2 === 1) rowOps.push(`${light} 32 ${y - 14} 530 36 re f`);
    rowOps.push(
      `BT /F1 10 Tf ${black} 62 ${y} Td (${pdfText(item.description).slice(0, 42)}) Tj ET`,
      `BT /F1 10 Tf ${black} 270 ${y} Td (${Number(item.quantity).toFixed(2)}) Tj ET`,
      `BT /F1 10 Tf ${black} 350 ${y} Td (${pdfText(pdfMoney(item.unit_price))}) Tj ET`,
      `BT /F1 10 Tf ${black} 465 ${y} Td (${pdfText(pdfMoney(item.line_total))}) Tj ET`
    );
    y -= 36;
  });
  const stream = [
    `${navy} 0 790 595 52 re f`,
    `${navy} 0 620 335 170 re f`,
    `${white} 0 620 m 335 620 l 595 718 l 595 790 l 335 790 l h f`,
    `${orange} 318 690 m 595 750 l 595 720 l 330 660 l h f`,
    `${orange} 0 640 m 36 632 l 20 724 l 0 720 l h f`,
    `${navy} 32 526 530 42 re f`,
    `BT /F1 11 Tf ${white} 62 551 Td (Description) Tj ET`,
    `BT /F1 11 Tf ${white} 270 551 Td (Qty) Tj ET`,
    `BT /F1 11 Tf ${white} 350 551 Td (Cost) Tj ET`,
    `BT /F1 11 Tf ${white} 465 551 Td (Subtotal) Tj ET`,
    ...rowOps,
    `BT /F1 11 Tf ${black} 350 250 Td (Subtotal) Tj ET`,
    `BT /F1 11 Tf ${black} 455 250 Td (${pdfText(pdfMoney(invoice.subtotal))}) Tj ET`,
    `${light} 332 210 230 36 re f`,
    `BT /F1 11 Tf ${black} 350 224 Td (Tax) Tj ET`,
    `BT /F1 11 Tf ${black} 455 224 Td (${pdfText(pdfMoney(invoice.tax_amount))}) Tj ET`,
    `${navy} 332 170 230 40 re f`,
    `BT /F1 12 Tf ${white} 350 186 Td (TOTAL) Tj ET`,
    `BT /F1 12 Tf ${white} 455 186 Td (${pdfText(pdfMoney(invoice.total_amount))}) Tj ET`,
    `${orange} 360 0 m 595 50 l 595 0 l h f`,
    `${navy} 410 0 m 595 38 l 595 0 l h f`,
    textOps,
  ].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function invoicePdfBuffer({ invoice, profile }) {
  if (cleanInvoiceTemplate(profile.template_key) === 'modern_blue_orange') {
    return invoicePdfBufferModern({ invoice, profile });
  }
  return invoicePdfBufferClassic({ invoice, profile });
}

async function loadInvoiceDocument(invoice) {
  const items = invoice.items || (await db.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id ASC`, [invoice.id])).rows;
  const profileResult = await db.query(`SELECT * FROM invoice_profiles WHERE client_id = $1`, [invoice.client_id]);
  const fullInvoice = { ...invoice, items };
  const profile = invoiceProfileForRender(profileResult.rows[0] || {});
  const pdf = invoicePdfBuffer({ invoice: fullInvoice, profile });
  return {
    data: pdf,
    mime_type: 'application/pdf',
    filename: `${invoice.invoice_number}.pdf`,
    title: `Invoice ${invoice.invoice_number}`,
    description: invoiceMessage(invoice, invoice.public_url || ''),
  };
}

async function sendInvoiceNotice(client, phone, message, invoice = null) {
  const media = invoice ? await loadInvoiceDocument({ ...client, ...invoice }) : null;
  if (client.evolution_instance_name) {
    if (media) await sendClientMedia(client, phone, { ...media, description: message });
    return;
  }
  if (!client.meta_phone_number_id || !client.meta_access_token) {
    throw new Error('WhatsApp credentials are not configured for this client');
  }
  if (media) await sendWhatsAppMediaMessage(client.meta_phone_number_id, client.meta_access_token, phone, { ...media, description: message });
}

async function sendInvoicePaymentButtons(client, phone, invoice) {
  try {
    const title = 'Invoice payment';
    const description = `Invoice ${invoice.invoice_number}: choose what you want to do next.`;
    const buttons = [
      { id: 'invoice_pay_now', title: 'Pay Now' },
      { id: 'invoice_pay_later', title: 'Pay Later' },
    ];
    if (client.evolution_instance_name) {
      await sendClientButtons(client, phone, { title, description, footer: '', buttons });
      return;
    }
    if (!client.meta_phone_number_id || !client.meta_access_token) return;
    await sendWhatsAppButtons(client.meta_phone_number_id, client.meta_access_token, phone, description, buttons, '');
  } catch (err) {
    console.error(`Invoice payment buttons failed for invoice ${invoice.invoice_number}:`, err.response?.data || err.message);
  }
}

async function sendInvoiceEmail(invoice, email, url) {
  const recipient = cleanText(email || invoice.customer_email, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    const error = new Error('A valid customer email is required');
    error.statusCode = 400;
    throw error;
  }
  if (!isEmailConfigured(invoice) && !process.env.RESEND_API_KEY) {
    const error = new Error('Email delivery is not configured for this account');
    error.statusCode = 400;
    throw error;
  }

  const company = invoice.business_name || invoice.client_name || 'Support';
  const fromAddress = cleanText(invoice.email_from_address || process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    const error = new Error('A valid From email address is required before sending invoices by email');
    error.statusCode = 400;
    throw error;
  }
  const fromName = cleanText(invoice.email_from_name || process.env.EMAIL_FROM_NAME || process.env.SMTP_FROM_NAME || company, 160);
  const message = invoiceMessage(invoice, url);
  const result = await sendEmail(invoice, {
    from: `${fromName} <${fromAddress}>`,
    to: [recipient],
    reply_to: invoice.email_reply_to || fromAddress,
    subject: `Invoice ${invoice.invoice_number} from ${company}`,
    text: `${message}\n\nOpen invoice: ${url}`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:620px;color:#172033;line-height:1.6">` +
      `<h2 style="color:#172b72;margin-bottom:8px">Invoice ${esc(invoice.invoice_number)}</h2>` +
      `<p>Hello ${esc(invoice.customer_name)},</p>` +
      `<p>Your PDF invoice for <strong>${esc(pdfMoney(invoice.total_amount))}</strong> is ready.</p>` +
      (invoice.due_date ? `<p><strong>Due date:</strong> ${esc(new Date(invoice.due_date).toISOString().slice(0, 10))}</p>` : '') +
      `<p><a href="${esc(url)}" style="display:inline-block;background:#3535ff;color:#fff;text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:800">View invoice</a></p>` +
      `<p style="color:#64748b">Thank you.</p>` +
      `</div>`,
  });

  if (result.status === 'failed') {
    const error = new Error(result.error || 'Email delivery failed');
    error.statusCode = 502;
    throw error;
  }
  return result;
}

function invoiceProfileResponse(row = {}) {
  const { logo_data, signature_data, ...safe } = row;
  return {
    ...safe,
    template_key: cleanInvoiceTemplate(row.template_key),
    logo_data_url: dataUrl(logo_data, row.logo_mime_type),
    signature_data_url: dataUrl(signature_data, row.signature_mime_type),
  };
}

function invoiceProfileForRender(row = {}) {
  return {
    ...row,
    template_key: cleanInvoiceTemplate(row.template_key),
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

function renderPublicInvoiceModern({ invoice, profile }) {
  const company = profile.company_name || invoice.business_name || invoice.client_name || 'Company';
  const items = invoice.items || [];
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(invoice.invoice_number)} Invoice</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef2f8;font-family:Inter,Arial,sans-serif;color:#080b1f}.page{position:relative;max-width:900px;margin:28px auto;background:#fff;box-shadow:0 26px 70px rgba(15,23,42,.16);overflow:hidden}.hero{position:relative;min-height:280px;padding:58px 58px 0}.navy{position:absolute;left:0;top:0;width:60%;height:230px;background:#172b72;clip-path:polygon(0 0,100% 0,86% 100%,7% 100%)}.orange{position:absolute;right:0;top:82px;width:44%;height:44px;background:#ff9f05;transform:skewY(-13deg)}.brand{position:relative;color:#fff}.logo{height:44px;max-width:180px;object-fit:contain;margin-bottom:12px}.invoice-word{font-size:64px;line-height:.9;font-weight:950;letter-spacing:.02em}.company{font-size:22px}.invoice-meta{margin-top:30px;font-size:14px;letter-spacing:.18em}.billto{position:absolute;right:54px;top:165px;width:310px;text-align:center}.billto-label{font-weight:900}.billto-name{font-size:34px;font-weight:950}.billto-small{font-size:14px;line-height:1.55}.main{padding:28px 46px 50px}.table{width:100%;border-collapse:collapse;margin-top:10px}.table th{background:#172b72;color:#fff;text-align:left;padding:18px 22px;font-size:15px}.table th:not(:first-child),.table td:not(:first-child){text-align:center}.table td{padding:16px 22px;font-size:15px}.table tbody tr:nth-child(even){background:#e7e5ea}.lower{display:grid;grid-template-columns:1fr 360px;gap:40px;margin-top:58px}.section-title{font-size:22px;font-weight:950;margin-bottom:24px}.payment strong,.contact strong{display:block;margin-top:18px}.totals{font-size:17px}.totals-row{display:grid;grid-template-columns:1fr 1fr;padding:18px 28px}.totals-row:nth-child(2){background:#e7e5ea}.totals-row.total{background:#172b72;color:#fff;font-weight:950}.thanks{margin-top:48px;text-align:center;font-size:36px;font-weight:950}.signature{margin-top:34px;text-align:center}.signature img{max-height:58px;max-width:220px;object-fit:contain}.sig-text{margin:auto;width:230px;border-top:2px solid #172b72;padding-top:8px}.bottom-navy{position:absolute;right:-20px;bottom:0;width:46%;height:58px;background:#172b72;transform:skewY(-13deg);transform-origin:right bottom}.bottom-orange{position:absolute;left:310px;bottom:10px;width:170px;height:28px;background:#ff9f05;transform:skewY(-13deg)}@media(max-width:760px){.hero{padding:38px 24px 0}.navy{width:100%;height:245px}.orange{top:210px;width:65%}.invoice-word{font-size:46px}.billto{position:relative;right:auto;top:auto;width:auto;margin-top:70px;text-align:left}.main{padding:22px}.lower{grid-template-columns:1fr}.table th,.table td{padding:12px 8px;font-size:12px}}
</style></head><body>
<div class="page">
  <div class="navy"></div><div class="orange"></div>
  <section class="hero"><div class="brand">${profile.logo_url ? `<img class="logo" src="${esc(profile.logo_url)}">` : ''}<div class="invoice-word">INVOICE</div><div class="company">${esc(company)}</div><div class="invoice-meta">INVOICE NO: ${esc(invoice.invoice_number)}<br>${esc(new Date(invoice.issue_date).toISOString().slice(0,10))}</div></div><div class="billto"><div class="billto-label">Invoice to:</div><div class="billto-name">${esc(invoice.customer_name)}</div><div class="billto-small">${esc(invoice.customer_email || invoice.customer_phone || '-')}<br>${esc(invoice.customer_address || '-')}</div></div></section>
  <main class="main">
    <table class="table"><thead><tr><th>Description</th><th>Qty</th><th>Cost</th><th>Subtotal</th></tr></thead><tbody>${items.map((item) => `<tr><td>${esc(item.description)}</td><td>${Number(item.quantity).toFixed(2)}</td><td>${Number(item.unit_price).toFixed(2)}</td><td>${Number(item.line_total).toFixed(2)}</td></tr>`).join('')}</tbody></table>
    <div class="lower"><section><div class="section-title">PAYMENT DETAILS:</div><div class="payment"><strong>${esc(profile.payment_method || 'Payment method')}</strong>${esc(profile.account_number || '-')}<strong>${esc(profile.account_name || 'Account name')}</strong>${esc(profile.branch_name || '-')}</div><div class="section-title" style="margin-top:54px">CONTACT US</div><div class="contact">${esc(profile.phone || '-')}<br>${esc(profile.website || profile.email || '-')}<br>${esc(profile.address || '-')}</div></section><section><div class="totals"><div class="totals-row"><strong>Subtotal</strong><span>${Number(invoice.subtotal).toFixed(2)}</span></div><div class="totals-row"><strong>Tax</strong><span>${Number(invoice.tax_amount).toFixed(2)}</span></div><div class="totals-row total"><strong>TOTAL</strong><span>${Number(invoice.total_amount).toFixed(2)}</span></div></div><div class="thanks">Thank You!</div><div class="signature">${profile.signature_image_url ? `<img src="${esc(profile.signature_image_url)}">` : ''}<div class="sig-text">${esc(profile.signature_name || 'Administrator')}</div></div></section></div>
  </main><div class="bottom-orange"></div><div class="bottom-navy"></div>
</div></body></html>`;
}

function renderPublicInvoice({ invoice, profile }) {
  if (cleanInvoiceTemplate(profile.template_key) === 'modern_blue_orange') {
    return renderPublicInvoiceModern({ invoice, profile });
  }
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
    const fields = ['company_name', 'template_key', 'phone', 'email', 'address', 'website', 'payment_method', 'account_name', 'account_number', 'branch_name', 'signature_name', 'signature_title', 'terms'];
    const values = fields.map((field) => (field === 'template_key' ? cleanInvoiceTemplate(req.body[field]) : cleanText(req.body[field], field.includes('url') ? 1000 : 500)));
    const logoDataParam = fields.length + 2;
    const logoMimeParam = fields.length + 3;
    const signatureDataParam = fields.length + 4;
    const signatureMimeParam = fields.length + 5;
    const logoSql = logo.data ? `, logo_data = $${logoDataParam}, logo_mime_type = $${logoMimeParam}` : '';
    const signatureSql = signature.data ? `, signature_data = $${signatureDataParam}, signature_mime_type = $${signatureMimeParam}` : '';
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

router.delete('/products/:id', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    await ensureInvoiceSchema();
    const result = await db.query(
      `UPDATE invoice_products SET is_active = FALSE, updated_at = NOW()
       WHERE client_id = $1 AND id = $2 RETURNING *`,
      [clientId, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error('DELETE /invoices/products/:id error:', err.message);
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
    const channel = ['whatsapp', 'email'].includes(req.body.channel) ? req.body.channel : 'whatsapp';
    const url = invoiceUrl(invoice.public_token, req);
    let sentTo;
    if (channel === 'email') {
      const result = await sendInvoiceEmail(invoice, req.body.email, url);
      sentTo = cleanText(req.body.email || invoice.customer_email, 180);
      if (result.status !== 'sent') throw new Error(result.error || 'Email delivery failed');
    } else {
      const phone = cleanPhone(req.body.phone || invoice.customer_phone);
      if (!/^[0-9]{9,15}$/.test(phone)) return res.status(400).json({ error: 'A valid WhatsApp number is required' });
      await sendInvoiceNotice(invoice, phone, invoiceMessage(invoice, url), { ...invoice, public_url: url });
      await sendInvoicePaymentButtons(invoice, phone, invoice);
      sentTo = phone;
    }
    await db.query(`UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [invoice.id]);
    res.json({ success: true, channel, sent_to: sentTo, public_url: url });
  } catch (err) {
    console.error('POST /invoices/:id/send error:', err.response?.data || err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Invoice could not be sent' });
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
        await sendInvoiceNotice(invoice, phone, invoiceMessage(invoice, url), { ...invoice, public_url: url });
        await sendInvoicePaymentButtons(invoice, phone, invoice);
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
  await sendInvoiceNotice({ ...client, ...invoice }, phone, invoiceMessage(invoice, url), { ...invoice, public_url: url });
  await sendInvoicePaymentButtons(client, phone, invoice);
  return {
    success: true,
    invoice,
    public_url: url,
    reply: '',
  };
};

router.startLatestInvoicePayment = async function startLatestInvoicePayment({ client, conversationId, customerPhone }) {
  await ensureInvoiceSchema();
  const phone = cleanPhone(customerPhone);
  const result = await db.query(
    `SELECT * FROM invoices
     WHERE client_id = $1 AND customer_phone = $2 AND status IN ('draft', 'sent', 'overdue')
     ORDER BY created_at DESC
     LIMIT 1`,
    [client.id, phone]
  );
  const invoice = result.rows[0];
  if (!invoice) return 'I could not find a recent unpaid invoice for this chat. Please ask for an invoice first.';
  return startInvoicePaymentPrompt({
    conversationId,
    amount: Math.round(Number(invoice.total_amount || 0)),
    invoiceNumber: invoice.invoice_number,
    customerName: invoice.customer_name,
  });
};

module.exports = router;
