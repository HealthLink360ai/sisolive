import { API_BASE, getToken, dispatchUnauthorized } from './client.js';

export const AdminAPI = {
  async getStats() {
    const r = await fetch(`${API_BASE}/api/admin/dashboard`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    if (!r.ok) throw new Error('Failed to load stats');
    return r.json();
  },
  async getUsers() {
    const r = await fetch(`${API_BASE}/api/admin/users`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    if (!r.ok) throw new Error('Failed to load users');
    return r.json();
  },
  async uploadDocument(file) {
    const formData = new FormData();
    formData.append('file', file);
    const r = await fetch(`${API_BASE}/api/upload/document`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    if (!r.ok) throw new Error(d.error || 'Upload failed');
    return d;
  },
  async getDocs() {
    const r = await fetch(`${API_BASE}/api/admin/documents`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    if (!r.ok) throw new Error('Failed to load documents');
    return r.json();
  },
  async deleteDoc(id) {
    const r = await fetch(`${API_BASE}/api/admin/documents/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    if (!r.ok) throw new Error('Failed to delete document');
    return r.json();
  },
  async reingestDoc(id) {
    const r = await fetch(`${API_BASE}/api/admin/documents/${id}/reingest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Re-index failed');
    return d;
  },
  async getDiagnostics() {
    const r = await fetch(`${API_BASE}/api/admin/diagnostics`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!r.ok) throw new Error('Failed to run diagnostics');
    return r.json();
  },
  async getEscalations() {
    const r = await fetch(`${API_BASE}/api/admin/analytics/escalations`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!r.ok) throw new Error('Failed to load escalations');
    return r.json();
  },
  async getFeedback() {
    const r = await fetch(`${API_BASE}/api/admin/analytics/feedback`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!r.ok) throw new Error('Failed to load feedback');
    return r.json();
  },
  async getUserActivity(userId, { page = 1, pageSize = 20 } = {}) {
    const r = await fetch(`${API_BASE}/api/admin/users/${userId}/activity?page=${page}&pageSize=${pageSize}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    if (!r.ok) throw new Error('Failed to load user activity');
    return r.json();
  }
};
