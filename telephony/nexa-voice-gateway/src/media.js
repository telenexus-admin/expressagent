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
  return {
    payloadType: packet[1] & 0x7f,
    sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    payload: packet.subarray(payloadOffset),
  };
}

export function createRtpPacket(payload, { sequence, timestamp, ssrc = 0x4e455841, payloadType = 0 } = {}) {
  const packet = Buffer.allocUnsafe(12 + payload.length);
  packet[0] = 0x80;
  packet[1] = payloadType & 0x7f;
  packet.writeUInt16BE(sequence & 0xffff, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  packet.writeUInt32BE(ssrc >>> 0, 8);
  payload.copy(packet, 12);
  return packet;
}

export class RtpMediaSession {
  constructor({ host = '127.0.0.1', port, socket = dgram.createSocket('udp4'), onAudio, onPeer, onError } = {}) {
    this.host = host;
    this.port = port;
    this.socket = socket;
    this.onAudio = onAudio;
    this.onPeer = onPeer;
    this.onError = onError;
    this.started = false;
    this.peer = null;
    this.outputSequence = Math.floor(Math.random() * 0xffff);
    this.outputTimestamp = Math.floor(Math.random() * 0xffffffff);
    this.outputSsrc = Math.floor(Math.random() * 0xffffffff);
  }

  async start() {
    if (this.started) return this.port;
    this.socket.on('message', (packet, peer) => {
      const rtp = parseRtp(packet);
      if (!rtp || !rtp.payload.length) return;
      this.peer = { address: peer.address, port: peer.port };
      this.onPeer?.(this.peer);
      this.onAudio?.(rtp.payload, rtp);
    });
    this.socket.on('error', (error) => this.onError?.(error));
    await new Promise((resolve, reject) => {
      const onListening = () => {
        this.socket.off('error', onError);
        this.started = true;
        this.port = this.socket.address().port;
        resolve();
      };
      const onError = (error) => {
        this.socket.off('listening', onListening);
        reject(error);
      };
      this.socket.once('listening', onListening);
      this.socket.once('error', onError);
      this.socket.bind(this.port, this.host);
    });
    return this.port;
  }

  sendAudio(payload) {
    if (!this.started || !this.peer || !payload?.length) return;
    const frameSize = 160;
    for (let offset = 0; offset < payload.length; offset += frameSize) {
      const frame = payload.subarray(offset, Math.min(offset + frameSize, payload.length));
      const packet = createRtpPacket(frame, {
        sequence: this.outputSequence++, timestamp: this.outputTimestamp, ssrc: this.outputSsrc,
      });
      this.outputTimestamp = (this.outputTimestamp + frame.length) >>> 0;
      this.socket.send(packet, this.peer.port, this.peer.address);
    }
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    try { this.socket.close(); } catch {}
  }
}
