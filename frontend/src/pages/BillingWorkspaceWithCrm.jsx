import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BillingWorkspace from './BillingWorkspace';
import CrmLeadsPage from './CrmLeadsPage';

function CrmNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const leadsActive = location.pathname === '/crm/leads';

  return (
    <button
      type="button"
      onClick={() => navigate('/crm/leads')}
      className={`fixed left-3 top-[268px] z-[70] flex h-[38px] w-[198px] items-center gap-2 rounded-xl border px-2.5 text-left text-[12.35px] font-semibold tracking-[-.015em] transition-all ${
        leadsActive
          ? 'border-emerald-100 bg-emerald-50 text-emerald-700 shadow-none ring-1 ring-inset ring-emerald-100'
          : 'border-slate-200/80 bg-white text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,.04)] hover:bg-slate-50 hover:text-slate-900'
      }`}
      title="CRM Leads"
      aria-label="CRM Leads"
    >
      <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md ${
        leadsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-500'
      }`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </svg>
      </span>
      <span className="min-w-0 flex-1 truncate">Leads</span>
      {leadsActive && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />}
    </button>
  );
}

export default function BillingWorkspaceWithCrm() {
  const location = useLocation();
  const leadsActive = location.pathname === '/crm/leads';

  return (
    <div className="relative min-h-screen overflow-hidden">
      <BillingWorkspace />
      <CrmNavigation />
      {leadsActive && (
        <main className="fixed inset-0 z-[60] overflow-y-auto bg-slate-50 pt-[64px] pl-0 md:left-[232px] md:pl-0">
          <CrmLeadsPage />
        </main>
      )}
    </div>
  );
}
