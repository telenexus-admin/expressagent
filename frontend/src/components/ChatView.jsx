import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';

const BUBBLE = {
  user: {
    wrap: 'justify-start',
    bubble: 'bg-[#f7f7fb] border border-slate-100 text-slate-900 rounded-tl-md',
    label: 'text-slate-400',
  },
  assistant: {
    wrap: 'justify-end',
    bubble: 'bg-gradient-to-br from-[#4b16b5] to-[#7a35ff] text-white rounded-tr-md shadow-lg shadow-purple-200/60',
    label: 'text-[#6b43d6]',
  },
  admin: {
    wrap: 'justify-end',
    bubble: 'bg-gradient-to-br from-[#1fa2ff] to-[#1274d7] text-white rounded-tr-md shadow-lg shadow-blue-200/60',
    label: 'text-blue-500',
  },
};

function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatView() {
  const { id } = useParams();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const prevIdRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/conversations/${id}/messages`);
      setMessages(data);
    } catch {
      // silent — poll will retry
    }
  }, [id]);

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/conversations/${id}/reply`, { message: text });
      setReply('');
      await fetchMessages();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSending(false);
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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  };

  if (!id) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-white to-[#f7f4ff]">
        <div className="text-center max-w-sm px-6">
          <div className="mx-auto w-24 h-24 rounded-[32px] bg-gradient-to-br from-[#4b16b5] to-[#8d4dff] text-white flex items-center justify-center text-5xl shadow-2xl shadow-purple-200 mb-6">
            💬
          </div>
          <p className="text-2xl font-black text-slate-900">Select a conversation</p>
          <p className="text-sm mt-2 text-slate-400 leading-relaxed">Choose a customer from the purple sidebar to view messages, take over, or hand back to AI.</p>
        </div>
      </div>
    );
  }

  const isResolved = conversation?.status === 'resolved';
  const isHuman = conversation?.status === 'human_takeover';

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-white via-white to-[#f8f5ff] min-h-0">
      <div className="bg-white/90 backdrop-blur border-b border-slate-100 px-6 py-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#4b16b5] to-[#8d4dff] text-white flex items-center justify-center font-black shadow-lg shadow-purple-200">
            {conversation?.customer_phone?.slice(-2) || '?'}
          </div>
          <div>
            <div className="font-black text-base text-slate-900">
              {conversation?.customer_phone || '...'}</div>
            {conversation && (
              <span
                className={`inline-flex mt-1 text-[11px] px-2.5 py-1 rounded-full font-black ${
                  isResolved
                    ? 'bg-slate-100 text-slate-500'
                    : isHuman
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {isHuman ? 'Human Takeover' : isResolved ? 'Resolved' : 'AI Active'}
              </span>
            )}
          </div>
        </div>

        {conversation && (
          <div className="flex gap-2 flex-wrap justify-end">
            {!isHuman && !isResolved && (
              <button
                onClick={() => updateStatus('human_takeover')}
                disabled={statusLoading}
                className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 px-4 py-2 rounded-2xl font-black transition-colors disabled:opacity-50"
              >
                Take Over
              </button>
            )}
            {isHuman && (
              <button
                onClick={() => updateStatus('active')}
                disabled={statusLoading}
                className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-2xl font-black transition-colors disabled:opacity-50"
              >
                Hand Back to AI
              </button>
            )}
            {!isResolved && (
              <button
                onClick={() => updateStatus('resolved')}
                disabled={statusLoading}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-2xl font-black transition-colors disabled:opacity-50"
              >
                Resolve
              </button>
            )}
            {isResolved && (
              <button
                onClick={() => updateStatus('active')}
                disabled={statusLoading}
                className="text-xs bg-[#ede7ff] hover:bg-[#e1d8ff] text-[#4b16b5] px-4 py-2 rounded-2xl font-black transition-colors disabled:opacity-50"
              >
                Reopen
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {messages.length === 0 && (
          <p className="text-center text-slate-400 text-sm mt-8">No messages yet</p>
        )}
        {messages.map((msg) => {
          const style = BUBBLE[msg.role] || BUBBLE.user;
          return (
            <div key={msg.id} className={`flex ${style.wrap}`}>
              <div className="max-w-[72%]">
                <div className={`text-[11px] mb-1.5 font-bold ${style.label} ${msg.role !== 'user' ? 'text-right' : ''}`}>
                  {msg.role === 'user'
                    ? 'Customer'
                    : msg.role === 'assistant'
                    ? 'AI Assistant'
                    : `Admin — ${msg.sender_name || 'Unknown'}`}
                </div>
                <div className={`px-5 py-3 rounded-[22px] text-sm leading-relaxed ${style.bubble}`}>
                  {msg.content}
                </div>
                <div className={`text-[10px] text-slate-300 mt-1.5 ${msg.role !== 'user' ? 'text-right' : ''}`}>
                  {formatTimestamp(msg.timestamp)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mx-6 mb-3 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-2xl text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2 font-black">×</button>
        </div>
      )}

      {!isResolved && (
        <div className="bg-white/90 backdrop-blur border-t border-slate-100 p-4 shrink-0">
          {isHuman && (
            <div className="text-xs text-orange-600 mb-3 flex items-center gap-2 font-bold">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span>Human takeover active — your replies are sent directly to the customer</span>
            </div>
          )}
          <div className="flex gap-3 items-end">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isHuman
                  ? 'Type your reply... (Enter to send)'
                  : 'Type a message to override AI and send manually...'
              }
              className="flex-1 bg-[#f7f7fb] border border-slate-100 rounded-[22px] px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4b16b5]/20 focus:border-[#4b16b5]/30 resize-none"
              rows={2}
            />
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="bg-gradient-to-br from-[#4b16b5] to-[#7a35ff] hover:from-[#3f1499] hover:to-[#6f2cff] disabled:opacity-50 text-white px-6 py-3 rounded-[22px] text-sm font-black transition-all shadow-lg shadow-purple-200"
            >
              {sending ? '...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {isResolved && (
        <div className="bg-slate-50 border-t border-slate-100 px-4 py-4 text-center text-xs text-slate-500 shrink-0">
          This conversation is resolved. Click "Reopen" to continue messaging.
        </div>
      )}
    </div>
  );
}
