const STORAGE_KEY = 'nexa-theme';

export function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
}

export function resolveTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

export function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'system';
}

export function applyTheme(mode = getStoredTheme()) {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle('theme-dark', resolved === 'dark');
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
}

export function saveTheme(mode) {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}
