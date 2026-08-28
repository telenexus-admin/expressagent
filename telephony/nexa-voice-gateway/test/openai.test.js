import test from 'node:test';
import assert from 'node:assert/strict';

const events = [];

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;

  constructor() {
    this.readyState = FakeWebSocket.OPEN;
    this.handlers = new Map();
    this.sent = [];
    events.push(this);
  }

  on(name, handler) { this.handlers.set(name, handler); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
}

test('OpenAI realtime adapter sends PCMU audio and creates a greeting after configuration', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const { OpenAIRealtimeSession } = await import('../src/openai.js');
  const session = new OpenAIRealtimeSession({ WebSocketImpl: FakeWebSocket });
  session.start();
  const socket = events.at(-1);
  socket.handlers.get('open')();

  assert.equal(socket.sent[0].type, 'session.update');
  assert.equal(socket.sent[0].session.audio.input.format.type, 'audio/pcmu');
  assert.equal(socket.sent[0].session.audio.output.format.type, 'audio/pcmu');

  socket.handlers.get('message')(Buffer.from(JSON.stringify({ type: 'session.updated' })));
  assert.equal(socket.sent[1].type, 'response.create');

  const received = [];
  session.onAudio = (audio) => received.push(audio);
  socket.handlers.get('message')(Buffer.from(JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.from([1, 2, 3]).toString('base64') })));
  assert.deepEqual(received[0], Buffer.from([1, 2, 3]));

  assert.equal(session.sendAudio(Buffer.from([4, 5])), true);
  assert.equal(socket.sent.at(-1).type, 'input_audio_buffer.append');
});
