import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 30000,
});

const csrfToken = () => {
  const match = document.cookie.match(/(?:^|;\s*)polyizon_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
};

function isPublicCustomerPath(pathname = window.location.pathname) {
  const path = String(pathname || '/');
  return [
    '/pppoe',
    '/hotspot',
    '/agent',
    '/client-access',
    '/self-onboarding',
    '/customer-intake',
    '/relocation-request',
    '/installation-work-order',
    '/public/noc',
    '/signup',
    '/forgot-password',
    '/reset-password',
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

api.interceptors.request.use((config) => {
  const method = String(config.method || 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = csrfToken();
    if (token) config.headers['X-CSRF-Token'] = token;
  }
  const activeAgentWorkspace = localStorage.getItem('active_agent_workspace_id');
  if (activeAgentWorkspace) config.headers['X-Agent-Workspace-Id'] = activeAgentWorkspace;
  return config;
});

let refreshPromise = null;

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = api.post('/auth/refresh', null, {
      skipAuthRefresh: true,
      skipAuthRedirect: true,
      headers: { 'X-CSRF-Token': csrfToken() },
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const status = error.response?.status;
    const isAuthEndpoint = String(config.url || '').includes('/auth/');
    const publicCustomerPath = isPublicCustomerPath();

    if (
      status === 401 &&
      !publicCustomerPath &&
      !config.skipAuthRefresh &&
      !config._sessionRetried &&
      !isAuthEndpoint
    ) {
      config._sessionRetried = true;
      try {
        await refreshSession();
        const token = csrfToken();
        if (token && !['GET', 'HEAD', 'OPTIONS'].includes(String(config.method || 'get').toUpperCase())) {
          config.headers['X-CSRF-Token'] = token;
        }
        return api.request(config);
      } catch {
        // The redirect below handles an expired or revoked admin session.
      }
    }

    if (
      status === 401 &&
      !publicCustomerPath &&
      !config.skipAuthRedirect &&
      !isAuthEndpoint
    ) {
      const onOnboarding = window.location.pathname.startsWith('/onboarding') || window.location.pathname.startsWith('/admin');
      const target = onOnboarding ? '/onboarding/login' : '/login';
      if (window.location.pathname !== target) window.location.assign(target);
    }

    return Promise.reject(error);
  },
);

export { csrfToken, isPublicCustomerPath };
export default api;
