import { API_BASE, getToken, dispatchUnauthorized } from './client.js';

export const ChatAPI = {
  async query(question, conversationHistory) {
    const r = await fetch(`${API_BASE}/api/chat/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ question, conversationHistory: conversationHistory || [] })
    });
    if (r.status === 401) { dispatchUnauthorized(); throw new Error('Session expired. Please sign in again.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Query failed');
    return d;
  },
  async feedback(messageId, type, comment) {
    const r = await fetch(`${API_BASE}/api/chat/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ queryId: messageId, rating: type, comment })
    });
    if (r.status === 401) { dispatchUnauthorized(); return; }
    if (!r.ok) throw new Error('Feedback failed');
    return r.json();
  }
};
