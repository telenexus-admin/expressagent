import React, { useState, useEffect } from 'react';
import { Outlet, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import ConversationList from '../components/ConversationList';

export default function Conversations() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const headerSearch = searchParams.get('search') || '';
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
    <div className="dashboard-conversations flex w-full h-full overflow-hidden bg-transparent">
      <div
        className={`${
          hasOpenChat
            ? 'hidden md:flex md:flex-col md:w-[360px] md:shrink-0 border-r border-[#dfe5f2]'
            : 'flex flex-col flex-1'
        }`}
      >
        <div className="flex-1 min-h-0">
          <ConversationList conversations={conversations} compact={hasOpenChat} initialSearch={headerSearch} />
        </div>
      </div>

      {hasOpenChat ? (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <Outlet context={{ conversations, refetch: fetchConversations }} />
        </div>
      ) : null}
    </div>
  );
}
