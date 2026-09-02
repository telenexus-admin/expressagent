import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BillingWorkspace from './BillingWorkspace';
import CrmLeadsPage from './CrmLeadsPage';

function CrmNavigationBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const aside = document.querySelector('[data-billing-tab] aside');
    if (!aside) return undefined;

    const sections = Array.from(aside.querySelectorAll('section'));
    const customers = sections.find((section) => section.textContent?.trim().startsWith('CUSTOMERS'));
    const nav = customers?.querySelector('nav');
    if (!nav || nav.querySelector('[data-crm-leads-nav]')) return undefined;

    const subscribersButton = Array.from(nav.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Subscribers');
    if (!subscribersButton) return undefined;

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-crm-leads-nav', 'true');
    button.className = 'flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.35px] font-semibold tracking-[-.015em] transition sm:px-2.5 sm:py-1.5 sm:text-[13px] lg:px-2 lg:py-1 lg:text-[12.35px]';
    button.innerHTML = '<span data-crm-icon class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500"><svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M19 8v6M22 11h-6"></path></svg></span><span class="min-w-0 flex-1 truncate">Leads</span>';
    button.addEventListener('click', () => navigate('/crm/leads'));
    nav.insertBefore(button, subscribersButton.nextSibling);

    return () => button.remove();
  }, [navigate, location.pathname]);

  useEffect(() => {
    const button = document.querySelector('[data-crm-leads-nav]');
    const icon = button?.querySelector('[data-crm-icon]');
    if (!button || !icon) return;
    const active = location.pathname === '/crm/leads';
    button.className = `flex min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.35px] font-semibold tracking-[-.015em] transition sm:px-2.5 sm:py-1.5 sm:text-[13px] lg:px-2 lg:py-1 lg:text-[12.35px] ${active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`;
    icon.className = `flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-500'}`;
  }, [location.pathname]);

  return null;
}

export default function BillingWorkspaceWithCrm() {
  const location = useLocation();
  const leadsActive = location.pathname === '/crm/leads';

  return (
    <div className="relative min-h-screen">
      <BillingWorkspace />
      <CrmNavigationBridge />
      {leadsActive && (
        <main className="fixed inset-y-0 left-0 z-10 overflow-y-auto bg-slate-50 lg:left-[218px]">
          <div className="mx-auto max-w-[1500px]">
            <div className="hidden">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-slate-400">CUSTOMERS / CRM</div>
                <h1 className="mt-1 font-[Georgia,Times,serif] text-[1.7rem] font-semibold tracking-[-.03em] text-slate-950">Leads</h1>
                <p className="mt-1 text-sm text-slate-500">Manage prospects, follow-ups and the customer conversion pipeline.</p>
              </div>
              <div className="hidden sm:block text-xs font-semibold text-slate-400">Sales pipeline</div>
            </div>
            <CrmLeadsPage />
          </div>
        </main>
      )}
    </div>
  );
}
