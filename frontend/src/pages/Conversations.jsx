import React, { useState, useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import api from '../utils/api';
import ConversationList from '../components/ConversationList';

export default function Conversations() {
  const { id } = useParams();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = async () => {
    try {
      const { data } = await api.get('/conversations');
      setConversations(data);
    } catch (err) {
      if (err.response?.status !== 401) {
        console.error('Failed to fetch conversations:', err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, []);

  const hasOpenChat = Boolean(id);

  return (
    <div className="flex w-full h-full overflow-hidden">
      {/* List column — full-width on mobile when no chat open; hidden on mobile when chat open; always visible on md+ */}
      <div
        className={`border-r border-gray-100 ${
          hasOpenChat
            ? 'hidden md:flex md:flex-col md:w-80 md:shrink-0'
            : 'flex flex-col flex-1'
        }`}
      >
        {!hasOpenChat && (
          <div className="px-5 pt-6 pb-2 shrink-0">
            <h1 className="text-2xl font-bold text-gray-900">Conversations</h1>
            <p className="text-sm text-gray-500 mt-1">
              {loading ? 'Loading...' : `${conversations.length} total`}
            </p>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ConversationList conversations={conversations} compact={hasOpenChat} />
        </div>
      </div>

      {/* Chat panel — full-width on mobile when chat open */}
      {hasOpenChat ? (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <Outlet context={{ conversations, refetch: fetchConversations }} />
        </div>
      ) : null}
    </div>
  );
}
