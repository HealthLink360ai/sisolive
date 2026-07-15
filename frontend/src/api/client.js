/* ============================================================
   SISO LIVE! · API CLIENT
   API_BASE → same-origin /api proxy (dev server proxies /api to
   the backend per vite.config.js; production serves same-origin).
   ============================================================ */

export const API_BASE = '';

export const TOKEN_KEY = 'siso_token';
export const USER_KEY = 'siso_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Global 401 handler — set by App on mount, called by any API that gets Unauthorized
let _onUnauthorized = null;
export function setOnUnauthorized(fn) {
  _onUnauthorized = fn;
}
export function dispatchUnauthorized() {
  if (_onUnauthorized) _onUnauthorized();
}
