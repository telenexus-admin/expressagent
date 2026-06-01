function cleanPublicBase() {
  return String(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function buildCustomerIntakeUrl(client, { phone, name } = {}) {
  const base = cleanPublicBase();
  if (!base || !client?.id) return '';
  const params = new URLSearchParams();
  if (phone) params.set('phone', String(phone).replace(/^\+/, ''));
  if (name) params.set('name', String(name).trim());
  const query = params.toString();
  return `${base}/customer-intake/${client.id}${query ? `?${query}` : ''}`;
}

module.exports = {
  buildCustomerIntakeUrl,
};
