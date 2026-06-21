import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ClientDashboard from './ClientDashboard';
import ExpressnetDashboard from './ExpressnetDashboard';

export default function DashboardShell() {
  const { admin, isImpersonating, returnToOperator } = useAuth();
  const navigate = useNavigate();

  const leaveClientDashboard = () => {
    if (returnToOperator()) {
      navigate('/onboarding/client-access', { replace: true });
    }
  };

  const dashboard = Number(admin?.client_id) === 1 ? <ExpressnetDashboard /> : <ClientDashboard />;

  return (
    <div className="relative h-full">
      {isImpersonating && (
        <div className="fixed right-4 top-3 z-[100] flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-xl">
          <div className="hidden sm:block">
            <p className="text-[10px] font-black uppercase tracking-wide text-amber-600">Operator access</p>
            <p className="max-w-[240px] truncate text-xs font-bold text-slate-800">Viewing {admin?.accessed_client_name || admin?.client_business_name || admin?.client_name || 'client dashboard'}</p>
          </div>
          <button type="button" onClick={leaveClientDashboard} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">
            Return to Operator
          </button>
        </div>
      )}
      {dashboard}
    </div>
  );
}
