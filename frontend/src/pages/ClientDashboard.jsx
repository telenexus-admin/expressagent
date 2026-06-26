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
  QuestionIcon,
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
  <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#13c8ff] via-[#3455ff] to-[#812fff] shadow-[0_8px_18px_rgba(53,53,255,0.18)]">
    <span className="absolute left-2 top-2 h-7 w-2 rotate-[-28deg] rounded-full bg-white/90" />
    <span className="absolute left-5 top-2 h-7 w-2 rotate-[-28deg] rounded-full bg-cyan-200/90" />
    <span className="absolute right-2.5 top-2 h-7 w-2 rotate-[-28deg] rounded-full bg-white/80" />
    <span className="absolute bottom-1 right-1 rounded-full bg-white px-1 text-[7px] font-black leading-3 text-[#3a35ff]">AI</span>
    <img
      src={nexaLogo}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      onError={(event) => { event.currentTarget.style.display = 'none'; }}
    />
  </span>
);

const BellIcon = ({ className = 'h-6 w-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  </svg>
);

const ChevronDownIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function canAccess(admin, permission) {
  if (!admin) return false;
  if (permission === 'inventory') return true;
  if (permission === 'documentation') return true;
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
      <div className={`${compact ? 'w-10 h-10' : 'w-11 h-11'} flex items-center justify-center shrink-0`}><NexaMark /></div>
      <div><div className={`${compact ? 'text-lg' : 'text-2xl'} font-extrabold text-[#0d1438] dashboard-brand-title`}>Nexa</div>{!compact && <div className="text-sm font-medium text-[#7b84a8] dashboard-muted">AI Support Portal</div>}</div>
    </div>
  );
}

function AiSidebarHero({ compact = false }) {
  return (
    <div className={`${compact ? 'mx-4 mb-2 h-[78px]' : 'mx-4 mb-3 h-[106px]'} dashboard-ai-card relative shrink-0 overflow-hidden rounded-[18px] border border-[#dbe5ff] bg-gradient-to-br from-[#eef6ff] via-[#f6f1ff] to-[#e9f2ff] shadow-[0_12px_26px_rgba(80,83,140,0.1)]`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(53,108,255,0.18),transparent_18%),radial-gradient(circle_at_90%_15%,rgba(124,58,237,0.18),transparent_22%)]" />
      {!compact && (
        <div className="absolute left-5 top-4 z-20 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg">
            <NexaMark />
          </span>
          <div>
            <p className="text-xs font-extrabold leading-4 text-[#0d1438] dashboard-brand-title">Nexa</p>
            <p className="text-[10px] font-medium leading-3 text-[#6d7697] dashboard-muted">AI Support Portal</p>
          </div>
        </div>
      )}
      <img
        src={aiBotArtwork}
        alt="Nexa AI assistant"
        className={`${compact ? 'h-[92px] -bottom-7 right-4' : 'h-[118px] -bottom-7 right-1'} absolute z-10 w-auto max-w-none object-contain drop-shadow-[0_12px_18px_rgba(48,90,180,0.22)]`}
      />
      {!compact && (
        <div className="absolute bottom-4 left-4 z-20">
          <p className="text-base font-black tracking-wide text-[#2086ff]">NEXA AI</p>
          <p className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-[#121a3d]"><span className="h-2.5 w-2.5 rounded-full bg-[#6d35ff]" />Always ready to assist</p>
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
  const [expandedGroups, setExpandedGroups] = useState({ operations: true });
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

  const active = (path) => (path === '/dashboard/statistics' && location.pathname === '/dashboard') || location.pathname === path || location.pathname.startsWith(`${path}/`);

  const navSections = [
    {
      key: 'operations',
      label: 'Operations',
      icon: HomeIcon,
      items: [
        ['/dashboard/statistics', 'Dashboard', HomeIcon, 'statistics'],
        ['/dashboard/conversations', 'Conversations', ChatIcon, 'conversations', badges.conversations],
        ['/dashboard/tickets', 'Tickets', TicketIcon, 'tickets', badges.tickets],
        ['/dashboard/escalations', 'Human Handover', LifebuoyIcon, 'escalations', badges.escalations],
        ['/dashboard/installations', 'Installations', WrenchIcon, 'installations', badges.installations],
        ['/dashboard/complaints', 'Complaints', WarningIcon, 'complaints', badges.complaints],
      ],
    },
    {
      key: 'sales',
      label: 'Sales & Billing',
      icon: ChartIcon,
      items: [
        ['/dashboard/invoices', 'Invoice Management', ChartIcon, 'invoices'],
        ['/dashboard/inventory', 'Inventory', WrenchIcon, 'inventory'],
        ['/dashboard/billing', 'Billing', ChartIcon, 'billing'],
      ],
    },
    {
      key: 'agent',
      label: 'AI Agent',
      icon: AgentIcon,
      items: [
        ['/dashboard/agent', 'Agent Configuration', AgentIcon, 'agent'],
        ['/dashboard/knowledge-base', 'Knowledge Base', PulseIcon, 'agent'],
        ['/dashboard/sms-settings', 'SMS Provider', AgentIcon, 'agent'],
        ['/dashboard/workflow', 'Workflow', FlowIcon, 'workflow'],
        ['/dashboard/ai-health', 'AI Health', PulseIcon, 'ai_health'],
        ['/dashboard/reports', 'Daily Reports', ChartIcon, 'statistics'],
        ['/dashboard/remarks', 'AI Client Remarks', ChatIcon, 'complaints'],
      ],
    },
    {
      key: 'communication',
      label: 'Communication',
      icon: ChatIcon,
      items: [
        ['/dashboard/communication', 'Communication', ChatIcon, 'communication'],
      ],
    },
    {
      key: 'administration',
      label: 'Administration',
      icon: UsersIcon,
      items: [
        ['/dashboard/employees', 'Employees', BriefcaseIcon, 'employees'],
        ['/dashboard/admins', 'Admin Management', UsersIcon, 'admins'],
        ['/dashboard/logs', 'Activity Logs', ChartIcon, 'logs'],
      ],
    },
    {
      key: 'system',
      label: 'System',
      icon: CogIcon,
      items: [
        ['/dashboard/settings', 'Settings', CogIcon, 'settings'],
        ['/dashboard/documentation', 'Documentation', QuestionIcon, 'documentation'],
      ],
    },
  ].map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccess(admin, item[3])),
  })).filter((section) => section.items.length > 0);
  const nav = navSections.flatMap((section) => section.items);

  useEffect(() => {
    const activeSection = navSections.find((section) => section.items.some((item) => active(item[0])));
    if (activeSection) {
      setExpandedGroups((current) => ({ ...current, [activeSection.key]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navSections.length]);

  const title = nav.find((item) => active(item[0]))?.[1] || 'Dashboard';
  const showConversationSearch = location.pathname.startsWith('/dashboard/conversations');
  const signOut = () => { logout(); navigate('/login'); };
  const toggleGroup = (key) => setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));

  const itemButton = (item, mobile = false) => {
    const [path, label, Icon, , badge] = item;
    const selected = active(path);
    return (
      <button key={path} onClick={() => { navigate(path); setDrawerOpen(false); }} className={`dashboard-nav-item group relative w-full flex items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-all ${selected ? 'dashboard-nav-active text-white font-black' : 'text-[#20284d] hover:bg-[#f4f1ff]'}`}>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-white/16 text-white' : 'bg-[#f2f4fb] text-[#273459]'}`}><Icon className="w-4 h-4" /></span>
        <span className="flex-1 text-left truncate">{label}</span>
        {badge > 0 && <span className={`text-[10px] font-black rounded-full min-w-[24px] h-6 flex items-center justify-center px-2 ${selected ? 'bg-white/20 text-white' : 'bg-[#7c35ff] text-white'}`}>{badge > 99 ? '99+' : badge}</span>}
      </button>
    );
  };
  const navList = (mobile = false) => navSections.map((section) => (
    <div key={section.key} className="space-y-1">
      <button
        type="button"
        onClick={() => toggleGroup(section.key)}
        className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-sm font-black text-[#20284d] transition hover:bg-[#f4f1ff]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eef2fb] text-[#273459]">
          <section.icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronDownIcon className={`h-4 w-4 text-[#8a93ad] transition ${expandedGroups[section.key] ? 'rotate-180' : ''}`} />
      </button>
      {expandedGroups[section.key] && (
        <div className="ml-4 space-y-1 border-l border-[#e5eaf5] pl-3">
          {section.items.map((item) => itemButton(item, mobile))}
        </div>
      )}
    </div>
  ));

  return (
    <div className="dashboard-shell h-screen overflow-hidden bg-[#f7f9fd] text-slate-900">
      <div className="flex h-full min-h-0 gap-3 p-2">
        <aside className={`${sidebarOpen ? 'lg:flex' : 'lg:hidden'} dashboard-sidebar hidden w-[330px] shrink-0 flex-col overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_18px_46px_rgba(31,41,80,0.08)] z-20`}>
          {expressnet && <div className="px-6 pt-6 pb-5"><Brand expressnet={expressnet} /></div>}
          {!expressnet && <div className="h-4 shrink-0" />}
          <AiSidebarHero />
          <nav className="no-visible-scrollbar flex-1 overflow-y-auto px-4 pb-4">{navList()}</nav>
        </aside>

        <section className="dashboard-main flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_18px_46px_rgba(31,41,80,0.08)]">
          <header className="h-[96px] shrink-0 px-4 sm:px-7 lg:px-10 flex items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={() => setDrawerOpen(true)} className="lg:hidden w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-600"><MenuIcon className="w-6 h-6" /></button>
              <button onClick={() => setSidebarOpen((value) => !value)} className="hidden lg:flex w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm items-center justify-center text-[#263150] hover:text-[#6d35ff]"><MenuIcon className="w-5 h-5" /></button>
              <div className="min-w-0"><h1 className="truncate text-2xl font-extrabold tracking-normal text-[#0d1438] dashboard-brand-title">{title}</h1><p className="mt-1 truncate text-xs font-medium text-[#6d7697] dashboard-muted">Monitor support, installations, complaints and AI performance.</p></div>
            </div>
            <div className="flex items-center gap-4">
              {showConversationSearch && <GlobalConversationSearch />}
              <button
                type="button"
                onClick={() => navigate('/dashboard/conversations')}
                title={`${badges.conversations || 0} new messages`}
                className="relative hidden h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#263150] sm:flex"
              >
                <BellIcon />
                {badges.conversations > 0 && <span className="absolute right-2 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#5b22f5] px-1 text-[10px] font-black text-white">{badges.conversations > 99 ? '99+' : badges.conversations}</span>}
              </button>
              <div className="hidden items-center gap-3 lg:flex">
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[#80d9ff] bg-[#f0f8ff] text-sm font-extrabold text-[#0d1438]">
                  {(admin?.name || 'Nexa Admin').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'NA'}
                  <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />
                </span>
                <div className="min-w-[112px]">
                  <div className="truncate text-sm font-extrabold text-[#0d1438]">{admin?.name || 'Nexa Admin'}</div>
                  <div className="truncate text-xs font-medium capitalize text-[#6d7697]">{admin?.role || 'Administrator'}</div>
                </div>
              </div>
              <div className="relative" ref={menuRef}><button onClick={() => setMenuOpen(!menuOpen)} className="w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm flex items-center justify-center text-[#667092]"><span className="hidden lg:block"><ChevronDownIcon className="h-5 w-5" /></span><span className="lg:hidden"><DotsVerticalIcon className="w-5 h-5" /></span></button>{menuOpen && <div className="absolute right-0 top-14 w-64 bg-white rounded-[24px] shadow-2xl py-2 z-30 border border-slate-100"><div className="px-5 py-3 border-b border-gray-100"><div className="text-sm font-black truncate">{admin?.name}</div><div className="text-xs text-gray-500 capitalize">{admin?.role}</div></div><button onClick={signOut} className="w-full flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50"><LogoutIcon className="w-4 h-4" />Sign out</button></div>}</div>
            </div>
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
