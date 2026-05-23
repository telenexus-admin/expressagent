import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
  ChatIcon,
  LifebuoyIcon,
  PulseIcon,
  UsersIcon,
  BriefcaseIcon,
  FlowIcon,
  AgentIcon,
  LogoutIcon,
  WrenchIcon,
  WarningIcon,
  HomeIcon,
  MenuIcon,
  CloseIcon,
  DotsVerticalIcon,
  ChartIcon,
} from '../components/Icons';
import InstallAppButton from '../components/InstallAppButton';

const NEXA_MARK = (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
    <path d="M5 19V5l14 14V5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function canAccess(admin, permission) {
  if (!admin) return false;
  if (admin.role === 'superadmin') return true;
  if (!Array.isArray(admin.permissions) || admin.permissions.length === 0) return true;
  return admin.permissions.includes(permission);
}

export default function Dashboard() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [badges, setBadges] = useState({ conversations: 0, escalations: 0, installations: 0, complaints: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const fetchBadges = async () => {
      try {
        const [convRes, escRes, installRes, complaintRes] = await Promise.all([
          api.get('/conversations'),
          api.get('/escalations?status=open&type=human'),
          api.get('/escalations?status=open&type=installation'),
          api.get('/escalations?status=open&type=complaint'),
        ]);
        if (cancelled) return;
        const convCount = convRes.data.filter((c) => c.status === 'active' || c.status === 'human_takeover').length;
        setBadges({ conversations: convCount, escalations: escRes.data.length, installations: installRes.data.length, complaints: complaintRes.data.length });
      } catch (err) {
        if (err.response?.status !== 401) console.error('Failed to fetch sidebar badges:', err.message);
      }
    };
    fetchBadges();
    const interval = setInterval(fetchBadges, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!drawerOpen && !menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setDrawerOpen(false); setMenuOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const isActive = (path) => {
    if (path === '/dashboard/statistics' && location.pathname === '/dashboard') return true;
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const navItems = [
    { path: '/dashboard/statistics', label: 'Dashboard', Icon: HomeIcon, permission: 'statistics' },
    { path: '/dashboard/conversations', label: 'Conversations', Icon: ChatIcon, badge: badges.conversations, permission: 'conversations' },
    { path: '/dashboard/escalations', label: 'Human Handover', Icon: LifebuoyIcon, badge: badges.escalations, permission: 'escalations' },
    { path: '/dashboard/installations', label: 'Installations', Icon: WrenchIcon, badge: badges.installations, permission: 'installations' },
    { path: '/dashboard/complaints', label: 'Complaints', Icon: WarningIcon, badge: badges.complaints, permission: 'complaints' },
    { path: '/dashboard/ai-health', label: 'AI Health', Icon: PulseIcon, permission: 'ai_health' },
    { path: '/dashboard/admins', label: 'Admin Management', Icon: UsersIcon, permission: 'admins' },
    { path: '/dashboard/logs', label: 'Activity Logs', Icon: ChartIcon, permission: 'logs' },
    { path: '/dashboard/employees', label: 'Employees', Icon: BriefcaseIcon, permission: 'employees' },
    { path: '/dashboard/workflow', label: 'Workflow', Icon: FlowIcon, permission: 'workflow' },
    { path: '/dashboard/agent', label: 'Agent', Icon: AgentIcon, permission: 'agent' },
  ];

  const visibleNavItems = navItems.filter((item) => canAccess(admin, item.permission));
  const currentLabel = visibleNavItems.find((i) => isActive(i.path))?.label || 'Dashboard';
  const goTo = (path) => { navigate(path); setDrawerOpen(false); };

  const navButton = (item) => {
    const active = isActive(item.path);
    const Icon = item.Icon;
    return (
      <button key={item.path} onClick={() => goTo(item.path)} className={`group relative w-full flex items-center gap-3 px-5 py-3 rounded-[22px] text-sm transition-all ${active ? 'bg-white text-[#42149b] font-black shadow-xl shadow-black/10' : 'text-white/72 hover:bg-white/10 hover:text-white'}`}>
        <span className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${active ? 'bg-[#efe9ff] text-[#4d1ab8]' : 'bg-white/10 text-white/80 group-hover:bg-white/15'}`}><Icon className="w-5 h-5" /></span>
        <span className="flex-1 text-left truncate">{item.label}</span>
        {item.badge > 0 && <span className={`text-[10px] font-black rounded-full min-w-[22px] h-6 flex items-center justify-center px-2 ${active ? 'bg-[#4d1ab8] text-white' : 'bg-white text-[#4d1ab8]'}`}>{item.badge > 99 ? '99+' : item.badge}</span>}
      </button>
    );
  };

  return (
    <div className="h-screen overflow-hidden bg-[#f2f0f7] text-slate-900">
      <div className="flex h-full min-h-0">
        <aside className={`${sidebarOpen ? 'lg:flex' : 'lg:hidden'} hidden w-[286px] shrink-0 bg-gradient-to-b from-[#4b16b5] via-[#3d1198] to-[#2a086f] text-white rounded-r-[42px] flex-col shadow-2xl shadow-purple-900/25 z-20`}>
          <div className="px-8 pt-7 pb-7"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-2xl bg-white text-[#4b16b5] flex items-center justify-center shadow-2xl shadow-black/10">{NEXA_MARK}</div><div><div className="text-2xl font-black tracking-tight">Nexa</div><div className="text-xs text-white/50">AI Support Portal</div></div></div></div>
          <nav className="px-5 space-y-2 flex-1 overflow-y-auto pb-5">{visibleNavItems.length > 0 ? visibleNavItems.map(navButton) : <div className="text-xs text-white/55 px-4 py-3">No tabs have been assigned to this account.</div>}</nav>
          <div className="px-6 pb-6 pt-4"><InstallAppButton /><button onClick={handleLogout} className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold bg-white/10 hover:bg-red-500 text-white/75 hover:text-white transition-all"><LogoutIcon className="w-4 h-4" /><span>Sign Out</span></button></div>
        </aside>
        <section className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <header className="h-[84px] shrink-0 px-4 sm:px-7 lg:px-9 flex items-center justify-between gap-5"><div className="flex items-center gap-4 min-w-0"><button onClick={() => setDrawerOpen(true)} className="lg:hidden w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-600" aria-label="Open menu"><MenuIcon className="w-6 h-6" /></button><button onClick={() => setSidebarOpen((open) => !open)} className="hidden lg:flex w-11 h-11 rounded-2xl bg-white shadow-sm items-center justify-center text-slate-600 hover:text-[#4b16b5] transition-colors" aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'} title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}><MenuIcon className="w-5 h-5" /></button><div className="min-w-0"><h1 className="text-2xl font-black tracking-tight text-slate-950 truncate">{currentLabel}</h1><p className="text-xs text-slate-400 mt-1 truncate">Monitor support, installations, complaints and AI performance.</p></div></div><div className="flex items-center gap-4 min-w-0"><div className="hidden md:flex w-[320px] xl:w-[380px] bg-white rounded-full px-5 py-3 shadow-sm border border-slate-100 items-center gap-3"><input readOnly value="Search something here..." className="bg-transparent text-xs text-slate-400 outline-none flex-1" /><span className="text-slate-300 text-lg">⌕</span></div><div className="relative" ref={menuRef}><button onClick={() => setMenuOpen((v) => !v)} className="w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-500 hover:text-[#4b16b5] transition-colors" aria-label="More options"><DotsVerticalIcon className="w-5 h-5" /></button>{menuOpen && <div className="absolute right-0 top-14 w-64 bg-white text-gray-800 rounded-[24px] shadow-2xl py-2 overflow-hidden z-30 border border-slate-100"><div className="px-5 py-3 border-b border-gray-100"><div className="text-sm font-black text-gray-900 truncate">{admin?.name}</div><div className="text-xs text-gray-500 capitalize">{admin?.role}</div></div><button onClick={() => { setMenuOpen(false); handleLogout(); }} className="w-full flex items-center gap-3 px-5 py-3 text-sm hover:bg-gray-50 text-gray-700"><LogoutIcon className="w-4 h-4" />Sign out</button></div>}</div></div></header>
          <main className="flex-1 min-h-0 px-4 sm:px-7 lg:px-9 pb-7 overflow-hidden"><div className="h-full min-h-0 rounded-[34px] overflow-hidden bg-white shadow-2xl shadow-slate-200/70 border border-white flex flex-col"><Outlet /></div></main>
        </section>
      </div>
      <div className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 lg:hidden ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <aside className={`fixed left-0 top-0 bottom-0 z-50 w-72 max-w-[85vw] bg-gradient-to-b from-[#4b16b5] via-[#3d1198] to-[#2a086f] text-white flex flex-col shadow-2xl transition-transform duration-200 ease-out lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`} aria-hidden={!drawerOpen}>
        <div className="px-5 pt-5 pb-4 border-b border-white/10"><div className="flex items-center justify-between mb-3"><div className="flex items-center gap-3"><div className="w-11 h-11 bg-white text-[#4b16b5] rounded-2xl flex items-center justify-center shrink-0">{NEXA_MARK}</div><div className="min-w-0 leading-tight"><div className="font-black text-white text-lg">Nexa</div></div></div><button onClick={() => setDrawerOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10" aria-label="Close menu"><CloseIcon className="w-5 h-5" /></button></div></div>
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-2">{visibleNavItems.length > 0 ? visibleNavItems.map(navButton) : <div className="text-xs text-white/55 px-4 py-3">No tabs have been assigned to this account.</div>}</nav>
        <div className="px-4 pt-3 pb-4 border-t border-white/10 space-y-2"><InstallAppButton /><button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-sm font-bold bg-white/10 hover:bg-red-500 text-white transition-colors"><LogoutIcon className="w-4 h-4" /><span>Sign Out</span></button></div>
      </aside>
    </div>
  );
}
