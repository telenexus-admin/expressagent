import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ExpressnetLogin from './pages/ExpressnetLogin';
import SelfOnboarding from './pages/SelfOnboarding';
import CustomerIntake from './pages/CustomerIntake';
import ClientAccess from './pages/ClientAccess';
import OnboardingLogin from './pages/OnboardingLogin';
import OnboardingLayout from './pages/onboarding/Layout';
import OnboardingOverview from './pages/onboarding/Overview';
import OnboardingClients from './pages/onboarding/Clients';
import OnboardingClientDetail from './pages/onboarding/ClientDetail';
import OnboardingClientAccess from './pages/onboarding/ClientAccess';
import EvoClients from './pages/onboarding/EvoClients';
import NexaWhatsApp from './pages/onboarding/NexaWhatsApp';
import Dashboard from './pages/DashboardShell';
import Conversations from './pages/Conversations';
import ChatView from './components/ChatView';
import AIHealth from './pages/AIHealth';
import Statistics from './pages/Statistics';
import DailyReports from './pages/DailyReports';
import SmsSettings from './pages/SmsSettings';
import ClientRemarks from './pages/ClientRemarks';
import AdminManagement from './pages/AdminManagement';
import Employees from './pages/Employees';
import Workflow from './pages/Workflow';
import Agent from './pages/Agent';
import Escalations from './pages/Escalations';
import Installations from './pages/Installations';
import Complaints from './pages/Complaints';
import Tickets from './pages/Tickets';
import InvoiceManagement from './pages/InvoiceManagement';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import Communication from './pages/Communication';
import Documentation from './pages/Documentation';

const ALL_PERMISSIONS = [
  'statistics',
  'conversations',
  'tickets',
  'invoices',
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
        <Routes>
          <Route path="/self-onboarding" element={<SelfOnboarding />} />
          <Route path="/customer-intake/:clientId" element={<CustomerIntake />} />
          <Route path="/client-access" element={<ClientAccess />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/expressnet" element={<ExpressnetLogin />} />
          <Route path="/onboarding/login" element={<OnboardingLogin />} />
          <Route path="/onboarding" element={<SuperadminRoute><OnboardingLayout /></SuperadminRoute>}>
            <Route index element={<OnboardingOverview />} />
            <Route path="clients" element={<OnboardingClients />} />
            <Route path="clients/:id" element={<OnboardingClientDetail />} />
            <Route path="client-access" element={<OnboardingClientAccess />} />
            <Route path="evo-clients" element={<EvoClients />} />
            <Route path="nexa-whatsapp" element={<NexaWhatsApp />} />
          </Route>
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>}>
            <Route index element={<DashboardIndexRedirect />} />
            <Route path="conversations" element={<PermissionRoute permission="conversations"><Conversations /></PermissionRoute>}>
              <Route path=":id" element={<ChatView />} />
            </Route>
            <Route path="tickets" element={<PermissionRoute permission="tickets"><Tickets /></PermissionRoute>} />
            <Route path="invoices" element={<PermissionRoute permission="invoices"><InvoiceManagement /></PermissionRoute>} />
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
            <Route path="logs" element={<PermissionRoute permission="logs"><Logs /></PermissionRoute>} />
            <Route path="settings" element={<PermissionRoute permission="settings"><Settings /></PermissionRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
