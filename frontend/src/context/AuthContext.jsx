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
    if (!options.sessionOnly) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('admin');
    }
    storage.setItem('token', token);
    storage.setItem('admin', JSON.stringify(adminData));
    setAdmin(adminData);
  };

  const logout = () => {
    const hasSession = Boolean(sessionStorage.getItem('token'));
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('admin');
    if (!hasSession) {
      localStorage.removeItem('token');
      localStorage.removeItem('admin');
    }
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
