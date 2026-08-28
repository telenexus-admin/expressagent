import test from 'node:test';
import assert from 'node:assert/strict';
import { AriClient } from '../src/ari.js';
test('ARI client authenticates external media requests', async () => {
  const calls = []; const client = new AriClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => JSON.stringify({ id: 'media-1' }) }; } });
  const result = await client.createExternalMedia('127.0.0.1:12000'); assert.equal(result.id, 'media-1'); assert.match(calls[0].url, /externalMedia\?/); assert.equal(calls[0].options.method, 'POST'); assert.match(calls[0].options.headers.Authorization, /^Basic /);
});