import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BillingWorkspace from './BillingWorkspace';

function CrmNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const leadsActive = location.pathname === '/crm/leads';

  return (
    <>
      <style>{`
        @media (min-width: 1024px) {
          /* Reserve one real navigation row between Customers and Services. */
          aside > div.mt-2 > section:nth-child(3) {
            margin-top: 44px !important;
          }
        }
      `}</style>

      <button
        type="button"
        onClick={() => navigate('/crm/leads')}
        className={`fixed left-2.5 top-[194px] z-[55] hidden h-[38px] w-[198px] items-center gap-2 rounded-lg px-2 text-left text-[12.35px] font-semibold tracking-[-.015em] transition lg:flex ${
          leadsActive
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
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

      <button
        type="button"
        onClick={() => navigate('/crm/leads')}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-slate-900/20 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-indigo-600 lg:hidden"
        title="Open CRM Leads"
        aria-label="Open CRM Leads"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-xs">CRM</span>
        Leads
      </button>
    </>
  );
}

export default function BillingWorkspaceWithCrm() {
  return (
    <div className="relative min-h-screen">
      <BillingWorkspace />
      <CrmNavigation />
    </div>
  );
}
