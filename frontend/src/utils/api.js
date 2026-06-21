import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const hasSession = Boolean(sessionStorage.getItem('token'));
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('admin');
      const operatorToken = localStorage.getItem('operator_token');
      const operatorAdmin = localStorage.getItem('operator_admin');
      if (operatorToken && operatorAdmin) {
        localStorage.setItem('token', operatorToken);
        localStorage.setItem('admin', operatorAdmin);
        localStorage.removeItem('operator_token');
        localStorage.removeItem('operator_admin');
        window.location.href = '/onboarding/clients';
        return Promise.reject(error);
      }

      if (!hasSession) {
        localStorage.removeItem('token');
        localStorage.removeItem('admin');
      }
      localStorage.removeItem('operator_token');
      localStorage.removeItem('operator_admin');
      const onOnboarding = window.location.pathname.startsWith('/onboarding');
      window.location.href = onOnboarding ? '/onboarding/login' : '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
