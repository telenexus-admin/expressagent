import React from 'react';
import { useNavigate } from 'react-router-dom';
import BillingWorkspace from './BillingWorkspace';

export default function BillingWorkspaceWithCrm() {
  const navigate = useNavigate();
  return <div className="relative min-h-screen">
    <BillingWorkspace />
    <button
      type="button"
      onClick={() => navigate('/crm/leads')}
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-slate-900/20 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-indigo-600"
      title="Open CRM Leads"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-xs">CRM</span>
      Leads
    </button>
  </div>;
}
