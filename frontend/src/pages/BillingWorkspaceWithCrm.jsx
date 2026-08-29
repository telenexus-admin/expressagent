import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BillingWorkspace from './BillingWorkspace';

function CrmNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const leadsActive = location.pathname === '/crm/leads';

  return (
    <div className="fixed left-3 top-24 z-50 w-52 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-900/10 backdrop-blur-md">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">CRM</div>
        <div className="mt-0.5 text-sm font-extrabold text-slate-900">Customer acquisition</div>
      </div>
      <button
        type="button"
        onClick={() => navigate('/crm/leads')}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold transition ${
          leadsActive
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black ${leadsActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
          L
        </span>
        <span className="flex-1">Leads</span>
        {leadsActive && <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />}
      </button>
    </div>
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
