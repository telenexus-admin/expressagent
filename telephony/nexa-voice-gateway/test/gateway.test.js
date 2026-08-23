import test from 'node:test';
import assert from 'node:assert/strict';
import { CallRegistry } from '../src/calls.js';

test('call registry creates, updates, and retrieves isolated sessions', () => {
  const registry = new CallRegistry();
  const created = registry.create({ tenantId: 'isp-a', state: 'accepted' });
  assert.equal(registry.get(created.id).tenantId, 'isp-a');
  const updated = registry.update(created.id, { state: 'ended' });
  assert.equal(updated.state, 'ended');
  assert.equal(registry.list().length, 1);
});
