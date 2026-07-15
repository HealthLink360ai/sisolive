import { API_BASE, getToken } from './client.js';

export const AuthAPI = {
  async login(email, password) {
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Login failed');
    return d;
  },
  async validate() {
    const r = await fetch(`${API_BASE}/api/auth/validate`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!r.ok) throw new Error('Session invalid');
    return r.json();
  }
};
