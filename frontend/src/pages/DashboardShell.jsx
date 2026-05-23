import React from 'react';
import { useAuth } from '../context/AuthContext';
import ClientDashboard from './ClientDashboard';
import ExpressnetDashboard from './ExpressnetDashboard';

export default function DashboardShell() {
  const { admin } = useAuth();
  if (Number(admin?.client_id) === 1) return <ExpressnetDashboard />;
  return <ClientDashboard />;
}
