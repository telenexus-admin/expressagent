import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRtp } from '../src/media.js';

test('RTP parser accepts a valid ulaw packet and rejects invalid data', () => {
  const packet = Buffer.alloc(13); packet[0] = 0x80; packet[1] = 0; packet.writeUInt16BE(7, 2); packet.writeUInt32BE(160, 4); packet.writeUInt32BE(9, 8); packet[12] = 0xff;
  const parsed = parseRtp(packet); assert.equal(parsed.sequence, 7); assert.equal(parsed.timestamp, 160); assert.equal(parsed.payload.length, 1); assert.equal(parseRtp(Buffer.alloc(4)), null);
});
