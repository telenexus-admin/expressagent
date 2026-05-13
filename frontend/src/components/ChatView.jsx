import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';

const BUBBLE = {
  user: {
    wrap: 'justify-start',
    bubble: 'bg-white border border-gray-200 text-gray-900 rounded-tl-sm',
    label: 'text-gray-500',
  },
  assistant: {
    wrap: 'justify-end',
    bubble: 'bg-green-500 text-white rounded-tr-sm',
    label: 'text-green-600',
  },
  admin: {
    wrap: 'justify-end',
    bubble: 'bg-blue-500 text-white rounded-tr-sm',
    label: 'text-blue-600',
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

  // Reset and load when conversation changes
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

  // Poll messages every 5s for new incoming WhatsApp replies
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [id, fetchMessages]);

  // Scroll to bottom on new messages
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
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <div className="text-6xl mb-4 opacity-30">💬</div>
          <p className="text-lg font-medium">Select a conversation</p>
          <p className="text-sm mt-1">Choose a conversation from the sidebar to get started</p>
        </div>
      </div>
    );
  }

  const isResolved = conversation?.status === 'resolved';
  const isHuman = conversation?.status === 'human_takeover';

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-0">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold text-sm">
            {conversation?.customer_phone?.slice(-2) || '?'}
          </div>
          <div>
            <div className="font-semibold text-sm text-gray-900">
              {conversation?.customer_phone || '...'}
            </div>
            {conversation && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isResolved
                    ? 'bg-gray-100 text-gray-500'
                    : isHuman
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {isHuman ? 'Human Takeover' : isResolved ? 'Resolved' : 'AI Active'}
              </span>
            )}
          </div>
        </div>

        {conversation && (
          <div className="flex gap-2">
            {!isHuman && !isResolved && (
              <button
                onClick={() => updateStatus('human_takeover')}
                disabled={statusLoading}
                className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Take Over
              </button>
            )}
            {isHuman && (
              <button
                onClick={() => updateStatus('active')}
                disabled={statusLoading}
                className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Hand Back to AI
              </button>
            )}
            {!isResolved && (
              <button
                onClick={() => updateStatus('resolved')}
                disabled={statusLoading}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Resolve
              </button>
            )}
            {isResolved && (
              <button
                onClick={() => updateStatus('active')}
                disabled={statusLoading}
                className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Reopen
              </button>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">No messages yet</p>
        )}
        {messages.map((msg) => {
          const style = BUBBLE[msg.role] || BUBBLE.user;
          return (
            <div key={msg.id} className={`flex ${style.wrap}`}>
              <div className="max-w-[70%]">
                <div className={`text-xs mb-1 ${style.label} ${msg.role !== 'user' ? 'text-right' : ''}`}>
                  {msg.role === 'user'
                    ? 'Customer'
                    : msg.role === 'assistant'
                    ? 'AI Assistant'
                    : `Admin — ${msg.sender_name || 'Unknown'}`}
                </div>
                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${style.bubble}`}>
                  {msg.content}
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
        <div className="mx-4 mb-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Reply input */}
      {!isResolved && (
        <div className="bg-white border-t border-gray-200 p-3 shrink-0">
          {isHuman && (
            <div className="text-xs text-orange-600 mb-2 flex items-center gap-1">
              <span>●</span>
              <span>Human takeover active — your replies are sent directly to the customer</span>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isHuman
                  ? 'Type your reply... (Enter to send)'
                  : 'Type a message to override AI and send manually...'
              }
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              rows={2}
            />
            <button
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors self-end"
            >
              {sending ? '...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {isResolved && (
        <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 text-center text-xs text-gray-500 shrink-0">
          This conversation is resolved. Click "Reopen" to continue messaging.
        </div>
      )}
    </div>
  );
}
