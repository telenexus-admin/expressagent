import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';

const BUBBLE = {
  user: {
    wrap: 'justify-start',
    bubble: 'bg-gray-100 text-gray-900 rounded-tl-md',
    label: 'text-gray-500',
  },
  assistant: {
    wrap: 'justify-end',
    bubble: 'bg-[#3535FF] text-white rounded-tr-md',
    label: 'text-[#3535FF]',
  },
  admin: {
    wrap: 'justify-end',
    bubble: 'bg-[#0A0A0F] text-white rounded-tr-md',
    label: 'text-gray-700',
  },
};

const REPLY_MODES = [
  { value: 'auto', label: 'Auto', description: 'Voice follows voice, text follows text' },
  { value: 'text', label: 'Text only', description: 'AI always sends normal messages' },
  { value: 'voice', label: 'Voice note', description: 'AI always sends voice notes' },
  { value: 'silent', label: 'Silent', description: 'AI records but does not reply' },
];

function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function messageText(msg) {
  if (msg.attachment_media_type === 'image') {
    return String(msg.content || '').replace(/^\[Image received\]\s*/, '').trim();
  }
  if (msg.attachment_media_type === 'audio') {
    return String(msg.content || '').replace(/^\[Voice note\]\s*/, '').trim();
  }
  return String(msg.content || '').replace(/^\[Voice reply\]\s*/, '').trim();
}

function MessageAttachment({ msg }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!['image', 'audio'].includes(msg.attachment_media_type)) return undefined;

    let active = true;
    let objectUrl = '';
    setSrc('');
    setFailed(false);

    api
      .get(`/conversations/messages/${msg.id}/attachment`, { responseType: 'blob' })
      .then((response) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(response.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [msg.id, msg.attachment_media_type]);

  if (!['image', 'audio'].includes(msg.attachment_media_type)) return null;
  if (failed) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-xs text-gray-500">
        Attachment unavailable
      </div>
    );
  }
  if (!src) {
    return (
      <div className="h-32 w-52 max-w-full animate-pulse rounded-xl bg-black/10" />
    );
  }

  if (msg.attachment_media_type === 'image') {
    return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img
        src={src}
        alt={msg.attachment_filename || 'Customer attachment'}
        className="max-h-80 w-auto max-w-full rounded-xl border border-black/5 object-contain"
      />
    </a>
    );
  }

  return <audio controls preload="metadata" src={src} className="w-64 max-w-full" />;
}

export default function ChatView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [reply, setReply] = useState('');
  const [manualMode, setManualMode] = useState('text');
  const [sending, setSending] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [replyModeLoading, setReplyModeLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const messagesRef = useRef(null);
  const bottomRef = useRef(null);
  const prevIdRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);

  const isNearBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!id) return;
    try {
      shouldStickToBottomRef.current = isNearBottom();
      const { data } = await api.get(`/conversations/${id}/messages`);
      setMessages(data);
    } catch {
      // silent — poll will retry
    }
  }, [id, isNearBottom]);

  const fetchConversation = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get('/conversations');
      const found = data.find((c) => String(c.id) === String(id));
      if (found) setConversation(found);
    } catch {
      // silent
    }
  }, [id]);

  useEffect(() => {
    if (id !== prevIdRef.current) {
      setMessages([]);
      setConversation(null);
      setReply('');
      setError('');
      shouldStickToBottomRef.current = true;
      lastMessageCountRef.current = 0;
      prevIdRef.current = id;
    }
    if (id) {
      fetchMessages();
      fetchConversation();
    }
  }, [id, fetchMessages, fetchConversation]);

  useEffect(() => {
    if (!id) return;
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [id, fetchMessages]);

  useEffect(() => {
    if (conversation?.reply_mode === 'voice') setManualMode('voice');
    if (conversation?.reply_mode === 'text') setManualMode('text');
  }, [conversation?.id, conversation?.reply_mode]);

  useEffect(() => {
    if (!messages.length) return;
    const messageCountChanged = messages.length !== lastMessageCountRef.current;
    lastMessageCountRef.current = messages.length;
    if (!messageCountChanged || !shouldStickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/conversations/${id}/reply`, { message: text, mode: manualMode });
      setReply('');
      await fetchMessages();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const updateReplyMode = async (replyMode) => {
    if (!conversation || replyModeLoading) return;
    setReplyModeLoading(true);
    setError('');
    try {
      const { data } = await api.patch(`/conversations/${id}/reply-mode`, { reply_mode: replyMode });
      setConversation((current) => ({ ...(current || {}), ...data }));
      if (replyMode === 'voice') setManualMode('voice');
      if (replyMode === 'text') setManualMode('text');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update reply style');
    } finally {
      setReplyModeLoading(false);
    }
  };

  const updateStatus = async (status) => {
    setStatusLoading(true);
    try {
      await api.patch(`/conversations/${id}/status`, { status });
      await fetchConversation();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status');
    } finally {
      setStatusLoading(false);
    }
  };

  const confirmInstallation = async () => {
    if (!conversation || confirming) return;
    const ok = window.confirm(
      `Send an installation confirmation SMS to ${conversation.customer_phone}?`
    );
    if (!ok) return;
    setConfirming(true);
    setError('');
    try {
      await api.post(`/conversations/${id}/confirm-installation`);
      await fetchMessages();
      await fetchConversation();
      setToast('Installation confirmation SMS sent');
      setTimeout(() => setToast(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send confirmation SMS');
    } finally {
      setConfirming(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  if (!id) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
          </svg>
          <p className="text-lg font-medium text-gray-700">Select a conversation</p>
          <p className="text-sm mt-1">Choose a conversation from the list to get started</p>
        </div>
      </div>
    );
  }

  const isResolved = conversation?.status === 'resolved';
  const isHuman = conversation?.status === 'human_takeover';
  const aiOn = conversation?.status === 'active';
  const replyMode = conversation?.reply_mode || 'auto';
  const aiLabel = isHuman
    ? 'AI Off - Human Takeover'
    : isResolved
    ? 'Resolved'
    : replyMode === 'silent'
    ? 'AI Silent'
    : 'AI Active';

  const toggleAi = () => {
    if (!conversation || isResolved || statusLoading) return;
    updateStatus(aiOn ? 'human_takeover' : 'active');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 shrink-0 border-b border-gray-100">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/dashboard/conversations')}
            className="md:hidden w-9 h-9 -ml-1 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-700 shrink-0"
            aria-label="Back to conversations"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="w-10 h-10 rounded-full bg-[#3535FF] flex items-center justify-center text-white font-semibold text-sm shrink-0">
            {conversation?.customer_phone?.slice(-2) || '?'}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-gray-900 truncate">
              {conversation?.customer_phone || '...'}
            </div>
            {conversation && (
              <span
                className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium mt-0.5 ${
                  isResolved
                    ? 'bg-gray-100 text-gray-500'
                    : isHuman
                    ? 'bg-orange-100 text-orange-700'
                    : replyMode === 'silent'
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {aiLabel}
              </span>
            )}
          </div>
        </div>

        {conversation && (
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {!isResolved && (
              <div className="flex items-center gap-1.5 sm:gap-2 bg-gray-50 rounded-full px-2 sm:px-3 py-1 sm:py-1.5">
                <span className="hidden sm:inline text-xs font-medium text-gray-600">AI Agent</span>
                <span className="sm:hidden text-[10px] font-semibold text-gray-600">AI</span>
                <button
                  onClick={toggleAi}
                  disabled={statusLoading}
                  role="switch"
                  aria-checked={aiOn}
                  title={aiOn ? 'Turn AI off (admin will reply manually)' : 'Turn AI on (AI will auto-reply)'}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                    aiOn ? 'bg-[#3535FF]' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      aiOn ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <span className={`hidden sm:inline text-xs font-semibold w-6 ${aiOn ? 'text-[#3535FF]' : 'text-gray-500'}`}>
                  {aiOn ? 'On' : 'Off'}
                </span>
              </div>
            )}
            {!isResolved && (
              <select
                value={replyMode}
                onChange={(e) => updateReplyMode(e.target.value)}
                disabled={replyModeLoading}
                title="Choose how the AI replies in this conversation"
                className="hidden lg:block h-9 rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 outline-none focus:border-[#3535FF] disabled:opacity-50"
              >
                {REPLY_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            )}
            {!isResolved && (
              <button
                onClick={confirmInstallation}
                disabled={confirming}
                title="Send an SMS to the customer confirming their installation"
                className="text-[10px] sm:text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {confirming ? 'Sending...' : (
                  <>
                    <span className="hidden sm:inline">Confirm Installation</span>
                    <span className="sm:hidden">Confirm</span>
                  </>
                )}
              </button>
            )}
            {!isResolved && (
              <button
                onClick={() => updateStatus('resolved')}
                disabled={statusLoading}
                className="text-[10px] sm:text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Resolve
              </button>
            )}
            {isResolved && (
              <button
                onClick={() => updateStatus('active')}
                disabled={statusLoading}
                className="text-[10px] sm:text-xs bg-[#3535FF] hover:bg-[#2828DD] text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Reopen
              </button>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        onScroll={() => {
          shouldStickToBottomRef.current = isNearBottom();
        }}
        className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 bg-[#FAFAFF]"
      >
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">No messages yet</p>
        )}
        {messages.map((msg) => {
          const style = BUBBLE[msg.role] || BUBBLE.user;
          const text = messageText(msg);
          return (
            <div key={msg.id} className={`flex ${style.wrap}`}>
              <div className="max-w-[85%] sm:max-w-[70%]">
                <div className={`text-[10px] mb-1 font-medium ${style.label} ${msg.role !== 'user' ? 'text-right' : ''}`}>
                  {msg.role === 'user'
                    ? 'Customer'
                    : msg.role === 'assistant'
                    ? 'AI Assistant'
                    : `Admin — ${msg.sender_name || 'Unknown'}`}
                </div>
                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${style.bubble}`}>
                  <MessageAttachment msg={msg} />
                  {text && (
                    <div className={msg.attachment_media_type ? 'mt-2' : ''}>
                      {text}
                    </div>
                  )}
                </div>
                <div className={`text-[10px] text-gray-400 mt-1 ${msg.role !== 'user' ? 'text-right' : ''}`}>
                  {formatTimestamp(msg.timestamp)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mb-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Success toast */}
      {toast && (
        <div className="mx-6 mb-2 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-xl text-xs flex items-center justify-between">
          <span>{toast}</span>
          <button onClick={() => setToast('')} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Reply input */}
      {!isResolved && (
        <div className="p-3 sm:p-4 shrink-0 border-t border-gray-100">
          {isHuman && (
            <div className="text-xs text-orange-600 mb-2 flex items-center gap-1">
              <span>●</span>
              <span>AI agent is off — your replies are sent directly to the customer</span>
            </div>
          )}
          <div className="mb-3 rounded-2xl border border-gray-100 bg-gray-50 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-gray-900">Reply style</p>
                <p className="text-[11px] text-gray-500">{REPLY_MODES.find((mode) => mode.value === replyMode)?.description}</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-[#3535FF]">
                {replyMode}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {REPLY_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => updateReplyMode(mode.value)}
                  disabled={replyModeLoading}
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                    replyMode === mode.value
                      ? 'bg-[#3535FF] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setManualMode('text')}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${manualMode === 'text' ? 'bg-[#3535FF] text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Send text
            </button>
            <button
              type="button"
              onClick={() => setManualMode('voice')}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${manualMode === 'voice' ? 'bg-[#3535FF] text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Send voice note
            </button>
          </div>
          <div className="flex gap-2 items-end">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                manualMode === 'voice'
                  ? 'Type what the voice note should say...'
                  : isHuman
                  ? 'Type your reply... (Enter to send)'
                  : 'Type a message to override AI and send manually...'
              }
              className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3535FF] focus:bg-white resize-none"
              rows={2}
            />
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="bg-[#3535FF] hover:bg-[#2828DD] disabled:opacity-50 text-white px-4 sm:px-6 py-3 rounded-full text-sm font-semibold transition-colors shrink-0"
            >
              {sending ? '...' : manualMode === 'voice' ? 'Voice' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {isResolved && (
        <div className="border-t border-gray-100 px-4 py-3 text-center text-xs text-gray-500 shrink-0">
          This conversation is resolved. Click "Reopen" to continue messaging.
        </div>
      )}
    </div>
  );
}
