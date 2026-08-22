'use strict';

function isStrongAdminPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  return classes >= 3;
}

function strongAdminPassword(value) {
  if (!isStrongAdminPassword(value)) {
    throw new Error('Password must be 12-128 characters and include at least three of: uppercase, lowercase, number, symbol.');
  }
  return true;
}

module.exports = { isStrongAdminPassword, strongAdminPassword };
