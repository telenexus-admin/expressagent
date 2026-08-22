import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.get('/auth/me', { skipAuthRefresh: true, skipAuthRedirect: true })
      .then(({ data }) => { if (mounted) setAdmin(data.admin || null); })
      .catch(() => { if (mounted) setAdmin(null); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const login = (adminData) => {
    setAdmin(adminData || null);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', null, { skipAuthRefresh: true, skipAuthRedirect: true });
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('admin');
      localStorage.removeItem('operator_token');
      localStorage.removeItem('operator_admin');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('admin');
      setAdmin(null);
    }
  };

  const impersonateClient = async (clientId) => {
    const { data } = await api.post(`/operator-access/${clientId}`);
    setAdmin(data.admin);
    return data.admin;
  };

  const returnToOperator = async () => {
    const { data } = await api.post('/operator-access/return');
    setAdmin(data.admin);
    return true;
  };

  const value = useMemo(() => ({
    admin,
    login,
    logout,
    loading,
    impersonateClient,
    returnToOperator,
    isImpersonating: Boolean(admin?.operator_impersonation),
  }), [admin, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
