import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
  AgentIcon,
  BriefcaseIcon,
  ChartIcon,
  ChatIcon,
  CloseIcon,
  DotsVerticalIcon,
  FlowIcon,
  HomeIcon,
  LifebuoyIcon,
  LogoutIcon,
  MenuIcon,
  CogIcon,
  PulseIcon,
  TicketIcon,
  UsersIcon,
  WarningIcon,
  WrenchIcon,
} from '../components/Icons';
import GlobalConversationSearch from '../components/GlobalConversationSearch';
import DashboardHelpBot from '../components/DashboardHelpBot';
import expressnetLogo from '../assets/expressnetLogo';
import aiBotArtwork from '../assets/aiBotArtwork';
import nexaLogo from '../assets/nexa-logo.png';

const NexaMark = () => (
  <img src={nexaLogo} alt="Nexa" className="h-full w-full object-contain" />
);

function canAccess(admin, permission) {
  if (!admin) return false;
  if (permission === 'settings' || permission === 'billing' || permission === 'communication') return true;
  if (admin.role === 'superadmin') return true;
  if (!Array.isArray(admin.permissions) || admin.permissions.length === 0) return true;
  return admin.permissions.includes(permission);
}

function Brand({ expressnet, compact = false }) {
  if (expressnet) {
    return (
      <div className={`bg-white rounded-2xl shadow-lg shadow-black/10 ${compact ? 'px-2.5 py-2 max-w-[184px]' : 'px-3 py-3 w-full'}`}>
        <img src={expressnetLogo} alt="ExpressNet Solutions" className="w-full h-auto object-contain" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <div className={`${compact ? 'w-11 h-11' : 'w-12 h-12'} flex items-center justify-center shrink-0`}><NexaMark /></div>
      <div><div className={`${compact ? 'text-lg' : 'text-2xl'} font-black text-[#0d1438] dashboard-brand-title`}>Nexa</div>{!compact && <div className="text-xs font-semibold text-[#7b84a8] dashboard-muted">AI Support Portal</div>}</div>
    </div>
  );
}

function AiSidebarHero({ compact = false }) {
  return (
    <div className={`${compact ? 'mx-4 mb-3 h-[94px]' : 'mx-5 mb-5 h-[138px]'} dashboard-ai-card relative shrink-0 overflow-hidden rounded-[20px] border border-[#dbe5ff] bg-gradient-to-br from-[#eef6ff] via-[#f6f1ff] to-[#e9f2ff] shadow-[0_16px_34px_rgba(80,83,140,0.12)]`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(53,108,255,0.18),transparent_18%),radial-gradient(circle_at_90%_15%,rgba(124,58,237,0.18),transparent_22%)]" />
      <img
        src={aiBotArtwork}
        alt="Nexa AI assistant"
        className={`${compact ? 'h-[112px] -bottom-8 right-4' : 'h-[150px] -bottom-9 right-1'} absolute z-10 w-auto max-w-none object-contain drop-shadow-[0_12px_18px_rgba(48,90,180,0.25)]`}
      />
      {!compact && (
        <div className="absolute bottom-5 left-5 z-20">
          <p className="text-lg font-black tracking-wide text-[#2086ff]">NEXA AI</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#121a3d]"><span className="h-2.5 w-2.5 rounded-full bg-[#6d35ff]" />Always ready to assist</p>
        </div>
      )}
    </div>
  );
}

export default function ClientDashboard() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [badges, setBadges] = useState({ conversations: 0, tickets: 0, escalations: 0, installations: 0, complaints: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const expressnet = Number(admin?.client_id) === 1;

  useEffect(() => {
    let stopped = false;
    async function loadBadges() {
      try {
        const [conv, tickets, human, install, complaint] = await Promise.all([
          api.get('/conversations'),
          api.get('/tickets/summary'),
          api.get('/escalations?status=open&type=human'),
          api.get('/escalations?status=open&type=installation'),
          api.get('/escalations?status=open&type=complaint'),
        ]);
        if (!stopped) setBadges({
          conversations: conv.data.filter((item) => item.status === 'active' || item.status === 'human_takeover').length,
          tickets: tickets.data.active || 0,
          escalations: human.data.length,
          installations: install.data.length,
          complaints: complaint.data.length,
        });
      } catch (error) {
        if (error.response?.status !== 401) console.error('Failed to fetch sidebar badges:', error.message);
      }
    }
    loadBadges();
    const timer = setInterval(loadBadges, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const keydown = (event) => {
      if (event.key === 'Escape') { setDrawerOpen(false); setMenuOpen(false); }
    };
    const outside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('mousedown', outside);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('mousedown', outside); };
  }, []);

  const navSections = [
    {
      label: 'Overview',
      items: [
        ['/dashboard/statistics', 'Dashboard', HomeIcon, 'statistics'],
      ],
    },
    {
      label: 'Inbox',
      items: [
          ['/dashboard/conversations', 'Conversations', ChatIcon, 'conversations', badges.conversations],
          ['/dashboard/tickets', 'Tickets', TicketIcon, 'tickets', badges.tickets],
          ['/dashboard/invoices', 'Invoice Management', ChartIcon, 'invoices'],
          ['/dashboard/billing', 'Billing', ChartIcon, 'billing'],
        ['/dashboard/escalations', 'Human Handover', LifebuoyIcon, 'escalations', badges.escalations],
        ['/dashboard/installations', 'Installations', WrenchIcon, 'installations', badges.installations],
        ['/dashboard/complaints', 'Complaints', WarningIcon, 'complaints', badges.complaints],
      ],
    },
    {
      label: 'Agent',
      items: [
        ['/dashboard/agent', 'Agent Configuration', AgentIcon, 'agent'],
        ['/dashboard/sms-settings', 'SMS Provider', AgentIcon, 'agent'],
        ['/dashboard/workflow', 'Workflow', FlowIcon, 'workflow'],
        ['/dashboard/ai-health', 'AI Health', PulseIcon, 'ai_health'],
        ['/dashboard/reports', 'Daily Reports', ChartIcon, 'statistics'],
        ['/dashboard/remarks', 'AI Client Remarks', ChatIcon, 'complaints'],
      ],
    },
    {
      label: 'Team',
      items: [
        ['/dashboard/employees', 'Employees', BriefcaseIcon, 'employees'],
        ['/dashboard/admins', 'Admin Management', UsersIcon, 'admins'],
        ['/dashboard/logs', 'Activity Logs', ChartIcon, 'logs'],
        ['/dashboard/communication', 'Communication', ChatIcon, 'communication'],
        ['/dashboard/settings', 'Settings', CogIcon, 'settings'],
      ],
    },
  ].map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccess(admin, item[3])),
  })).filter((section) => section.items.length > 0);
  const nav = navSections.flatMap((section) => section.items);

  const active = (path) => (path === '/dashboard/statistics' && location.pathname === '/dashboard') || location.pathname === path || location.pathname.startsWith(`${path}/`);
  const title = nav.find((item) => active(item[0]))?.[1] || 'Dashboard';
  const signOut = () => { logout(); navigate('/login'); };

  const itemButton = (item, mobile = false) => {
    const [path, label, Icon, , badge] = item;
    const selected = active(path);
    return (
      <button key={path} onClick={() => { navigate(path); setDrawerOpen(false); }} className={`dashboard-nav-item group relative w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${selected ? 'dashboard-nav-active text-white font-black' : 'text-[#20284d] hover:bg-[#f4f1ff]'}`}>
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-white/16 text-white' : 'bg-[#f2f4fb] text-[#273459]'}`}><Icon className="w-5 h-5" /></span>
        <span className="flex-1 text-left truncate">{label}</span>
        {badge > 0 && <span className={`text-[10px] font-black rounded-full min-w-[24px] h-6 flex items-center justify-center px-2 ${selected ? 'bg-white/20 text-white' : 'bg-[#7c35ff] text-white'}`}>{badge > 99 ? '99+' : badge}</span>}
      </button>
    );
  };
  const navList = (mobile = false) => navSections.map((section) => (
    <div key={section.label} className="space-y-1">
      <div className="px-4 pt-4 pb-2 text-[11px] font-black uppercase tracking-[0.16em] text-[#98a0bd] dashboard-section-label">
        {section.label}
      </div>
      {section.items.map((item) => itemButton(item, mobile))}
    </div>
  ));

  return (
    <div className="dashboard-shell h-screen overflow-hidden bg-[#f7f9fd] text-slate-900">
      <div className="flex h-full min-h-0 gap-3 p-2">
        <aside className={`${sidebarOpen ? 'lg:flex' : 'lg:hidden'} dashboard-sidebar hidden w-[330px] shrink-0 flex-col overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_18px_46px_rgba(31,41,80,0.08)] z-20`}>
          <div className={expressnet ? 'px-6 pt-6 pb-5' : 'px-7 pt-6 pb-5'}><Brand expressnet={expressnet} /></div>
          <AiSidebarHero />
          <nav className="no-visible-scrollbar flex-1 overflow-y-auto px-5 pb-4">{navList()}</nav>
          <div className="mx-5 mb-5 rounded-2xl border border-[#e2e7f4] bg-[#f8f6ff] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ede6ff] text-[#6535ff]"><LifebuoyIcon className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1"><div className="text-sm font-black text-[#0d1438] dashboard-brand-title">Need help?</div><div className="mt-0.5 text-xs font-semibold text-[#637091] dashboard-muted">Visit our help center</div></div>
              <span className="text-[#6d35ff]">&gt;</span>
            </div>
          </div>
        </aside>

        <section className="dashboard-main flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_18px_46px_rgba(31,41,80,0.08)]">
          <header className="h-[86px] shrink-0 px-4 sm:px-7 lg:px-10 flex items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={() => setDrawerOpen(true)} className="lg:hidden w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-600"><MenuIcon className="w-6 h-6" /></button>
              <button onClick={() => setSidebarOpen((value) => !value)} className="hidden lg:flex w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm items-center justify-center text-[#263150] hover:text-[#6d35ff]"><MenuIcon className="w-5 h-5" /></button>
              <div className="min-w-0"><h1 className="text-2xl font-black truncate text-[#0d1438] dashboard-brand-title">{title}</h1><p className="text-xs font-semibold text-[#8a94b8] mt-1 truncate dashboard-muted">Monitor support, installations, complaints and AI performance.</p></div>
            </div>
            <div className="flex items-center gap-4"><GlobalConversationSearch /><div className="relative" ref={menuRef}><button onClick={() => setMenuOpen(!menuOpen)} className="w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm flex items-center justify-center text-[#667092]"><DotsVerticalIcon className="w-5 h-5" /></button>{menuOpen && <div className="absolute right-0 top-14 w-64 bg-white rounded-[24px] shadow-2xl py-2 z-30 border border-slate-100"><div className="px-5 py-3 border-b border-gray-100"><div className="text-sm font-black truncate">{admin?.name}</div><div className="text-xs text-gray-500 capitalize">{admin?.role}</div></div><button onClick={signOut} className="w-full flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50"><LogoutIcon className="w-4 h-4" />Sign out</button></div>}</div></div>
          </header>
          <main className="flex-1 min-h-0 px-4 sm:px-7 lg:px-10 pb-7 overflow-hidden"><div className="dashboard-content h-full min-h-0 overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_14px_34px_rgba(31,41,80,0.06)] flex flex-col"><Outlet /></div></main>
          <DashboardHelpBot />
        </section>
      </div>

      <div className={`fixed inset-0 z-40 bg-black/50 lg:hidden ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`fixed inset-y-0 left-0 z-50 w-80 max-w-[88vw] bg-white text-[#0d1438] flex flex-col shadow-2xl transition-transform lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 pt-5 pb-3 border-b border-[#e2e7f4] flex items-center justify-between gap-3"><Brand expressnet={expressnet} compact /><button onClick={() => setDrawerOpen(false)} className="w-9 h-9 flex items-center justify-center text-[#263150]"><CloseIcon className="w-5 h-5" /></button></div>
        <AiSidebarHero compact />
        <nav className="no-visible-scrollbar flex-1 overflow-y-auto px-4 py-3 pb-6">{navList(true)}</nav>
      </aside>
    </div>
  );
}
