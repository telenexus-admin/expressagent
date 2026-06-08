(function () {
  var config = window.NEXA_SITE_CHAT || {};
  var clientId = config.clientId || config.client_id;
  var apiBase = String(config.apiBase || 'https://nexa.telenexustechnologies.com/api/public/site-chat').replace(/\/$/, '');
  if (!clientId || document.getElementById('nexa-site-chat-root')) return;

  var title = config.title || 'Talk to Support';
  var brandName = config.brandName || 'AI Support';
  var accent = config.accent || '#3535FF';
  var root = document.createElement('div');
  root.id = 'nexa-site-chat-root';
  document.body.appendChild(root);

  var sessionKey = 'nexa_site_chat_session_' + clientId;
  var sessionId = localStorage.getItem(sessionKey);
  if (!sessionId) {
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(sessionKey, sessionId);
  }

  var state = { open: false, busy: false, messages: [] };

  var style = document.createElement('style');
  style.textContent = [
    '#nexa-site-chat-root{position:fixed;z-index:2147483647;right:18px;bottom:18px;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}',
    '#nexa-site-chat-root *{box-sizing:border-box}',
    '.nexa-chat-button{width:62px;height:62px;border:0;border-radius:999px;background:' + accent + ';color:#fff;box-shadow:0 18px 40px rgba(53,53,255,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:26px}',
    '.nexa-chat-panel{width:min(380px,calc(100vw - 28px));height:min(620px,calc(100vh - 110px));background:#fff;border:1px solid rgba(17,24,39,.08);border-radius:22px;box-shadow:0 24px 80px rgba(15,23,42,.25);overflow:hidden;display:flex;flex-direction:column;margin-bottom:12px}',
    '.nexa-chat-head{background:#0A0A0F;color:#fff;padding:15px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '.nexa-chat-title{font-size:15px;font-weight:900;line-height:1.2}.nexa-chat-subtitle{font-size:11px;color:rgba(255,255,255,.72);margin-top:2px}',
    '.nexa-chat-close{background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:999px;width:34px;height:34px;cursor:pointer;font-size:20px;line-height:1}',
    '.nexa-chat-messages{flex:1;overflow:auto;background:#f8fafc;padding:14px;display:flex;flex-direction:column;gap:10px}',
    '.nexa-msg{max-width:86%;border-radius:16px;padding:10px 12px;font-size:14px;line-height:1.38;white-space:pre-wrap;word-break:break-word}.nexa-msg.bot{align-self:flex-start;background:#fff;border:1px solid #e5e7eb}.nexa-msg.user{align-self:flex-end;background:' + accent + ';color:#fff}',
    '.nexa-chat-form{border-top:1px solid #e5e7eb;background:#fff;padding:10px;display:flex;gap:8px}.nexa-chat-input{flex:1;border:1px solid #d1d5db;border-radius:999px;padding:11px 13px;font-size:14px;outline:none}.nexa-chat-input:focus{border-color:' + accent + '}',
    '.nexa-chat-send{border:0;border-radius:999px;background:' + accent + ';color:#fff;padding:0 16px;font-size:13px;font-weight:900;cursor:pointer}.nexa-chat-send:disabled{opacity:.55;cursor:not-allowed}',
    '.nexa-hidden{display:none!important}',
    '@media(max-width:520px){#nexa-site-chat-root{right:12px;bottom:12px}.nexa-chat-panel{width:calc(100vw - 24px);height:calc(100vh - 96px);border-radius:18px}.nexa-chat-button{width:58px;height:58px}}'
  ].join('');
  document.head.appendChild(style);

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char];
    });
  }

  function render() {
    root.innerHTML =
      '<div class="' + (state.open ? 'nexa-chat-panel' : 'nexa-hidden') + '">' +
        '<div class="nexa-chat-head">' +
          '<div><div class="nexa-chat-title">' + escapeHtml(title) + '</div><div class="nexa-chat-subtitle">' + escapeHtml(brandName) + '</div></div>' +
          '<button class="nexa-chat-close" type="button" aria-label="Close chat">x</button>' +
        '</div>' +
        '<div class="nexa-chat-messages">' +
          (state.messages.length ? state.messages : [{ role: 'bot', text: 'Hi. How can I help you today?' }]).map(function (msg) {
            return '<div class="nexa-msg ' + (msg.role === 'user' ? 'user' : 'bot') + '">' + escapeHtml(msg.text) + '</div>';
          }).join('') +
          (state.busy ? '<div class="nexa-msg bot">Typing...</div>' : '') +
        '</div>' +
        '<form class="nexa-chat-form"><input class="nexa-chat-input" autocomplete="off" placeholder="Type your message..." /><button class="nexa-chat-send" type="submit" ' + (state.busy ? 'disabled' : '') + '>Send</button></form>' +
      '</div>' +
      '<button class="' + (state.open ? 'nexa-hidden' : 'nexa-chat-button') + '" type="button" aria-label="Open chat">?</button>';

    var messagesEl = root.querySelector('.nexa-chat-messages');
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage(text) {
    state.messages.push({ role: 'user', text: text });
    state.busy = true;
    render();
    try {
      var response = await fetch(apiBase + '/' + encodeURIComponent(clientId) + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId, name: 'Website visitor' })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to fetch');
      state.messages.push({ role: 'bot', text: data.reply || 'I am here. Please share more details.' });
    } catch (err) {
      state.messages.push({
        role: 'bot',
        text: 'I could not connect to live AI support right now. Please try again, WhatsApp us, or call.'
      });
    } finally {
      state.busy = false;
      render();
    }
  }

  root.addEventListener('click', function (event) {
    if (event.target.closest('.nexa-chat-button')) {
      state.open = true;
      render();
      setTimeout(function () {
        var input = root.querySelector('.nexa-chat-input');
        if (input) input.focus();
      }, 0);
    }
    if (event.target.closest('.nexa-chat-close')) {
      state.open = false;
      render();
    }
  });

  root.addEventListener('submit', function (event) {
    event.preventDefault();
    var input = root.querySelector('.nexa-chat-input');
    var text = input ? input.value.trim() : '';
    if (!text || state.busy) return;
    input.value = '';
    sendMessage(text);
  });

  render();
})();
