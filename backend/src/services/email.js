const axios = require('axios');
const nodemailer = require('nodemailer');

function isEmailConfigured() {
  return Boolean(
    (process.env.RESEND_API_KEY &&
      (process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL)) ||
    (process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      (process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL))
  );
}

function emailEnabled(client) {
  return client.email_enabled === true ||
    client.email_enabled === 'true' ||
    client.installation_email_enabled === true ||
    client.installation_email_enabled === 'true';
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
    client.email_from_name ||
      process.env.EMAIL_FROM_NAME ||
      process.env.SMTP_FROM_NAME ||
      client.business_name ||
      client.name ||
      'Support'
  ).trim();
  const address = String(
    client.email_from_address ||
      process.env.EMAIL_FROM_ADDRESS ||
      process.env.SMTP_FROM_EMAIL ||
      ''
  ).trim();
  const replyTo = String(client.email_reply_to || address).trim();
  return { company, address, replyTo, from: `${company} <${address}>` };
}

function clientSmtpConfigured(client = {}) {
  return Boolean(
    client.email_enabled &&
    client.email_smtp_host &&
    client.email_smtp_port &&
    client.email_smtp_username &&
    client.email_smtp_password &&
    client.email_from_address
  );
}

function serverSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    (process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM_EMAIL)
  );
}

function smtpTransportConfig(client = null) {
  if (clientSmtpConfigured(client)) {
    return {
      host: client.email_smtp_host,
      port: Number(client.email_smtp_port),
      secure: client.email_smtp_secure !== false && client.email_smtp_secure !== 'false',
      auth: {
        user: client.email_smtp_username,
        pass: client.email_smtp_password,
      },
    };
  }

  if (serverSmtpConfigured()) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    };
  }

  return null;
}

async function sendViaSmtp(client, payload) {
  const config = smtpTransportConfig(client);
  if (!config) return { status: 'failed', error: 'SMTP is not configured' };
  try {
    const transporter = nodemailer.createTransport(config);
    const info = await transporter.sendMail({
      from: payload.from,
      to: Array.isArray(payload.to) ? payload.to.join(',') : payload.to,
      replyTo: payload.reply_to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    return { status: 'sent', error: null, id: info.messageId || null };
  } catch (err) {
    return { status: 'failed', error: err.message || 'SMTP email sending failed' };
  }
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

async function sendEmail(client, payload) {
  if (clientSmtpConfigured(client) || serverSmtpConfigured()) {
    return sendViaSmtp(client, payload);
  }
  return sendViaResend(payload);
}

async function testEmailConfig(config, recipient) {
  const company = config.email_from_name || 'Nexa';
  const address = config.email_from_address;
  const replyTo = config.email_reply_to || address;
  return sendViaSmtp(config, {
    from: `${company} <${address}>`,
    to: [recipient],
    reply_to: replyTo,
    subject: 'Nexa email configuration test',
    text: 'Your Nexa email configuration is working.',
    html: '<div style="font-family:Arial,sans-serif;color:#172033"><h2>Nexa email configuration test</h2><p>Your email configuration is working.</p></div>',
  });
}

async function sendInstallationRequestEmail(client, details) {
  if (!emailEnabled(client) || !details.email) return { status: 'skipped', error: null };

  const { company, replyTo, from } = emailBrand(client);
  const firstName = String(details.name || '').trim().split(/\s+/)[0] || 'there';
  const signoff = client.agent_name || `${company} Support`;

  return sendEmail(client, {
    from,
    to: [details.email],
    reply_to: replyTo,
    subject: `Installation Request Received — ${company}`,
    text: `Hello ${firstName},\n\nThank you for requesting a ${company} internet installation.\n\nYour request details:\nPackage: ${details.plan}\nLocation: ${details.location}\n\nOur team has received your request and will contact you shortly to coordinate the installation visit.\n\nRegards,\n${signoff}\n${company}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172033;line-height:1.6"><h2 style="color:#203fcd">Installation Request Received</h2><p>Hello ${escapeHtml(firstName)},</p><p>Thank you for requesting a <strong>${escapeHtml(company)}</strong> internet installation.</p><div style="background:#f3f6ff;border-radius:14px;padding:16px;margin:18px 0"><strong>Your request details</strong><p style="margin:8px 0 0">Package: ${escapeHtml(details.plan)}<br>Location: ${escapeHtml(details.location)}</p></div><p>Our team has received your request and will contact you shortly to coordinate the installation visit.</p><p>Regards,<br><strong>${escapeHtml(signoff)}</strong><br>${escapeHtml(company)}</p></div>`,
  });
}

async function sendInstallationConfirmedEmail(client, details) {
  if (!emailEnabled(client) || !details.email) return { status: 'skipped', error: null };

  const { company, replyTo, from } = emailBrand(client);
  const firstName = String(details.name || '').trim().split(/\s+/)[0] || 'there';
  const signoff = client.agent_name || `${company} Support`;

  return sendEmail(client, {
    from,
    to: [details.email],
    reply_to: replyTo,
    subject: `Your Installation Has Been Confirmed — ${company}`,
    text: `Hello ${firstName},\n\nYour internet installation request with ${company} has been confirmed. Our team will contact you shortly to coordinate the visit.\n\nRegards,\n${signoff}\n${company}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#172033;line-height:1.6"><h2 style="color:#203fcd">Installation Confirmed</h2><p>Hello ${escapeHtml(firstName)},</p><p>Your internet installation request with <strong>${escapeHtml(company)}</strong> has been confirmed.</p><p>Our team will contact you shortly to coordinate the visit.</p><p>Regards,<br><strong>${escapeHtml(signoff)}</strong><br>${escapeHtml(company)}</p></div>`,
  });
}

async function sendHighPriorityTicketEmail(client, ticket) {
  if (!client.contact_email) return { status: 'skipped', error: 'Client contact email is not set' };
  if (!isEmailConfigured()) return { status: 'skipped', error: 'Email provider is not configured on the server' };

  const { company, replyTo, from } = emailBrand(client);
  const link = String(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const ticketUrl = link ? `${link}/dashboard/tickets?ticket=${ticket.id}` : null;
  const subject = `High Priority Ticket #${ticket.id} - ${company}`;
  const summary = ticket.summary || ticket.last_message || 'No summary yet';

  return sendEmail(client, {
    from,
    to: [client.contact_email],
    reply_to: replyTo,
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

async function sendWorkflowEmployeeEmail(client, employee, details) {
  if (!employee?.email) return { status: 'skipped', error: 'Assigned employee has no email address' };
  if (!isEmailConfigured()) return { status: 'skipped', error: 'Email provider is not configured on the server' };

  const { company, replyTo, from } = emailBrand(client);
  const subject = details.subject || `New workflow alert - ${company}`;
  const body = details.message || 'A customer needs attention.';

  return sendEmail(client, {
    from,
    to: [employee.email],
    reply_to: replyTo,
    subject,
    text: body,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:620px;color:#172033;line-height:1.6">` +
      `<h2 style="color:#203fcd">${escapeHtml(subject)}</h2>` +
      `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px">${escapeHtml(body)}</pre>` +
      `</div>`,
  });
}

module.exports = {
  sendInstallationRequestEmail,
  sendInstallationConfirmedEmail,
  sendHighPriorityTicketEmail,
  sendWorkflowEmployeeEmail,
  isEmailConfigured,
  testEmailConfig,
};
