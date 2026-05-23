const axios = require('axios');

function isEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
    (process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL)
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailBrand(client) {
  const company = String(
    process.env.EMAIL_FROM_NAME ||
      process.env.SMTP_FROM_NAME ||
      client.business_name ||
      client.name ||
      'Support'
  ).trim();
  const address = String(
    process.env.EMAIL_FROM_ADDRESS ||
      process.env.SMTP_FROM_EMAIL ||
      ''
  ).trim();
  return { company, address, from: `${company} <${address}>` };
}

async function sendViaResend(payload) {
  if (!isEmailConfigured()) {
    return { status: 'failed', error: 'RESEND_API_KEY or EMAIL_FROM_ADDRESS is not configured on the server' };
  }

  try {
    const response = await axios.post('https://api.resend.com/emails', payload, {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });
    return { status: 'sent', error: null, id: response.data?.id || null };
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message || 'Email sending failed';
    return { status: 'failed', error: detail };
  }
}

async function sendInstallationRequestEmail(client, details) {
  if (!details.email) return { status: 'skipped', error: null };

  const { company, address, from } = emailBrand(client);
  const firstName = String(details.name || '').trim().split(/\s+/)[0] || 'there';
  const signoff = client.agent_name || `${company} Support`;

  return sendViaResend({
    from,
    to: [details.email],
    reply_to: address,
    subject: `Installation Request Received — ${company}`,
    text: `Hello ${firstName},\n\nThank you for requesting a ${company} internet installation.\n\nYour request details:\nPackage: ${details.plan}\nLocation: ${details.location}\n\nOur team has received your request and will contact you shortly to coordinate the installation visit.\n\nRegards,\n${signoff}\n${company}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172033;line-height:1.6"><h2 style="color:#203fcd">Installation Request Received</h2><p>Hello ${escapeHtml(firstName)},</p><p>Thank you for requesting a <strong>${escapeHtml(company)}</strong> internet installation.</p><div style="background:#f3f6ff;border-radius:14px;padding:16px;margin:18px 0"><strong>Your request details</strong><p style="margin:8px 0 0">Package: ${escapeHtml(details.plan)}<br>Location: ${escapeHtml(details.location)}</p></div><p>Our team has received your request and will contact you shortly to coordinate the installation visit.</p><p>Regards,<br><strong>${escapeHtml(signoff)}</strong><br>${escapeHtml(company)}</p></div>`,
  });
}

async function sendInstallationConfirmedEmail(client, details) {
  if (!details.email) return { status: 'skipped', error: null };

  const { company, address, from } = emailBrand(client);
  const firstName = String(details.name || '').trim().split(/\s+/)[0] || 'there';
  const signoff = client.agent_name || `${company} Support`;

  return sendViaResend({
    from,
    to: [details.email],
    reply_to: address,
    subject: `Your Installation Has Been Confirmed — ${company}`,
    text: `Hello ${firstName},\n\nYour internet installation request with ${company} has been confirmed. Our team will contact you shortly to coordinate the visit.\n\nRegards,\n${signoff}\n${company}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172033;line-height:1.6"><h2 style="color:#203fcd">Installation Confirmed</h2><p>Hello ${escapeHtml(firstName)},</p><p>Your internet installation request with <strong>${escapeHtml(company)}</strong> has been confirmed.</p><p>Our team will contact you shortly to coordinate the visit.</p><p>Regards,<br><strong>${escapeHtml(signoff)}</strong><br>${escapeHtml(company)}</p></div>`,
  });
}

module.exports = {
  sendInstallationRequestEmail,
  sendInstallationConfirmedEmail,
  isEmailConfigured,
};
