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
    <div className={`rounded-2xl border border-[#dce3f1] bg-white shadow-lg shadow-black/10 theme-dark:border-white/10 theme-dark:bg-white/5 ${compact ? 'px-2.5 py-2 max-w-[184px]' : 'px-3 py-3 w-full'}`}>
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
        ['/dashboard/noc', 'NOC Overview', ChartIcon, 'agent'],
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
        ['/dashboard/logs', 'Audit Trail', ChartIcon, 'logs'],
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
  const contentCanScroll = location.pathname.startsWith('/dashboard/noc');
  const signOut = () => { logout(); navigate('/login'); };
  const toggleGroup = (key) => setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  const itemButton = (item, mobile = false) => {
    const [path, label, Icon, , badge] = item;
    const selected = active(path);
    return (
      <button key={path} onClick={() => { navigate(path); setDrawerOpen(false); }} className={`dashboard-nav-item group relative flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm transition-all ${selected ? 'dashboard-nav-active bg-gradient-to-r from-[#3157ff] to-[#8b22f6] font-black text-white shadow-lg shadow-purple-500/20' : 'text-[#253056] hover:bg-[#f4f6fb] theme-dark:text-slate-300 theme-dark:hover:bg-white/5'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-white/18 text-white' : 'bg-[#f1f4fb] text-[#485574] theme-dark:bg-white/5 theme-dark:text-slate-300'}`}><Icon className="w-4 h-4" /></span>
        <span className="flex-1 text-left truncate">{label}</span>
        {badge > 0 && <span className={`flex h-6 min-w-[22px] items-center justify-center rounded-full px-2 text-[10px] font-black ${selected ? 'bg-white/18 text-white' : 'bg-[#7c35ff] text-white'}`}>{badge > 99 ? '99+' : badge}</span>}
      </button>
    );
  };
  const navList = (mobile = false) => navSections.map((section) => (
    <div key={section.key} className="space-y-1.5">
      <button
        type="button"
        onClick={() => toggleGroup(section.key)}
        className="flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-sm font-black text-[#20284d] transition hover:bg-[#f4f6fb] theme-dark:text-slate-300 theme-dark:hover:bg-white/5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f1f4fb] text-[#485574] theme-dark:bg-white/5 theme-dark:text-slate-300">
          <section.icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-left">{section.label}</span>
        <ChevronDownIcon className={`h-4 w-4 text-[#8b94ad] transition theme-dark:text-slate-500 ${expandedGroups[section.key] ? 'rotate-180' : ''}`} />
      </button>
      {expandedGroups[section.key] && (
        <div className="ml-4 space-y-1 border-l border-[#e4e8f3] pl-3 theme-dark:border-white/10">
          {section.items.map((item) => itemButton(item, mobile))}
        </div>
      )}
    </div>
  ));

  return (
    <div className="dashboard-shell h-screen overflow-hidden bg-[#f7f9fd] text-slate-900">
      <div className="flex h-full min-h-0">
        <aside className={`${sidebarOpen ? 'lg:flex' : 'lg:hidden'} dashboard-sidebar client-sidebar hidden w-[330px] shrink-0 flex-col overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_18px_46px_rgba(31,41,80,0.08)] z-20`}>
          <div className="px-5 pt-5 pb-3"><ExpressnetBrand /></div>
          <nav className="sidebar-nav flex-1 overflow-y-auto px-4 pb-5 pr-2">{navList()}</nav>
        </aside>
        <section className="dashboard-main flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_18px_46px_rgba(31,41,80,0.08)]">
          <header className="h-[84px] shrink-0 px-4 sm:px-7 lg:px-9 flex items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <button onClick={() => setDrawerOpen(true)} className="lg:hidden w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm flex items-center justify-center text-[#667092]"><MenuIcon className="w-6 h-6" /></button>
              <button onClick={() => setSidebarOpen((value) => !value)} className="hidden lg:flex w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm items-center justify-center text-[#667092] hover:text-[#4b16b5]"><MenuIcon className="w-5 h-5" /></button>
              <div className="min-w-0"><h1 className="text-2xl font-black truncate text-[#0d1438] dashboard-brand-title">{title}</h1><p className="text-xs text-[#7b84a8] dashboard-muted mt-1 truncate">Monitor support, installations, complaints and AI performance.</p></div>
            </div>
            <div className="flex items-center gap-4">{showConversationSearch && <GlobalConversationSearch />}<div className="hidden items-center gap-3 lg:flex"><span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[#80d9ff] bg-[#f0f8ff] text-sm font-extrabold text-[#0d1438]">{(admin?.name || 'ExpressNet Admin').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'NA'}<span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" /></span><div className="min-w-[112px]"><div className="truncate text-sm font-extrabold text-[#0d1438] dashboard-brand-title">{admin?.name || 'ExpressNet Admin'}</div><div className="truncate text-xs font-medium capitalize text-[#6d7697] dashboard-muted">{admin?.role || 'Administrator'}</div></div></div><div className="relative" ref={menuRef}><button onClick={() => setMenuOpen(!menuOpen)} className="w-12 h-12 rounded-2xl bg-white border border-[#e0e6f2] shadow-sm flex items-center justify-center text-[#667092]"><span className="hidden lg:block"><ChevronDownIcon className="h-5 w-5" /></span><span className="lg:hidden"><DotsVerticalIcon className="w-5 h-5" /></span></button>{menuOpen && <div className="absolute right-0 top-14 w-64 bg-white rounded-[24px] shadow-2xl py-2 z-30 border border-slate-100"><div className="px-5 py-3 border-b border-gray-100"><div className="text-sm font-black truncate">{admin?.name}</div><div className="text-xs text-gray-500 capitalize">{admin?.role}</div></div><button onClick={signOut} className="w-full flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50"><LogoutIcon className="w-4 h-4" />Sign out</button></div>}</div></div>
          </header>
          <main className="flex-1 min-h-0 px-4 sm:px-7 lg:px-9 pb-7 overflow-hidden"><div className={`dashboard-content h-full min-h-0 rounded-[28px] border border-[#dce3f1] bg-white shadow-[0_14px_34px_rgba(31,41,80,0.06)] flex flex-col ${contentCanScroll ? 'overflow-y-auto' : 'overflow-hidden'}`}><Outlet /></div></main>
          <DashboardHelpBot />
        </section>
      </div>
      <div className={`fixed inset-0 z-40 bg-black/50 lg:hidden ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`fixed inset-y-0 left-0 z-50 w-[min(19rem,82vw)] max-w-[82vw] bg-white text-[#0d1438] flex flex-col shadow-2xl transition-transform lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 pt-5 pb-3 border-b border-[#e2e7f4] flex items-center justify-between gap-3"><ExpressnetBrand compact /><button onClick={() => setDrawerOpen(false)} className="w-9 h-9 flex items-center justify-center text-[#263150]"><CloseIcon className="w-5 h-5" /></button></div>
        <nav className="flex-1 overflow-y-auto px-4 py-3 pb-6 pr-2">{navList(true)}</nav>
      </aside>
    </div>
  );
}
