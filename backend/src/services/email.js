const axios = require('axios');

function isEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
    (process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL)
  );
}

function emailEnabled(client) {
  return client.installation_email_enabled === true || client.installation_email_enabled === 'true';
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
  if (!emailEnabled(client) || !details.email) return { status: 'skipped', error: null };

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
  if (!emailEnabled(client) || !details.email) return { status: 'skipped', error: null };

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

async function sendHighPriorityTicketEmail(client, ticket) {
  if (!client.contact_email) return { status: 'skipped', error: 'Client contact email is not set' };
  if (!isEmailConfigured()) return { status: 'skipped', error: 'Email provider is not configured on the server' };

  const { company, address, from } = emailBrand(client);
  const link = String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const ticketUrl = link ? `${link}/dashboard/tickets?ticket=${ticket.id}` : null;
  const subject = `High Priority Ticket #${ticket.id} - ${company}`;
  const summary = ticket.summary || ticket.last_message || 'No summary yet';

  return sendViaResend({
    from,
    to: [client.contact_email],
    reply_to: address,
    subject,
    text:
      `A high priority support ticket has been created for ${company}.\n\n` +
      `Ticket #${ticket.id}: ${ticket.title}\n` +
      `Priority: ${ticket.priority}\n` +
      `Customer: ${ticket.customer_name || 'Unknown'} (+${ticket.customer_phone})\n` +
      `Issue: ${summary}` +
      (ticketUrl ? `\n\nOpen ticket: ${ticketUrl}` : ''),
    html:
      `<div style="font-family:Arial,sans-serif;max-width:620px;color:#172033;line-height:1.6">` +
      `<h2 style="color:#b42318">High Priority Ticket Created</h2>` +
      `<p>A high priority support ticket has been created for <strong>${escapeHtml(company)}</strong>.</p>` +
      `<div style="background:#fff4ed;border:1px solid #fed7aa;border-radius:14px;padding:16px;margin:18px 0">` +
      `<strong>Ticket #${ticket.id}: ${escapeHtml(ticket.title)}</strong>` +
      `<p style="margin:8px 0 0">Priority: ${escapeHtml(ticket.priority)}<br>` +
      `Customer: ${escapeHtml(ticket.customer_name || 'Unknown')} (+${escapeHtml(ticket.customer_phone)})<br>` +
      `Issue: ${escapeHtml(summary)}</p>` +
      `</div>` +
      (ticketUrl ? `<p><a href="${escapeHtml(ticketUrl)}" style="color:#203fcd;font-weight:bold">Open ticket</a></p>` : '') +
      `</div>`,
  });
}

module.exports = {
  sendInstallationRequestEmail,
  sendInstallationConfirmedEmail,
  sendHighPriorityTicketEmail,
  isEmailConfigured,
};
