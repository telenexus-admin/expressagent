export function isStrongAdminPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) return false;
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length >= 3;
}

export const adminPasswordHelp = 'Use 12+ characters with at least three of: uppercase, lowercase, number, symbol.';
