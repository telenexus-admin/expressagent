# Nexa Voice Gateway

A small self-hosted voice-agent gateway for Nexa. It keeps Asterisk/CloudOne call control in your infrastructure and connects the live call audio directly to the OpenAI Realtime API. Vapi is not required for this path.

## Current flow

```text
CloudOne SIP -> Asterisk -> Nexa Voice Gateway -> OpenAI Realtime
                                      ^                 |
                                      |---- PCMU RTP ---|
```

The gateway uses G.711 μ-law/PCMU end-to-end for the first telephony implementation, so the Asterisk External Media channel can exchange 8 kHz telephone audio directly with the OpenAI Realtime session.

## Current capabilities

- Asterisk ARI event handling and call lifecycle cleanup
- Per-call External Media UDP socket and RTP packetization
- OpenAI Realtime WebSocket session per call
- Configurable Nexa system prompt and greeting
- Server-side VAD with interruption support
- Direct PCMU audio input/output
- Configurable realtime model and voice
- Maximum call duration guard
- Authenticated health/call-session API
- No Vapi dependency

## Configuration

Copy `.env.example` to the server's environment file and set at minimum:

```bash
OPENAI_API_KEY=your-existing-openai-api-key
GATEWAY_SHARED_SECRET=long-random-secret
ARI_USERNAME=nexa_gateway
ARI_PASSWORD=your-ari-password
```

Then customize:

```bash
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_VOICE=marin
NEXA_AGENT_PROMPT=Your Nexa system prompt here
NEXA_GREETING=Greet the caller as Nexa and ask how you can help.
```

The Realtime API accepts session instructions and PCMU audio configuration, and server-side VAD can automatically create responses after the caller finishes speaking.

## Test locally

```bash
npm test
```

## Run

```bash
npm start
```

The gateway does not alter the existing Vapi route by itself. The isolated `7999` Stasis test route can be used first. After the gateway test passes, the real CloudOne number can be moved to this path.
