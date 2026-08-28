import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtpPacket, parseRtp } from '../src/media.js';

test('RTP parser accepts a valid ulaw packet and rejects invalid data', () => {
  const packet = createRtpPacket(Buffer.from([0xff]), { sequence: 7, timestamp: 160, ssrc: 9 });
  const parsed = parseRtp(packet);
  assert.equal(parsed.sequence, 7);
  assert.equal(parsed.timestamp, 160);
  assert.equal(parsed.ssrc, 9);
  assert.equal(parsed.payloadType, 0);
  assert.deepEqual(parsed.payload, Buffer.from([0xff]));
  assert.equal(parseRtp(Buffer.alloc(4)), null);
});

test('RTP packet builder wraps OpenAI PCMU audio with 8kHz telephony timestamps', () => {
  const packet = createRtpPacket(Buffer.alloc(160, 0x7f), { sequence: 10, timestamp: 3200, ssrc: 42 });
  assert.equal(packet.length, 172);
  assert.equal(packet.readUInt16BE(2), 10);
  assert.equal(packet.readUInt32BE(4), 3200);
  assert.equal(packet.readUInt32BE(8), 42);
  assert.equal(packet[1] & 0x7f, 0);
});
