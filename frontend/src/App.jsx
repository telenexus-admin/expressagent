import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import OnboardingLogin from './pages/OnboardingLogin';
import OnboardingLayout from './pages/onboarding/Layout';
import OnboardingOverview from './pages/onboarding/Overview';
import OnboardingClients from './pages/onboarding/Clients';
import OnboardingClientDetail from './pages/onboarding/ClientDetail';
import Dashboard from './pages/Dashboard';
import Conversations from './pages/Conversations';
import ChatView from './components/ChatView';
import AIHealth from './pages/AIHealth';
import Statistics from './pages/Statistics';
import AdminManagement from './pages/AdminManagement';
import Employees from './pages/Employees';
import Workflow from './pages/Workflow';
import Agent from './pages/Agent';
import Escalations from './pages/Escalations';
import Installations from './pages/Installations';
import Complaints from './pages/Complaints';

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-gray-500 text-sm">Loading...</div>
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
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding/login" element={<OnboardingLogin />} />

          <Route
            path="/onboarding"
            element={
              <SuperadminRoute>
                <OnboardingLayout />
              </SuperadminRoute>
            }
          >
            <Route index element={<OnboardingOverview />} />
            <Route path="clients" element={<OnboardingClients />} />
            <Route path="clients/:id" element={<OnboardingClientDetail />} />
          </Route>

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="statistics" replace />} />
            <Route path="conversations" element={<Conversations />}>
              <Route path=":id" element={<ChatView />} />
            </Route>
            <Route path="escalations" element={<Escalations />} />
            <Route path="installations" element={<Installations />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="ai-health" element={<AIHealth />} />
            <Route path="statistics" element={<Statistics />} />
            <Route path="admins" element={<AdminManagement />} />
            <Route path="employees" element={<Employees />} />
            <Route path="workflow" element={<Workflow />} />
            <Route path="agent" element={<Agent />} />
            <Route path="settings" element={<Navigate to="../agent" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
