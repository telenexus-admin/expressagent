import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

function getStoredAuth() {
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  const stored = sessionStorage.getItem('admin') || localStorage.getItem('admin');
  return { token, stored };
}

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token, stored } = getStoredAuth();
    if (token && stored) {
      try {
        setAdmin(JSON.parse(stored));
      } catch {
        localStorage.removeItem('admin');
        localStorage.removeItem('token');
        sessionStorage.removeItem('admin');
        sessionStorage.removeItem('token');
      }
    }
    setLoading(false);
  }, []);

  const login = (token, adminData, options = {}) => {
    const storage = options.sessionOnly ? sessionStorage : localStorage;
    localStorage.removeItem('operator_token');
    localStorage.removeItem('operator_admin');
    if (!options.sessionOnly) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('admin');
    }
    storage.setItem('token', token);
    storage.setItem('admin', JSON.stringify(adminData));
    setAdmin(adminData);
  };

  const impersonateClient = (token, adminData) => {
    const currentToken = localStorage.getItem('token');
    const currentAdmin = localStorage.getItem('admin');
    if (admin?.role === 'superadmin' && currentToken && currentAdmin) {
      localStorage.setItem('operator_token', currentToken);
      localStorage.setItem('operator_admin', currentAdmin);
    }
    localStorage.setItem('token', token);
    localStorage.setItem('admin', JSON.stringify(adminData));
    setAdmin(adminData);
  };

  const returnToOperator = () => {
    const operatorToken = localStorage.getItem('operator_token');
    const operatorAdmin = localStorage.getItem('operator_admin');
    if (!operatorToken || !operatorAdmin) return false;
    try {
      const parsed = JSON.parse(operatorAdmin);
      localStorage.setItem('token', operatorToken);
      localStorage.setItem('admin', operatorAdmin);
      localStorage.removeItem('operator_token');
      localStorage.removeItem('operator_admin');
      setAdmin(parsed);
      return true;
    } catch {
      localStorage.removeItem('operator_token');
      localStorage.removeItem('operator_admin');
      return false;
    }
  };

  const logout = () => {
    const hasSession = Boolean(sessionStorage.getItem('token'));
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('admin');
    if (!hasSession) {
      localStorage.removeItem('token');
      localStorage.removeItem('admin');
    }
    localStorage.removeItem('operator_token');
    localStorage.removeItem('operator_admin');
    setAdmin(null);
  };

  const isImpersonating = Boolean(admin?.operator_impersonation && localStorage.getItem('operator_token'));

  return (
    <AuthContext.Provider value={{ admin, login, logout, loading, impersonateClient, returnToOperator, isImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
