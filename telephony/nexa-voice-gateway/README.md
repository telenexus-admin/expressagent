# Nexa Voice Gateway

An isolated, provider-independent voice gateway foundation for Nexa. The existing Vapi/Asterisk route is not changed by this service.

## Current scope

- Strict environment validation
- Authenticated health and call-session APIs
- In-memory call registry for the first media-loop test
- No AI provider, billing action, or production call routing yet

## Next integration

The next adapter will connect Asterisk ARI and External Media to this service. Only after bidirectional audio and clean SIP termination pass in a controlled test will an AI speech provider be enabled.

## Run

```bash
cp .env.example .env
npm test
npm start
```
