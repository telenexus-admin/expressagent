const nodemailer = require('nodemailer');

let transporter;

function isEmailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function senderFor(client) {
  const name = (client.business_name || client.name || process.env.SMTP_FROM_NAME || 'Support').trim();
  const address = (client.support_email || process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '').trim();
  return { name, address };
}

async function sendInstallationRequestEmail(client, details) {
  if (!client.installation_email_enabled || !details.email) {
    return { status: 'skipped', error: null };
  }
  const mailer = getTransporter();
  if (!mailer) return { status: 'failed', error: 'SMTP is not configured on the server' };

  const company = client.business_name || client.name || 'our team';
  const firstName = String(details.name || '').trim().split(/\s+/)[0] || 'there';
  const from = senderFor(client);
  try {
    await mailer.sendMail({
      from,
      to: details.email,
      replyTo: client.support_email || process.env.SMTP_USER,
      subject: `Installation Request Received — ${company}`,
      text: `Hello ${firstName},\n\nThank you for requesting an ${company} internet installation.\n\nYour request details:\nPackage: ${details.plan}\nLocation: ${details.location}\n\nOur team has received your request and will contact you shortly to coordinate the installation visit.\n\nRegards,\n${client.agent_name || company + ' Support'}\n${company}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172033;line-height:1.6"><h2 style="color:#203fcd">Installation Request Received</h2><p>Hello ${escapeHtml(firstName)},</p><p>Thank you for requesting an <strong>${escapeHtml(company)}</strong> internet installation.</p><div style="background:#f3f6ff;border-radius:14px;padding:16px;margin:18px 0"><strong>Your request details</strong><p style="margin:8px 0 0">Package: ${escapeHtml(details.plan)}<br>Location: ${escapeHtml(details.location)}</p></div><p>Our team has received your request and will contact you shortly to coordinate the installation visit.</p><p>Regards,<br><strong>${escapeHtml(client.agent_name || company + ' Support')}</strong><br>${escapeHtml(company)}</p></div>`,
    });
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'Email sending failed' };
  }
}

async function sendInstallationConfirmedEmail(client, details) {
  if (!client.installation_email_enabled || !details.email) {
    return { status: 'skipped', error: null };
  }
  const mailer = getTransporter();
  if (!mailer) return { status: 'failed', error: 'SMTP is not configured on the server' };

  const company = client.business_name || client.name || 'our team';
  const firstName = String(details.name || '').trim().split(/\s+/)[0] || 'there';
  const from = senderFor(client);
  try {
    await mailer.sendMail({
      from,
      to: details.email,
      replyTo: client.support_email || process.env.SMTP_USER,
      subject: `Your Installation Has Been Confirmed — ${company}`,
      text: `Hello ${firstName},\n\nYour internet installation request with ${company} has been confirmed. Our team will contact you shortly to coordinate the visit.\n\nRegards,\n${client.agent_name || company + ' Support'}\n${company}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172033;line-height:1.6"><h2 style="color:#203fcd">Installation Confirmed</h2><p>Hello ${escapeHtml(firstName)},</p><p>Your internet installation request with <strong>${escapeHtml(company)}</strong> has been confirmed.</p><p>Our team will contact you shortly to coordinate the visit.</p><p>Regards,<br><strong>${escapeHtml(client.agent_name || company + ' Support')}</strong><br>${escapeHtml(company)}</p></div>`,
    });
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'Email sending failed' };
  }
}

module.exports = {
  sendInstallationRequestEmail,
  sendInstallationConfirmedEmail,
  isEmailConfigured,
};
