import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  HomeIcon,
  BuildingIcon,
  AgentIcon,
  LogoutIcon,
  MenuIcon,
  CloseIcon,
  DotsVerticalIcon,
} from '../../components/Icons';
import InstallAppButton from '../../components/InstallAppButton';
import PushNotificationsButton from '../../components/PushNotificationsButton';

const NEXA_MARK = (
  <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#3535FF]" fill="none">
    <path
      d="M5 19V5l14 14V5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const NAV_ITEMS = [
  { to: '/onboarding', label: 'Overview', Icon: HomeIcon, end: true },
  { to: '/onboarding/clients', label: 'Meta Clients', Icon: BuildingIcon },
  { to: '/onboarding/evo-clients', label: 'Evo Clients', Icon: BuildingIcon },
  { to: '/onboarding/nexa-whatsapp', label: 'Nexa Official WhatsApp', Icon: AgentIcon },
];

export default function OnboardingLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!drawerOpen && !menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleLogout = () => {
    logout();
    navigate('/onboarding/login');
  };

  const currentLabel = (() => {
    if (location.pathname.startsWith('/onboarding/nexa-whatsapp')) return 'Nexa Official WhatsApp';
    if (location.pathname.startsWith('/onboarding/evo-clients')) return 'Evo Clients';
    if (location.pathname.startsWith('/onboarding/clients')) return 'Meta Clients';
    return 'Overview';
  })();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#E8E9FF]">
      <header className="flex items-center justify-between px-3 sm:px-5 h-14 bg-[#0A0A0F] text-white shrink-0 relative z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <MenuIcon className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center shrink-0">
              {NEXA_MARK}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="font-bold text-base tracking-tight truncate">Nexa Operator</div>
              <div className="text-[11px] text-gray-400 truncate">{currentLabel}</div>
            </div>
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="More options"
          >
            <DotsVerticalIcon className="w-5 h-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 w-56 bg-white text-gray-800 rounded-2xl shadow-xl py-1.5 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900 truncate">{admin?.name}</div>
                <div className="text-xs text-gray-500 capitalize">{admin?.role}</div>
              </div>
              <div className="px-3 py-2 bg-[#0A0A0F]">
                <InstallAppButton />
                <PushNotificationsButton />
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 text-gray-700"
              >
                <LogoutIcon className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-white relative">
        <Outlet />
      </main>

      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`fixed left-0 top-0 bottom-0 z-50 w-72 max-w-[85vw] bg-[#0A0A0F] text-white flex flex-col shadow-2xl transition-transform duration-200 ease-out ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!drawerOpen}
      >
        <div className="px-5 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shrink-0">
                {NEXA_MARK}
              </div>
              <div className="min-w-0 leading-tight">
                <div className="font-bold text-white text-base">Operator</div>
                <div className="text-xs text-gray-400 truncate">{admin?.name}</div>
              </div>
            </div>
            <button
              onClick={() => setDrawerOpen(false)}
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10"
              aria-label="Close menu"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.Icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                    isActive
                      ? 'bg-[#3535FF] text-white font-medium shadow-sm'
                      : 'text-gray-300 hover:bg-white/5'
                  }`
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="px-3 pt-3 pb-4 border-t border-white/5">
          <InstallAppButton />
          <PushNotificationsButton />
          <button
            onClick={handleLogout}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold bg-[#3535FF] hover:bg-[#2828DD] text-white transition-colors"
          >
            <LogoutIcon className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
