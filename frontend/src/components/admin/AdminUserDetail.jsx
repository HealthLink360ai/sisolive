import { useEffect, useState } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';

/* ============================================================
   ADMIN — USER DETAIL (drill-down)
   New component (not in original index.html source). Opened from
   AdminUsers when a user row is clicked. Fetches per-user activity
   via AdminAPI.getUserActivity(userId) and renders the summary as a
   compact stat grid plus the query rows as a scrollable list.

   Follows the modal/dialog convention established in NavAccount.jsx
   (.logout-overlay / .logout-dialog), sized up for the extra content,
   and reuses the existing .metric / .panel classes from global.css
   for visual consistency with the rest of the admin screens.

   Props:
     userId   — id (or fallback identifier) of the user to load
     onClose  — () => void
   ============================================================ */

function pct(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return Math.round(n <= 1 ? n * 100 : n);
}

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function truncate(text, len = 140) {
  if (!text) return '';
  const s = String(text);
  return s.length > len ? s.slice(0, len).trim() + '…' : s;
}

function StatTile({ label, value, icon, tone }) {
  return (
    <div className="metric" style={{ padding: '14px 14px 12px' }}>
      <div className="metric-head" style={{ marginBottom: 8 }}>
        <div className="metric-lbl">{label}</div>
        <div className="metric-ic" style={{ width: 16, height: 16 }}>{icon}</div>
      </div>
      <div className={`metric-val ${tone || ''}`} style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}

export default function AdminUserDetail({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    AdminAPI.getUserActivity(userId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to load user activity.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [userId]);

  const user = data?.user || {};
  const summary = data?.summary || {};
  const rows = data?.queries?.rows || [];
  const total = data?.queries?.total ?? rows.length;
  const initials = (user.name || user.email || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'U';
  const avgConf = pct(summary.avgConfidence);

  return (
    <div className="logout-overlay" onClick={onClose}>
      <div
        className="logout-dialog"
        style={{ width: 680, maxWidth: '100%', maxHeight: '86vh', padding: 0, display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '22px 26px 18px', borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          <div className="user-av-tbl active" style={{ width: 36, height: 36, fontSize: 13 }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text)' }}>
              {user.name || user.email || 'User'}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-3)' }}>
              {user.email || ''}{user.department ? ` · ${user.department}` : ''}
            </p>
          </div>
          <div className="logout-btn ghost" style={{ padding: '7px 9px', flexShrink: 0 }} onClick={onClose}>
            <span style={{ width: 12, height: 12, display: 'inline-block' }}><Icons.close /></span>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '20px 26px 26px' }}>
          {loading && (
            <div style={{ padding: '32px 0', color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'center' }}>
              Loading activity…
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: '32px 0', color: 'var(--signal)', fontSize: 13, textAlign: 'center' }}>{error}</div>
          )}
          {!loading && !error && (
            <>
              <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                <StatTile label="Total queries" value={summary.totalQueries ?? '—'} icon={<Icons.message />} />
                <StatTile label="Queries (30d)" value={summary.totalQueries30d ?? '—'} icon={<Icons.chart />} />
                <StatTile label="Escalations" value={summary.totalEscalations ?? '—'} icon={<Icons.alert />} tone="amber" />
                <StatTile label="Escalations (30d)" value={summary.escalations30d ?? '—'} icon={<Icons.alert />} tone="amber" />
                <StatTile label="Avg confidence" value={avgConf != null ? <>{avgConf}<span className="pct">%</span></> : '—'} icon={<Icons.target />} tone={avgConf != null && avgConf >= 70 ? 'green' : avgConf != null ? 'amber' : ''} />
                <StatTile label="Feedback given" value={summary.feedbackGiven ?? '—'} icon={<Icons.message />} />
                <StatTile label="Thumbs up" value={summary.thumbsUp ?? '—'} icon={<Icons.thumbup />} tone="green" />
                <StatTile label="Thumbs down" value={summary.thumbsDown ?? '—'} icon={<Icons.thumbdown />} tone="amber" />
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div className="panel-title"><span className="panel-title-ic"><Icons.message /></span>Query <em>history</em></div>
                  <span className="panel-tag">{rows.length} OF {total}</span>
                </div>
                <div className="panel-body" style={{ padding: '4px 12px 12px', maxHeight: 360, overflowY: 'auto' }}>
                  {rows.length === 0 && (
                    <div style={{ padding: '24px 12px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
                      No queries from this user yet.
                    </div>
                  )}
                  {rows.map((q) => {
                    const conf = pct(q.confidence_score);
                    const isUp = q.feedback && (q.feedback.rating === 'up' || q.feedback.rating === 1 || q.feedback.rating === true);
                    const isDown = q.feedback && (q.feedback.rating === 'down' || q.feedback.rating === -1 || q.feedback.rating === false);
                    return (
                      <div key={q.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="esc-q">{q.question}</div>
                            {q.answer && (
                              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, marginTop: 4 }}>{truncate(q.answer)}</div>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
                              <span className="esc-meta">{fmtDateTime(q.created_at)}</span>
                              {q.was_escalated ? <span className="esc-state open">ESCALATED</span> : null}
                              {q.feedback && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: isUp ? 'var(--teal)' : isDown ? 'var(--signal)' : 'var(--text-3)' }}>
                                  <span style={{ width: 12, height: 12, display: 'inline-block' }}>{isUp ? <Icons.thumbup /> : <Icons.thumbdown />}</span>
                                  {q.feedback.comment ? `"${q.feedback.comment}"` : (isUp ? 'Helpful' : 'Not helpful')}
                                </span>
                              )}
                            </div>
                          </div>
                          {conf != null && (
                            <div className="esc-conf" style={{ flexShrink: 0 }}>
                              <div className="esc-conf-lbl">CONF</div>
                              <div className={`esc-conf-v ${conf < 40 ? 'warn' : ''}`}>{conf}%</div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
