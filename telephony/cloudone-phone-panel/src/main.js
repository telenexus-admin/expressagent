import './styles.css';
import {
  Invitation,
  Inviter,
  Registerer,
  RegistererState,
  SessionState,
  UserAgent,
} from 'sip.js';

const app = document.getElementById('app');
const remoteAudio = document.getElementById('remoteAudio');

const state = {
  config: null,
  userAgent: null,
  registerer: null,
  session: null,
  direction: null,
  peer: '',
  phoneStatus: 'starting',
  muted: false,
  callStartedAt: null,
  elapsed: 0,
  logs: [],
  dialValue: '',
  selectedDid: '',
  error: '',
  reconnectAttempt: 0,
  reconnectTimer: null,
  reconnecting: false,
};

let timer = null;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length >= 12) {
    const local = `0${digits.slice(3)}`;
    if (local.length === 10) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return value || 'Unknown';
}

function formatDuration(seconds = 0) {
  const total = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeKenyanNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254') && digits.length >= 11 && digits.length <= 13) return digits;
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) return `254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`;
  return null;
}

function statusLabel() {
  const labels = {
    starting: 'Starting…',
    connecting: 'Connecting…',
    registering: 'Registering…',
    online: 'Online',
    dialing: 'Calling…',
    incoming: 'Incoming call',
    in_call: 'In call',
    offline: 'Offline',
    error: 'Error',
  };
  return labels[state.phoneStatus] || state.phoneStatus;
}

function render() {
  const dids = state.config?.outboundDids || [];
  const activeCall = ['dialing', 'incoming', 'in_call'].includes(state.phoneStatus);
  const isIncoming = state.phoneStatus === 'incoming';
  const isInCall = state.phoneStatus === 'in_call';
  const isOnline = state.phoneStatus === 'online';

  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div>
          <div class="eyebrow">CLOUDONE BUSINESS PHONE</div>
          <h1>Nexa Phone</h1>
        </div>
        <div class="presence ${state.phoneStatus === 'online' || activeCall ? 'is-online' : ''}">
          <span class="presence-dot"></span>
          ${escapeHtml(statusLabel())}
        </div>
      </header>

      ${state.error ? `<div class="alert">${escapeHtml(state.error)}<button id="dismissError">×</button></div>` : ''}

      <button id="reconnectPhone" class="text-button">Reconnect phone</button>

      <section class="workspace">
        <section class="phone-card">
          <div class="phone-card-head">
            <div>
              <span class="field-label">Calling from</span>
              <select id="didSelect" ${activeCall ? 'disabled' : ''}>
                ${dids.map((item) => `
                  <option value="${escapeHtml(item.did)}" ${item.did === state.selectedDid ? 'selected' : ''}>
                    ${escapeHtml(item.label)}
                  </option>
                `).join('')}
              </select>
            </div>
            <div class="extension-chip">Ext ${escapeHtml(state.config?.extension || '—')}</div>
          </div>

          <div class="call-display ${activeCall ? 'active' : ''}">
            ${activeCall ? `
              <div class="call-kicker">${state.direction === 'incoming' ? 'INCOMING' : 'OUTGOING'}</div>
              <div class="peer-number">${escapeHtml(formatNumber(state.peer || state.dialValue))}</div>
              <div class="call-state">${escapeHtml(statusLabel())}${state.callStartedAt ? ` · ${formatDuration(state.elapsed)}` : ''}</div>
            ` : `
              <input id="numberInput" inputmode="tel" autocomplete="off" placeholder="Enter phone number" value="${escapeHtml(state.dialValue)}" />
              <div class="input-hint">Example: 0712 345 678</div>
            `}
          </div>

          ${!activeCall ? `
            <div class="keypad" aria-label="Dial pad">
              ${['1','2','3','4','5','6','7','8','9','*','0','#'].map((key) => `<button class="key" data-key="${key}">${key}</button>`).join('')}
            </div>
            <button id="callButton" class="primary-call" ${!isOnline || !state.dialValue ? 'disabled' : ''}>
              <span class="call-icon">☎</span>
              Call
            </button>
          ` : ''}

          ${isIncoming ? `
            <div class="incoming-actions">
              <button id="rejectButton" class="round-action danger">✕<span>Reject</span></button>
              <button id="answerButton" class="round-action success">☎<span>Answer</span></button>
            </div>
          ` : ''}

          ${state.phoneStatus === 'dialing' ? `
            <div class="call-actions single">
              <button id="hangupButton" class="round-action danger">✕<span>Cancel</span></button>
            </div>
          ` : ''}

          ${isInCall ? `
            <div class="call-actions">
              <button id="muteButton" class="round-action neutral ${state.muted ? 'pressed' : ''}">
                ${state.muted ? '🔇' : '🎙'}<span>${state.muted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button id="hangupButton" class="round-action danger">✕<span>Hang up</span></button>
            </div>
          ` : ''}
        </section>

        <section class="history-card">
          <div class="history-head">
            <div>
              <div class="eyebrow">ACTIVITY</div>
              <h2>Recent calls</h2>
            </div>
            <button id="refreshLogs" class="text-button">Refresh</button>
          </div>

          <div class="history-list">
            ${state.logs.length ? state.logs.map((call) => `
              <article class="history-row">
                <div class="history-icon ${call.direction === 'incoming' ? 'incoming' : 'outgoing'}">
                  ${call.direction === 'incoming' ? '↙' : '↗'}
                </div>
                <div class="history-main">
                  <div class="history-number">${escapeHtml(formatNumber(call.number))}</div>
                  <div class="history-meta">${escapeHtml(call.directionLabel)} · ${escapeHtml(call.timeLabel)}</div>
                </div>
                <div class="history-side">
                  <div class="history-status ${call.statusClass}">${escapeHtml(call.status)}</div>
                  <div class="history-duration">${call.billsec ? formatDuration(call.billsec) : '—'}</div>
                </div>
              </article>
            `).join('') : `<div class="empty-history">No calls yet.</div>`}
          </div>
        </section>
      </section>

      <footer class="footer-note">Your CloudOne trunk password stays on the PBX and is never sent to this browser.</footer>
    </main>
  `;

  bindUi();
}

function bindUi() {
  document.getElementById('dismissError')?.addEventListener('click', () => {
    state.error = '';
    render();
  });

  document.getElementById('didSelect')?.addEventListener('change', (event) => {
    state.selectedDid = event.target.value;
  });

  const numberInput = document.getElementById('numberInput');
  numberInput?.addEventListener('input', (event) => {
    state.dialValue = event.target.value;
    const button = document.getElementById('callButton');
    if (button) button.disabled = state.phoneStatus !== 'online' || !state.dialValue.trim();
  });

  document.querySelectorAll('[data-key]').forEach((button) => {
    button.addEventListener('click', () => {
      state.dialValue += button.dataset.key;
      render();
      requestAnimationFrame(() => document.getElementById('numberInput')?.focus());
    });
  });

  document.getElementById('callButton')?.addEventListener('click', placeCall);
  document.getElementById('answerButton')?.addEventListener('click', answerCall);
  document.getElementById('rejectButton')?.addEventListener('click', rejectCall);
  document.getElementById('hangupButton')?.addEventListener('click', hangupCall);
  document.getElementById('muteButton')?.addEventListener('click', toggleMute);
  document.getElementById('refreshLogs')?.addEventListener('click', loadLogs);
  document.getElementById('reconnectPhone')?.addEventListener('click', () => {
    scheduleReconnect('manual', true);
  });
}

function startTimer() {
  stopTimer();
  state.callStartedAt = Date.now();
  state.elapsed = 0;
  timer = window.setInterval(() => {
    state.elapsed = Math.floor((Date.now() - state.callStartedAt) / 1000);
    const callState = document.querySelector('.call-state');
    if (callState) callState.textContent = `${statusLabel()} · ${formatDuration(state.elapsed)}`;
  }, 1000);
}

function stopTimer() {
  if (timer) window.clearInterval(timer);
  timer = null;
  state.callStartedAt = null;
  state.elapsed = 0;
}

function attachRemoteMedia(session) {
  const handler = session.sessionDescriptionHandler;
  const pc = handler?.peerConnection;
  if (!pc) return;
  const stream = new MediaStream();
  pc.getReceivers().forEach((receiver) => {
    if (receiver.track) stream.addTrack(receiver.track);
  });
  remoteAudio.srcObject = stream;
  remoteAudio.play().catch(() => {});
}

function bindSession(session) {
  state.session = session;
  session.stateChange.addListener((newState) => {
    if (newState === SessionState.Established) {
      state.phoneStatus = 'in_call';
      attachRemoteMedia(session);
      startTimer();
      render();
      return;
    }
    if (newState === SessionState.Terminated) {
      finishCall();
    }
  });
}

async function finishCall() {
  stopTimer();
  state.session = null;
  state.direction = null;
  state.peer = '';
  state.muted = false;
  state.phoneStatus = state.registerer?.state === RegistererState.Registered ? 'online' : 'offline';
  render();
  window.setTimeout(loadLogs, 900);
}

async function placeCall() {
  if (!state.userAgent || state.phoneStatus !== 'online') return;
  const internalTest = String(state.dialValue).trim() === '7999';
  const normalized = internalTest ? '7999' : normalizeKenyanNumber(state.dialValue);
  if (!normalized) {
    state.error = 'Enter a valid Kenyan mobile or landline number.';
    render();
    return;
  }

  const did = (state.config?.outboundDids || []).find((item) => item.did === state.selectedDid);
  if (!did) {
    state.error = 'Choose a caller ID first.';
    render();
    return;
  }

  try {
    const destination = internalTest ? normalized : `${did.dialPrefix}${normalized}`;
    const target = UserAgent.makeURI(`sip:${destination}@${state.config.sipDomain}`);
    if (!target) throw new Error('Invalid destination');

    const inviter = new Inviter(state.userAgent, target, {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });

    state.direction = 'outgoing';
    state.peer = normalized;
    state.phoneStatus = 'dialing';
    state.error = '';
    bindSession(inviter);
    render();
    await inviter.invite();
  } catch (error) {
    console.error(error);
    state.error = 'The call could not be started.';
    await finishCall();
  }
}

async function answerCall() {
  const invitation = state.session;
  if (!(invitation instanceof Invitation)) return;
  try {
    await invitation.accept({
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });
  } catch (error) {
    console.error(error);
    state.error = 'The incoming call could not be answered.';
    render();
  }
}

async function rejectCall() {
  const invitation = state.session;
  if (!(invitation instanceof Invitation)) return;
  try {
    await invitation.reject();
  } finally {
    await finishCall();
  }
}

async function hangupCall() {
  const session = state.session;
  if (!session) return;
  try {
    if (session.state === SessionState.Established) {
      await session.bye();
    } else if (session instanceof Inviter) {
      await session.cancel();
    } else if (session instanceof Invitation) {
      await session.reject();
    }
  } catch (error) {
    console.error(error);
  } finally {
    if (session.state !== SessionState.Terminated) await finishCall();
  }
}

function toggleMute() {
  const session = state.session;
  const pc = session?.sessionDescriptionHandler?.peerConnection;
  if (!pc) return;
  state.muted = !state.muted;
  pc.getSenders().forEach((sender) => {
    if (sender.track?.kind === 'audio') sender.track.enabled = !state.muted;
  });
  render();
}

async function loadLogs() {
  try {
    const response = await fetch('/api/calls?limit=40', { cache: 'no-store' });
    if (!response.ok) throw new Error('Call history request failed');
    const body = await response.json();
    state.logs = Array.isArray(body.calls) ? body.calls : [];
    render();
  } catch (error) {
    console.error(error);
  }
}

function clearReconnectTimer() {
  if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

async function stopPhone() {
  const registerer = state.registerer;
  const userAgent = state.userAgent;
  state.registerer = null;
  state.userAgent = null;
  try {
    if (registerer && registerer.state === RegistererState.Registered) await registerer.unregister();
  } catch (error) {
    console.warn('Nexa phone unregister failed', error);
  }
  try {
    if (userAgent) await userAgent.stop();
  } catch (error) {
    console.warn('Nexa phone transport shutdown failed', error);
  }
}

function scheduleReconnect(reason = 'connection', immediate = false) {
  if (state.session || state.reconnectTimer || state.reconnecting) return;
  clearReconnectTimer();
  state.reconnectAttempt = immediate ? 0 : Math.min(state.reconnectAttempt + 1, 6);
  const delay = immediate ? 0 : Math.min(30000, 1000 * (2 ** Math.max(0, state.reconnectAttempt - 1)));
  state.phoneStatus = 'offline';
  state.error = immediate ? '' : 'Phone connection lost. Reconnecting automatically...';
  render();
  state.reconnectTimer = window.setTimeout(async () => {
    state.reconnectTimer = null;
    state.reconnecting = true;
    try {
      await stopPhone();
      await connectPhone();
    } catch (error) {
      console.error('Nexa phone reconnect failed', error);
      state.phoneStatus = 'offline';
      state.error = 'Phone is offline. Retrying automatically...';
      state.reconnecting = false;
      render();
      scheduleReconnect(reason);
      return;
    }
    state.reconnecting = false;
  }, delay);
}

async function connectPhone() {
  state.phoneStatus = 'connecting';
  render();

  const uri = UserAgent.makeURI(`sip:${state.config.extension}@${state.config.sipDomain}`);
  if (!uri) throw new Error('Invalid phone extension URI');

  const userAgent = new UserAgent({
    uri,
    authorizationUsername: state.config.username,
    authorizationPassword: state.config.password,
    displayName: state.config.displayName || 'Nexa Phone',
    transportOptions: { server: state.config.websocket },
    sessionDescriptionHandlerFactoryOptions: {
      peerConnectionConfiguration: {
        iceServers: [],
      },
    },
    delegate: {
      onDisconnect: () => {
        if (!state.session) scheduleReconnect('transport');
      },
      onInvite: (invitation) => {
        if (state.session) {
          invitation.reject().catch(() => {});
          return;
        }
        state.direction = 'incoming';
        state.peer = invitation.remoteIdentity?.uri?.user || invitation.remoteIdentity?.displayName || 'Unknown';
        state.phoneStatus = 'incoming';
        state.error = '';
        bindSession(invitation);
        navigator.vibrate?.([180, 100, 180]);
        render();
      },
    },
  });

  state.userAgent = userAgent;
  await userAgent.start();

  state.phoneStatus = 'registering';
  render();

  const registerer = new Registerer(userAgent, { expires: 300 });
  state.registerer = registerer;
  registerer.stateChange.addListener((newState) => {
    if (newState === RegistererState.Registered && !state.session) {
      clearReconnectTimer();
      state.reconnectAttempt = 0;
      state.reconnecting = false;
      state.phoneStatus = 'online';
      state.error = '';
      render();
    }
    if (newState === RegistererState.Unregistered && !state.session) {
      scheduleReconnect('registration');
    }
  });
  await registerer.register();
}

async function bootstrap() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Phone configuration unavailable');
    state.config = await response.json();
    state.selectedDid = state.config.outboundDids?.[0]?.did || '';
    render();
    await Promise.all([connectPhone(), loadLogs()]);
  } catch (error) {
    console.error(error);
    state.phoneStatus = 'offline';
    state.error = 'Phone setup could not connect. Retrying automatically...';
    render();
    scheduleReconnect('startup');
  }
}

window.addEventListener('beforeunload', () => {
  clearReconnectTimer();
  state.registerer?.unregister().catch(() => {});
  state.userAgent?.stop().catch(() => {});
});

window.addEventListener('online', () => scheduleReconnect('network', true));

render();
bootstrap();
