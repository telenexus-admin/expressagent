import { config } from './config.js';
function authHeader() { return `Basic ${Buffer.from(`${config.ariUsername}:${config.ariPassword}`).toString('base64')}`; }
export class AriClient {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl; }
  async request(path, options = {}) {
    const response = await this.fetchImpl(`${config.ariUrl}${path}`, { ...options, headers: { Authorization: authHeader(), ...(options.headers || {}) } });
    const text = await response.text(); const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`ARI ${response.status}: ${JSON.stringify(body)}`); return body;
  }
  createBridge() { return this.request('/bridges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'mixing' }) }); }
  createExternalMedia(externalHost) { const query = new URLSearchParams({ app: config.ariApp, external_host: externalHost, format: config.mediaCodec, direction: 'both' }); return this.request(`/channels/externalMedia?${query}`, { method: 'POST' }); }
  addToBridge(bridgeId, channelIds) { const query = new URLSearchParams({ channel: channelIds.join(',') }); return this.request(`/bridges/${encodeURIComponent(bridgeId)}/addChannel?${query}`, { method: 'POST' }); }
}