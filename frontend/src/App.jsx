import React, { Component, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
const ExpressnetLogin = lazy(() => import('./pages/ExpressnetLogin'));
const SelfOnboarding = lazy(() => import('./pages/SelfOnboarding'));
const CustomerIntake = lazy(() => import('./pages/CustomerIntake'));
const RelocationRequest = lazy(() => import('./pages/RelocationRequest'));
const InstallationWorkOrder = lazy(() => import('./pages/InstallationWorkOrder'));
const ClientAccess = lazy(() => import('./pages/ClientAccess'));
const HotspotPortal = lazy(() => import('./pages/HotspotPortal'));
const OnboardingLogin = lazy(() => import('./pages/OnboardingLogin'));
const OnboardingLayout = lazy(() => import('./pages/onboarding/Layout'));
const OnboardingOverview = lazy(() => import('./pages/onboarding/Overview'));
const OnboardingClients = lazy(() => import('./pages/onboarding/Clients'));
const OnboardingClientDetail = lazy(() => import('./pages/onboarding/ClientDetail'));
const OnboardingClientAccess = lazy(() => import('./pages/onboarding/ClientAccess'));
const EvoClients = lazy(() => import('./pages/onboarding/EvoClients'));
const NexaWhatsApp = lazy(() => import('./pages/onboarding/NexaWhatsApp'));
const UpdateContacts = lazy(() => import('./pages/onboarding/UpdateContacts'));
const Dashboard = lazy(() => import('./pages/DashboardShell'));
const Conversations = lazy(() => import('./pages/Conversations'));
const ChatView = lazy(() => import('./components/ChatView'));
const AIHealth = lazy(() => import('./pages/AIHealth'));
const Statistics = lazy(() => import('./pages/Statistics'));
const DailyReports = lazy(() => import('./pages/DailyReports'));
const SmsSettings = lazy(() => import('./pages/SmsSettings'));
const ClientRemarks = lazy(() => import('./pages/ClientRemarks'));
const AdminManagement = lazy(() => import('./pages/AdminManagement'));
const Employees = lazy(() => import('./pages/Employees'));
const Workflow = lazy(() => import('./pages/Workflow'));
const Agent = lazy(() => import('./pages/Agent'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const AiTasks = lazy(() => import('./pages/AiTasks'));
const NetworkMonitor = lazy(() => import('./pages/NetworkMonitor'));
const NocOverview = lazy(() => import('./pages/NocOverview'));
const PublicNocLive = lazy(() => import('./pages/PublicNocLive'));
const MikrotikClients = lazy(() => import('./pages/MikrotikClients'));
const Escalations = lazy(() => import('./pages/Escalations'));
const Installations = lazy(() => import('./pages/Installations'));
const Complaints = lazy(() => import('./pages/Complaints'));
const Tickets = lazy(() => import('./pages/Tickets'));
const InvoiceManagement = lazy(() => import('./pages/InvoiceManagement'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Logs = lazy(() => import('./pages/Logs'));
const Settings = lazy(() => import('./pages/Settings'));
const Billing = lazy(() => import('./pages/Billing'));
const Communication = lazy(() => import('./pages/Communication'));
const Documentation = lazy(() => import('./pages/Documentation'));
const BillingWorkspace = lazy(() => import('./pages/BillingWorkspace'));
const AgentPortal = lazy(() => import('./pages/AgentPortal'));
const PppoePortal = lazy(() => import('./pages/PppoePortal'));

const ALL_PERMISSIONS = [
  'statistics',
  'conversations',
  'tickets',
  'invoices',
  'inventory',
  'billing',
  'communication',
  'documentation',
  'escalations',
  'installations',
  'complaints',
  'ai_health',
  'admins',
  'employees',
  'workflow',
  'agent',
  'settings',
  'logs',
];

function hasPermission(admin, permission) {
  if (!admin) return false;
  if (permission === 'inventory') return true;
  if (permission === 'documentation') return true;
  if (permission === 'settings' || permission === 'billing' || permission === 'communication') return true;
  if (admin.role === 'superadmin') return true;
  if (!Array.isArray(admin.permissions) || admin.permissions.length === 0) return true;
  return admin.permissions.includes(permission);
}

function firstAllowedPath(admin) {
  const first = ALL_PERMISSIONS.find((p) => hasPermission(admin, p)) || 'statistics';
  const pathMap = {
    statistics: 'statistics',
    conversations: 'conversations',
    tickets: 'tickets',
    invoices: 'invoices',
    inventory: 'inventory',
    billing: 'billing',
    communication: 'communication',
    documentation: 'documentation',
    escalations: 'escalations',
    installations: 'installations',
    complaints: 'complaints',
    ai_health: 'ai-health',
    admins: 'admins',
    employees: 'employees',
    workflow: 'workflow',
    agent: 'agent',
    settings: 'settings',
    logs: 'logs',
  };
  return pathMap[first] || 'statistics';
}

function LoadingScreen() {
  return <div className="flex items-center justify-center h-screen bg-gray-50"><div className="text-gray-500 text-sm">Loading...</div></div>;
}

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    const recoveryKey = 'nexa-runtime-recovery-v3';
    if (sessionStorage.getItem(recoveryKey)) return;
    sessionStorage.setItem(recoveryKey, '1');
    const recover = async () => {
      const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.includes('workbox') || key.includes('precache') || key.includes('nexa')).map((key) => caches.delete(key)));
      }
      window.location.replace(`${window.location.pathname}?refresh=${Date.now()}`);
    };
    void recover();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl shadow-slate-200/70">
          <h1 className="text-lg font-bold text-slate-900">Refreshing Nexa...</h1><p className="mt-2 text-sm text-slate-500">We found an older cached app asset and are loading the current dashboard.</p><button onClick={() => { sessionStorage.removeItem('nexa-runtime-recovery-v3'); window.location.replace(`${window.location.pathname}?refresh=${Date.now()}`); }} className="mt-5 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white">Reload Nexa</button>
        </div>
      </div>
    );
  }
}

function AccessDenied() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#f8f6ff] p-6">
      <div className="max-w-md text-center bg-white rounded-[28px] border border-purple-50 shadow-xl shadow-purple-100/60 p-8">
        <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4 text-2xl">!</div>
        <h1 className="text-xl font-black text-slate-950">Access restricted</h1>
        <p className="text-sm text-slate-500 mt-2">You do not have permission to access this section. Ask the main admin to update your tab access.</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { admin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!admin) return <Navigate to="/login" replace />;
  if (admin.role === 'superadmin') return <Navigate to="/onboarding" replace />;
  if (admin.account_type === 'billing') return <Navigate to="/billing" replace />;
  return children;
}

function BillingRoute({ children }) {
  const { admin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!admin) return <Navigate to="/login" replace />;
  if (admin.role === 'superadmin') return <Navigate to="/onboarding" replace />;
  if (admin.account_type !== 'billing') return <Navigate to="/dashboard" replace />;
  return children;
}

function PermissionRoute({ permission, children }) {
  const { admin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!admin) return <Navigate to="/login" replace />;
  if (!hasPermission(admin, permission)) return <AccessDenied />;
  return children;
}

function DashboardIndexRedirect() {
  const { admin } = useAuth();
  return <Navigate to={firstAllowedPath(admin)} replace />;
}

function SuperadminRoute({ children }) {
  const { admin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!admin) return <Navigate to="/onboarding/login" replace />;
  if (admin.role !== 'superadmin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RouteErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/self-onboarding" element={<SelfOnboarding />} />
          <Route path="/customer-intake/:clientId" element={<CustomerIntake />} />
          <Route path="/relocation-request/:clientId" element={<RelocationRequest />} />
          <Route path="/installation-work-order/:token" element={<InstallationWorkOrder />} />
          <Route path="/public/noc/:token" element={<PublicNocLive />} />
          <Route path="/client-access" element={<ClientAccess />} />
          <Route path="/hotspot" element={<HotspotPortal />} />
          <Route path="/agent" element={<AgentPortal />} />
          <Route path="/pppoe" element={<PppoePortal />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/expressnet" element={<ExpressnetLogin />} />
          <Route path="/onboarding/login" element={<OnboardingLogin />} />
          <Route path="/billing" element={<BillingRoute><BillingWorkspace /></BillingRoute>} />
          <Route path="/onboarding" element={<SuperadminRoute><OnboardingLayout /></SuperadminRoute>}>
            <Route index element={<OnboardingOverview />} />
            <Route path="clients" element={<OnboardingClients />} />
            <Route path="clients/:id" element={<OnboardingClientDetail />} />
            <Route path="client-access" element={<OnboardingClientAccess />} />
            <Route path="evo-clients" element={<EvoClients />} />
            <Route path="nexa-whatsapp" element={<NexaWhatsApp />} />
            <Route path="update-contacts" element={<UpdateContacts />} />
          </Route>
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>}>
            <Route index element={<DashboardIndexRedirect />} />
            <Route path="conversations" element={<PermissionRoute permission="conversations"><Conversations /></PermissionRoute>}>
              <Route path=":id" element={<ChatView />} />
            </Route>
            <Route path="tickets" element={<PermissionRoute permission="tickets"><Tickets /></PermissionRoute>} />
            <Route path="tickets/:id" element={<PermissionRoute permission="tickets"><Tickets detailMode /></PermissionRoute>} />
            <Route path="invoices" element={<PermissionRoute permission="invoices"><Suspense fallback={<LoadingScreen />}><InvoiceManagement /></Suspense></PermissionRoute>} />
            <Route path="inventory" element={<PermissionRoute permission="inventory"><Inventory /></PermissionRoute>} />
            <Route path="billing" element={<PermissionRoute permission="billing"><Billing /></PermissionRoute>} />
            <Route path="communication" element={<PermissionRoute permission="communication"><Communication /></PermissionRoute>} />
            <Route path="documentation" element={<PermissionRoute permission="documentation"><Documentation /></PermissionRoute>} />
            <Route path="escalations" element={<PermissionRoute permission="escalations"><Escalations /></PermissionRoute>} />
            <Route path="installations" element={<PermissionRoute permission="installations"><Installations /></PermissionRoute>} />
            <Route path="complaints" element={<PermissionRoute permission="complaints"><Complaints /></PermissionRoute>} />
            <Route path="remarks" element={<PermissionRoute permission="complaints"><ClientRemarks /></PermissionRoute>} />
            <Route path="ai-health" element={<PermissionRoute permission="ai_health"><AIHealth /></PermissionRoute>} />
            <Route path="statistics" element={<PermissionRoute permission="statistics"><Statistics /></PermissionRoute>} />
            <Route path="reports" element={<PermissionRoute permission="statistics"><DailyReports /></PermissionRoute>} />
            <Route path="sms-settings" element={<PermissionRoute permission="agent"><SmsSettings /></PermissionRoute>} />
            <Route path="admins" element={<PermissionRoute permission="admins"><AdminManagement /></PermissionRoute>} />
            <Route path="employees" element={<PermissionRoute permission="employees"><Employees /></PermissionRoute>} />
            <Route path="workflow" element={<PermissionRoute permission="workflow"><Workflow /></PermissionRoute>} />
            <Route path="agent" element={<PermissionRoute permission="agent"><Agent /></PermissionRoute>} />
            <Route path="knowledge-base" element={<PermissionRoute permission="agent"><KnowledgeBase /></PermissionRoute>} />
            <Route path="ai-tasks" element={<PermissionRoute permission="agent"><AiTasks /></PermissionRoute>} />
            <Route path="network-monitor" element={<PermissionRoute permission="agent"><NetworkMonitor /></PermissionRoute>} />
            <Route path="noc" element={<PermissionRoute permission="agent"><NocOverview /></PermissionRoute>} />
            <Route path="mikrotik-clients" element={<PermissionRoute permission="agent"><MikrotikClients /></PermissionRoute>} />
            <Route path="logs" element={<PermissionRoute permission="logs"><Logs /></PermissionRoute>} />
            <Route path="settings" element={<PermissionRoute permission="settings"><Settings /></PermissionRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}
