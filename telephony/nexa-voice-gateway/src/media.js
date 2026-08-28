import dgram from 'node:dgram';

export function parseRtp(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 12) return null;
  const version = packet[0] >> 6;
  if (version !== 2) return null;
  const csrcCount = packet[0] & 0x0f;
  const hasExtension = Boolean(packet[0] & 0x10);
  const headerLength = 12 + csrcCount * 4;
  if (packet.length < headerLength) return null;
  let payloadOffset = headerLength;
  if (hasExtension) {
    if (packet.length < payloadOffset + 4) return null;
    const extensionWords = packet.readUInt16BE(payloadOffset + 2);
    payloadOffset += 4 + extensionWords * 4;
  }
  if (payloadOffset > packet.length) return null;
  return { payloadType: packet[1] & 0x7f, sequence: packet.readUInt16BE(2), timestamp: packet.readUInt32BE(4), ssrc: packet.readUInt32BE(8), payload: packet.subarray(payloadOffset) };
}

export class RtpEchoBridge {
  constructor({ host = '127.0.0.1', port = 12000, socket = dgram.createSocket('udp4') } = {}) {
    this.host = host; this.port = port; this.socket = socket; this.started = false;
  }
  start() {
    if (this.started) return;
    this.socket.on('message', (packet, peer) => {
      const rtp = parseRtp(packet); if (!rtp) return;
      this.socket.send(packet, peer.port, peer.address);
    });
    this.socket.bind(this.port, this.host); this.started = true;
  }
  stop() { if (!this.started) return; this.socket.close(); this.started = false; }
}
