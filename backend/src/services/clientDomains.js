const axios = require('axios');
const db = require('../db');

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

function clean(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function normalizeSlug(value) {
  return clean(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 63);
}

function maskSecret(value) {
  const text = clean(value, 500);
  if (!text) return '';
  if (text.length <= 10) return 'configured';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function publicDomainSettings(row) {
  return {
    cloudflare_zone_id: row.cloudflare_zone_id || '',
    cloudflare_api_token_masked: maskSecret(row.cloudflare_api_token),
    root_domain: row.root_domain || '',
    target_domain: row.target_domain || '',
    proxied: row.proxied !== false,
    configured: Boolean(row.cloudflare_zone_id && row.cloudflare_api_token && row.root_domain && row.target_domain),
    updated_at: row.updated_at || null,
  };
}

async function ensureClientDomainSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS operator_domain_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      cloudflare_zone_id TEXT,
      cloudflare_api_token TEXT,
      root_domain VARCHAR(255),
      target_domain VARCHAR(255),
      proxied BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    INSERT INTO operator_domain_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS client_domains (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      domain VARCHAR(255) NOT NULL UNIQUE,
      slug VARCHAR(120) NOT NULL,
      domain_type VARCHAR(30) NOT NULL DEFAULT 'subdomain',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      dns_record_id VARCHAR(120),
      dns_record_type VARCHAR(20) NOT NULL DEFAULT 'CNAME',
      dns_target VARCHAR(255),
      proxied BOOLEAN NOT NULL DEFAULT TRUE,
      ssl_status VARCHAR(30) NOT NULL DEFAULT 'cloudflare',
      last_checked_at TIMESTAMP WITH TIME ZONE,
      error TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_client_domains_client ON client_domains(client_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_domains_primary_subdomain ON client_domains(client_id, domain_type) WHERE domain_type = 'subdomain';
  `);
}

async function getDomainSettings({ includeSecret = false } = {}) {
  await ensureClientDomainSchema();
  const result = await db.query(`SELECT * FROM operator_domain_settings WHERE id = 1 LIMIT 1`);
  const row = result.rows[0] || {};
  return includeSecret ? row : publicDomainSettings(row);
}

async function saveDomainSettings(payload = {}) {
  await ensureClientDomainSchema();
  const current = await getDomainSettings({ includeSecret: true });
  const apiToken = clean(payload.cloudflare_api_token, 1000) || current.cloudflare_api_token || null;
  const zoneId = clean(payload.cloudflare_zone_id, 255) || null;
  const rootDomain = clean(payload.root_domain, 255).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  const targetDomain = clean(payload.target_domain, 255).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  const proxied = payload.proxied !== false;
  const updated = await db.query(
    `UPDATE operator_domain_settings
     SET cloudflare_zone_id = $1,
         cloudflare_api_token = $2,
         root_domain = $3,
         target_domain = $4,
         proxied = $5,
         updated_at = NOW()
     WHERE id = 1
     RETURNING *`,
    [zoneId, apiToken, rootDomain, targetDomain, proxied]
  );
  return publicDomainSettings(updated.rows[0]);
}

function requireConfigured(settings) {
  if (!settings.cloudflare_zone_id || !settings.cloudflare_api_token || !settings.root_domain || !settings.target_domain) {
    const error = new Error('Cloudflare domain automation is not configured');
    error.statusCode = 400;
    throw error;
  }
}

function cloudflareClient(settings) {
  return axios.create({
    baseURL: `${CLOUDFLARE_API}/zones/${encodeURIComponent(settings.cloudflare_zone_id)}`,
    timeout: 25000,
    headers: {
      Authorization: `Bearer ${settings.cloudflare_api_token}`,
      'Content-Type': 'application/json',
    },
  });
}

async function findCloudflareRecord(settings, fqdn) {
  const cf = cloudflareClient(settings);
  const response = await cf.get('/dns_records', { params: { name: fqdn, type: 'CNAME', per_page: 1 } });
  if (!response.data?.success) throw new Error(response.data?.errors?.[0]?.message || 'Cloudflare lookup failed');
  return response.data.result?.[0] || null;
}

async function upsertCloudflareRecord(settings, fqdn) {
  const cf = cloudflareClient(settings);
  const existing = await findCloudflareRecord(settings, fqdn);
  const payload = {
    type: 'CNAME',
    name: fqdn,
    content: settings.target_domain,
    proxied: settings.proxied !== false,
    ttl: 1,
    comment: 'Managed by Nexa automatic client onboarding',
  };
  const response = existing
    ? await cf.put(`/dns_records/${encodeURIComponent(existing.id)}`, payload)
    : await cf.post('/dns_records', payload);
  if (!response.data?.success) {
    throw new Error(response.data?.errors?.map((item) => item.message).join(', ') || 'Cloudflare DNS record creation failed');
  }
  return response.data.result;
}

async function createClientSubdomain(client, preferredSlug = '') {
  await ensureClientDomainSchema();
  const settings = await getDomainSettings({ includeSecret: true });
  requireConfigured(settings);
  const baseSlug = normalizeSlug(preferredSlug || client.business_name || client.name || `client-${client.id}`);
  if (!baseSlug) {
    const error = new Error('Enter a valid domain slug');
    error.statusCode = 400;
    throw error;
  }
  let slug = baseSlug;
  let fqdn = `${slug}.${settings.root_domain}`;
  for (let i = 2; i < 20; i += 1) {
    const existing = await db.query(`SELECT id FROM client_domains WHERE LOWER(domain) = LOWER($1) AND client_id <> $2 LIMIT 1`, [fqdn, client.id]);
    if (!existing.rows[0]) break;
    slug = `${baseSlug}-${i}`;
    fqdn = `${slug}.${settings.root_domain}`;
  }

  const record = await upsertCloudflareRecord(settings, fqdn);
  const result = await db.query(
    `INSERT INTO client_domains
       (client_id, domain, slug, domain_type, status, dns_record_id, dns_record_type, dns_target, proxied, ssl_status, last_checked_at, error, metadata)
     VALUES ($1, $2, $3, 'subdomain', 'active', $4, 'CNAME', $5, $6, 'cloudflare', NOW(), NULL, $7::jsonb)
     ON CONFLICT (domain) DO UPDATE
       SET client_id = EXCLUDED.client_id,
           slug = EXCLUDED.slug,
           status = 'active',
           dns_record_id = EXCLUDED.dns_record_id,
           dns_target = EXCLUDED.dns_target,
           proxied = EXCLUDED.proxied,
           ssl_status = 'cloudflare',
           last_checked_at = NOW(),
           error = NULL,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING *`,
    [
      client.id,
      fqdn,
      slug,
      record.id,
      settings.target_domain,
      settings.proxied !== false,
      JSON.stringify({ cloudflare_record: { id: record.id, name: record.name, proxied: record.proxied, content: record.content } }),
    ]
  );
  return result.rows[0];
}

async function verifyClientDomain(domainRow) {
  await ensureClientDomainSchema();
  const settings = await getDomainSettings({ includeSecret: true });
  requireConfigured(settings);
  try {
    const record = await findCloudflareRecord(settings, domainRow.domain);
    const active = Boolean(record && String(record.content || '').toLowerCase() === String(settings.target_domain || '').toLowerCase());
    const updated = await db.query(
      `UPDATE client_domains
       SET status = $2,
           dns_record_id = COALESCE($3, dns_record_id),
           dns_target = $4,
           proxied = COALESCE($5, proxied),
           last_checked_at = NOW(),
           error = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        domainRow.id,
        active ? 'active' : 'pending',
        record?.id || null,
        record?.content || settings.target_domain,
        record?.proxied,
        active ? null : 'DNS record was not found or points to a different target',
      ]
    );
    return updated.rows[0];
  } catch (err) {
    const updated = await db.query(
      `UPDATE client_domains
       SET status = 'failed', last_checked_at = NOW(), error = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [domainRow.id, err.message]
    );
    return updated.rows[0];
  }
}

module.exports = {
  ensureClientDomainSchema,
  getDomainSettings,
  saveDomainSettings,
  createClientSubdomain,
  verifyClientDomain,
  normalizeSlug,
};
