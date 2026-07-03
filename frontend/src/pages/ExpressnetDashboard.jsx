import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
  AgentIcon, BoltIcon, BriefcaseIcon, ChartIcon, ChatIcon, CloseIcon, DotsVerticalIcon,
  FlowIcon, HomeIcon, LifebuoyIcon, LogoutIcon, MenuIcon, PulseIcon,
  QuestionIcon, TicketIcon, UsersIcon, WarningIcon, WrenchIcon, CogIcon,
} from '../components/Icons';
import GlobalConversationSearch from '../components/GlobalConversationSearch';
import DashboardHelpBot from '../components/DashboardHelpBot';
import expressnetLogo from '../assets/expressnetLogo';

function canAccess(admin, permission) {
  if (!admin) return false;
  if (permission === 'inventory') return true;
  if (permission === 'documentation') return true;
  if (permission === 'settings' || permission === 'billing' || permission === 'communication') return true;
  if (!Array.isArray(admin.permissions) || admin.permissions.length === 0) return true;
  return admin.permissions.includes(permission);
}

function ExpressnetBrand({ compact = false }) {
  return (
    <div className={`bg-white rounded-2xl shadow-lg shadow-black/10 ${compact ? 'px-2.5 py-2 max-w-[184px]' : 'px-3 py-3 w-full'}`}>
      <img src={expressnetLogo} alt="ExpressNet Solutions" className="w-full h-auto object-contain" />
    </div>
  );
}

const ChevronDownIcon = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export default function ExpressnetDashboard() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const menuRef = useRef(null);
  const [badges, setBadges] = useState({ conversations: 0, tickets: 0, escalations: 0, installations: 0, complaints: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({ operations: true });

  useEffect(() => {
    let stopped = false;
    async function loadBadges() {
      try {
        const [conv, tickets, human, install, complaint] = await Promise.all([
          api.get('/conversations'),
          api.get('/tickets/summary'),
          api.get('/escalations?status=open&type=human'),
          api.get('/escalations?status=open&type=installation'), api.get('/escalations?status=open&type=complaint'),
        ]);
        if (!stopped) setBadges({
          conversations: conv.data.filter((item) => item.status === 'active' || item.status === 'human_takeover').length,
          tickets: tickets.data.active || 0, escalations: human.data.length, installations: install.data.length, complaints: complaint.data.length,
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
    const close = (event) => {
      if (event.key === 'Escape') { setDrawerOpen(false); setMenuOpen(false); }
      if (event.type === 'mousedown' && menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('mousedown', close);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('mousedown', close); };
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
        ['/dashboard/ai-tasks', 'AI Tasks', BoltIcon, 'agent'],
        ['/dashboard/knowledge-base', 'Knowledge Base', PulseIcon, 'agent'],
        ['/dashboard/network-monitor', 'Network Monitor', WrenchIcon, 'agent'],
        ['/dashboard/workflow', 'Workflow', FlowIcon, 'workflow'],
        ['/dashboard/ai-health', 'AI Health', PulseIcon, 'ai_health'],
        ['/dashboard/reports', 'Daily Reports', ChartIcon, 'statistics'],
        ['/dashboard/remarks', 'AI Client Remarks', ChatIcon, 'complaints'],
      ],
    },
    {
      key: 'clients',
      label: 'Clients',
      icon: UsersIcon,
      items: [
        ['/dashboard/mikrotik-clients', 'Clients', UsersIcon, 'agent'],
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
      <button key={path} onClick={() => { navigate(path); setDrawerOpen(false); }} className={`group relative w-full flex items-center gap-3 px-3 py-2 text-sm transition-all ${selected ? `${mobile ? 'rounded-[18px]' : 'sidebar-active-link'} bg-white text-[#42149b] font-black` : 'rounded-[18px] text-white/75 hover:bg-white/10 hover:text-white'}`}>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-[#efe9ff] text-[#4d1ab8]' : 'bg-white/10 text-white/80'}`}><Icon className="w-4 h-4" /></span>
        <span className="flex-1 text-left truncate">{label}</span>
        {badge > 0 && <span className={`text-[10px] font-black rounded-full min-w-[22px] h-6 flex items-center justify-center px-2 ${selected ? 'bg-[#4d1ab8] text-white' : 'bg-white text-[#4d1ab8]'}`}>{badge > 99 ? '99+' : badge}</span>}
      </button>
    );
  };
  const navList = (mobile = false) => navSections.map((section) => (
    <div key={section.key} className="space-y-1">
      <button
        type="button"
        onClick={() => toggleGroup(section.key)}
        className="flex w-full items-center gap-3 rounded-[20px] px-3 py-2 text-sm font-black text-white/85 transition hover:bg-white/10 hover:text-white"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
          <section.icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronDownIcon className={`h-4 w-4 text-white/45 transition ${expandedGroups[section.key] ? 'rotate-180' : ''}`} />
      </button>
      {expandedGroups[section.key] && (
        <div className="ml-4 space-y-1 border-l border-white/10 pl-3">
          {section.items.map((item) => itemButton(item, mobile))}
        </div>
      )}
    </div>
  ));

  return (
    <div className="h-screen overflow-hidden bg-[#f2f0f7] text-slate-900">
      <div className="flex h-full min-h-0">
        <aside className={`${sidebarOpen ? 'lg:flex' : 'lg:hidden'} client-sidebar hidden w-[286px] shrink-0 bg-gradient-to-b from-[#4b16b5] via-[#3d1198] to-[#2a086f] text-white flex-col shadow-2xl shadow-purple-900/25 z-20 overflow-visible`}>
          <div className="px-6 pt-5 pb-5"><ExpressnetBrand /></div>
          <nav className="sidebar-nav flex-1 overflow-y-auto pb-6 pl-5 pr-2">{navList()}</nav>
        </aside>
        <section className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <header className="h-[84px] shrink-0 px-4 sm:px-7 lg:px-9 flex items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={() => setDrawerOpen(true)} className="lg:hidden w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-600"><MenuIcon className="w-6 h-6" /></button>
              <button onClick={() => setSidebarOpen((value) => !value)} className="hidden lg:flex w-11 h-11 rounded-2xl bg-white shadow-sm items-center justify-center text-slate-600 hover:text-[#4b16b5]"><MenuIcon className="w-5 h-5" /></button>
              <div className="min-w-0"><h1 className="text-2xl font-black truncate">{title}</h1><p className="text-xs text-slate-400 mt-1 truncate">Monitor support, installations, complaints and AI performance.</p></div>
            </div>
            <div className="flex items-center gap-4">{showConversationSearch && <GlobalConversationSearch />}<div className="relative" ref={menuRef}><button onClick={() => setMenuOpen(!menuOpen)} className="w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-500"><DotsVerticalIcon className="w-5 h-5" /></button>{menuOpen && <div className="absolute right-0 top-14 w-64 bg-white rounded-[24px] shadow-2xl py-2 z-30 border border-slate-100"><div className="px-5 py-3 border-b border-gray-100"><div className="text-sm font-black truncate">{admin?.name}</div><div className="text-xs text-gray-500 capitalize">{admin?.role}</div></div><button onClick={signOut} className="w-full flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50"><LogoutIcon className="w-4 h-4" />Sign out</button></div>}</div></div>
          </header>
          <main className="flex-1 min-h-0 px-4 sm:px-7 lg:px-9 pb-7 overflow-hidden"><div className="h-full min-h-0 rounded-[34px] overflow-hidden bg-white shadow-2xl shadow-slate-200/70 border border-white flex flex-col"><Outlet /></div></main>
          <DashboardHelpBot />
        </section>
      </div>
      <div className={`fixed inset-0 z-40 bg-black/50 lg:hidden ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-gradient-to-b from-[#4b16b5] via-[#3d1198] to-[#2a086f] text-white flex flex-col shadow-2xl transition-transform lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 pt-5 pb-4 border-b border-white/10 flex items-center justify-between gap-3"><ExpressnetBrand compact /><button onClick={() => setDrawerOpen(false)} className="w-9 h-9 flex items-center justify-center"><CloseIcon className="w-5 h-5" /></button></div>
        <nav className="flex-1 overflow-y-auto px-3 py-3 pb-6 pr-2">{navList(true)}</nav>
      </aside>
    </div>
  );
}
