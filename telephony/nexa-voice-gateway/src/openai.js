import WebSocket from 'ws';
import { config } from './config.js';

function realtimeUrl() {
  return `${config.openaiRealtimeUrl}?model=${encodeURIComponent(config.openaiModel)}`;
}

export class OpenAIRealtimeSession {
  constructor({ callId, onAudio, onTranscript, onError, onClose, WebSocketImpl = WebSocket } = {}) {
    this.callId = callId;
    this.onAudio = onAudio;
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onClose = onClose;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.open = false;
    this.configured = false;
    this.greeted = false;
  }

  start() {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
    this.socket = new this.WebSocketImpl(realtimeUrl(), {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    });

    this.socket.on('open', () => {
      this.open = true;
      this.send({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: config.agentPrompt,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: { type: 'audio/pcmu' },
              turn_detection: {
                type: 'server_vad',
                threshold: config.vadThreshold,
                prefix_padding_ms: config.vadPrefixPaddingMs,
                silence_duration_ms: config.vadSilenceDurationMs,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: { type: 'audio/pcmu' },
              voice: config.openaiVoice,
              speed: config.voiceSpeed,
            },
          },
        },
      });
    });

    this.socket.on('message', (data) => this.handleMessage(data));
    this.socket.on('error', (error) => this.onError?.(error));
    this.socket.on('close', (code, reason) => {
      this.open = false;
      this.onClose?.(code, reason?.toString?.() || '');
    });
    return this;
  }

  handleMessage(data) {
    let event;
    try { event = JSON.parse(data.toString()); } catch { return; }

    if (event.type === 'session.updated' && !this.greeted) {
      this.configured = true;
      this.greeted = true;
      this.send({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions: config.greetingInstruction,
        },
      });
      return;
    }

    if (event.type === 'response.output_audio.delta' && event.delta) {
      this.onAudio?.(Buffer.from(event.delta, 'base64'));
      return;
    }

    if (event.type === 'response.output_audio_transcript.delta' && event.delta) {
      this.onTranscript?.({ direction: 'outbound', delta: event.delta });
      return;
    }

    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
      this.onTranscript?.({ direction: 'inbound', text: event.transcript });
      return;
    }

    if (event.type === 'error') {
      this.onError?.(new Error(event.error?.message || 'OpenAI realtime error'));
    }
  }

  send(event) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  sendAudio(payload) {
    if (!payload?.length) return false;
    return this.send({
      type: 'input_audio_buffer.append',
      audio: Buffer.from(payload).toString('base64'),
    });
  }

  stop() {
    if (!this.socket) return;
    try {
      if (this.socket.readyState === this.WebSocketImpl.OPEN || this.socket.readyState === this.WebSocketImpl.CONNECTING) {
        this.socket.close(1000, 'call ended');
      }
    } finally {
      this.open = false;
    }
  }
}
