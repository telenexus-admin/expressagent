import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import ConversationList from '../components/ConversationList';

export default function Dashboard() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState([]);

  const fetchConversations = async () => {
    try {
      const { data } = await api.get('/conversations');
      setConversations(data);
    } catch (err) {
      if (err.response?.status !== 401) {
        console.error('Failed to fetch conversations:', err.message);
      }
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path) => location.pathname.startsWith(path);

  const activeCount = conversations.filter((c) => c.status === 'active').length;
  const humanCount = conversations.filter((c) => c.status === 'human_takeover').length;
  const resolvedCount = conversations.filter((c) => c.status === 'resolved').length;
  const urgentCount = activeCount + humanCount;

  const navItem = (path, label, icon) => (
    <button
      onClick={() => navigate(path)}
      className={`group w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all ${
        isActive(path)
          ? 'bg-white text-[#3b168f] shadow-lg shadow-black/10 font-semibold'
          : 'text-white/75 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span
        className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${
          isActive(path) ? 'bg-[#ede7ff]' : 'bg-white/10 group-hover:bg-white/15'
        }`}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );

  const statCard = (label, value, icon, gradient, note) => (
    <div className={`relative overflow-hidden rounded-[24px] ${gradient} text-white p-5 shadow-xl shadow-slate-200/70`}>
      <div className="absolute -right-6 -top-8 w-28 h-28 bg-white/15 rounded-full" />
      <div className="absolute right-8 bottom-3 w-16 h-16 bg-white/10 rounded-full" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-white/80 text-xs font-medium">{label}</p>
          <p className="text-3xl font-black tracking-tight mt-2">{value}</p>
          <p className="text-[11px] text-white/75 mt-2">{note}</p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-white/18 border border-white/20 flex items-center justify-center text-xl">
          {icon}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f2f8] text-slate-900">
      <aside className="w-[292px] bg-gradient-to-b from-[#4b16b5] via-[#3f1499] to-[#2b0b72] text-white rounded-r-[38px] flex flex-col shrink-0 shadow-2xl shadow-purple-900/25 z-10">
        <div className="px-7 pt-7 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-[#4b16b5] shadow-xl shadow-black/10">
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347" />
              </svg>
            </div>
            <div>
              <div className="font-black text-xl tracking-tight">ExpressAgent</div>
              <div className="text-xs text-white/55">AI Support Console</div>
            </div>
          </div>
        </div>

        <nav className="px-5 space-y-2">
          {navItem('/dashboard', 'Dashboard', '⌂')}
          {admin?.role === 'superadmin' && navItem('/dashboard/admins', 'Admin Management', '👥')}
          {navItem('/dashboard/settings', 'AI Settings', '⚙️')}
        </nav>

        <div className="px-7 pt-7 pb-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-white/45 uppercase tracking-[0.18em]">Inbox</span>
          {urgentCount > 0 && (
            <span className="bg-[#8acb38] text-white text-xs font-black rounded-full min-w-[24px] h-6 flex items-center justify-center px-2 shadow-lg shadow-black/15">
              {urgentCount > 99 ? '99+' : urgentCount}
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0 px-4 pb-4">
          <ConversationList conversations={conversations} />
        </div>

        <div className="px-5 pb-5">
          <div className="rounded-[24px] bg-white/10 border border-white/10 p-4 mb-3">
            <div className="text-sm font-bold truncate">{admin?.name}</div>
            <div className="text-xs text-white/55 capitalize">{admin?.role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm text-white/75 bg-white/10 hover:bg-red-500 hover:text-white transition-all"
          >
            <span>↪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="px-8 pt-7 pb-5 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-4">
            <button className="w-11 h-11 rounded-2xl bg-white shadow-sm text-slate-500 flex items-center justify-center hover:text-[#4b16b5] transition-colors">
              ☰
            </button>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">Dashboard</h1>
              <p className="text-xs text-slate-400 mt-1">Monitor AI replies, human takeover and client conversations.</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center w-[320px] bg-white rounded-full px-5 py-3 shadow-sm border border-slate-100">
              <input
                readOnly
                value="Search something here..."
                className="bg-transparent text-xs text-slate-400 outline-none flex-1"
              />
              <span className="text-slate-300">⌕</span>
            </div>
            <div className="hidden sm:flex items-center gap-3 bg-white rounded-full pl-2 pr-4 py-2 shadow-sm border border-slate-100">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#4b16b5] to-[#9f5bff] text-white flex items-center justify-center font-black">
                {admin?.name?.charAt(0) || 'A'}
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">{admin?.name}</div>
                <div className="text-[10px] text-slate-400 capitalize">{admin?.role}</div>
              </div>
            </div>
          </div>
        </header>

        <section className="px-8 pb-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 shrink-0">
          {statCard('Total Conversations', conversations.length, '💬', 'bg-gradient-to-br from-[#5b35e5] to-[#3922c9]', 'All WhatsApp chats')}
          {statCard('AI Active', activeCount, '🤖', 'bg-gradient-to-br from-[#35a8ee] to-[#2b8dd6]', 'Auto replies enabled')}
          {statCard('Human Takeover', humanCount, '👤', 'bg-gradient-to-br from-[#17cf87] to-[#12a967]', 'Needs admin attention')}
          {statCard('Resolved', resolvedCount, '✓', 'bg-gradient-to-br from-[#8dcc3f] to-[#6bbd32]', 'Closed conversations')}
        </section>

        <div className="flex-1 min-h-0 px-8 pb-8">
          <div className="h-full overflow-hidden rounded-[32px] bg-white shadow-2xl shadow-slate-200/80 border border-white">
            <Outlet context={{ conversations, refetch: fetchConversations }} />
          </div>
        </div>
      </main>
    </div>
  );
}
