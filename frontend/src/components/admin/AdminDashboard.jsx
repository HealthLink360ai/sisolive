import { useState, useEffect } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';

/* ============================================================
   ADMIN — DASHBOARD
   Ported from index.html (~lines 3594-3747).

   Local state: stats, loading, error. Calls AdminAPI.getStats().
   Renders a metrics grid, a top-queries panel, and a knowledge-gaps
   panel with a designed "no gaps detected" empty state.

   API response shape is unchanged: { activeUsers, totalQueries,
   escalationRate, monthlySpend, avgConfidence, topQueries,
   knowledgeGaps, insightLabels, ... }. `activeUsers` is now computed
   from query activity rather than logins on the backend — no
   frontend change needed, the field is rendered as-is. `monthlySpend`
   is a real backend field but is intentionally not shown here per
   request — this component just doesn't render it.

   Audit fixes applied vs. the original markup:
   - Removed the "REVIEW" static text label on knowledge-gap rows
     (index.html ~line 3738, `.gap-action`) — it had no onClick and
     did nothing.
   - The decorative "Last 30 days ↓" `.range-pill` lives in the
     AdminScreen shell (index.html ~line 4410), not in this
     component's original render range, so there is nothing to
     remove here; flagging so it isn't reintroduced when the shell
     is ported.
   ============================================================ */
export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    AdminAPI.getStats()
      .then(d => { setStats(d); setError(''); setLoading(false); })
      .catch((e) => { setError(e.message || 'Dashboard data is temporarily unavailable.'); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 40, color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'center' }}>
        Loading dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.alert /></span>Dashboard <em>unavailable</em></div>
          <span className="panel-tag">CHECK SESSION OR API</span>
        </div>
        <div style={{ padding: '32px 24px', color: 'var(--text-2)', fontSize: 14, lineHeight: 1.55 }}>
          {error}
        </div>
      </div>
    );
  }

  const s = stats || {};
  const activeUsers = s.activeUsers ?? s.total_users ?? '—';
  const totalQueries = s.totalQueries ?? s.query_count ?? '—';
  const avgConf = s.avgConfidence ?? s.avg_confidence ?? '—';
  const escalationRate = s.escalationRate ?? s.escalation_rate ?? '—';
  const topQueries = s.topQueries || s.top_queries || [];
  const knowledgeGaps = s.knowledgeGaps || s.knowledge_gaps || [];
  const insightLabels = s.insightLabels || {};
  const normalizeInsight = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const topQueryKeys = new Set(topQueries.map(([t]) => normalizeInsight(t)));
  const uniqueKnowledgeGaps = knowledgeGaps
    .filter(([t]) => !topQueryKeys.has(normalizeInsight(t)))
    .slice(0, 4);

  return (
    <>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-head">
            <div className="metric-lbl">Active users</div>
            <div className="metric-ic"><Icons.users /></div>
          </div>
          <div className="metric-val">{activeUsers}</div>
          <div className="metric-foot"><span>this month</span></div>
        </div>
        <div className="metric">
          <div className="metric-head">
            <div className="metric-lbl">Total queries</div>
            <div className="metric-ic"><Icons.message /></div>
          </div>
          <div className="metric-val">{totalQueries}</div>
          <div className="metric-foot"><span>this month</span></div>
        </div>
        <div className="metric">
          <div className="metric-head">
            <div className="metric-lbl">Avg confidence</div>
            <div className="metric-ic"><Icons.target /></div>
          </div>
          <div className={`metric-val ${avgConf !== '—' && avgConf >= 70 ? 'green' : avgConf !== '—' ? 'amber' : ''}`}>
            {avgConf !== '—' ? <>{avgConf}<span className="pct">%</span></> : '—'}
          </div>
          <div className="metric-foot"><span>source match quality</span></div>
        </div>
        <div className="metric">
          <div className="metric-head">
            <div className="metric-lbl">Escalation rate</div>
            <div className="metric-ic"><Icons.alert /></div>
          </div>
          <div className="metric-val amber">
            {escalationRate !== '—' ? <>{escalationRate}<span className="pct">%</span></> : '—'}
          </div>
          <div className="metric-foot"><span>sent to support</span></div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-title-ic"><Icons.chart /></span>
              {(insightLabels.topQueries || 'Answered demand').split(' ')[0]} <em>{(insightLabels.topQueries || 'Answered demand').split(' ').slice(1).join(' ') || 'questions'}</em>
            </div>
            <span className="panel-tag">ANSWERED FROM APPROVED SOURCES</span>
          </div>
          <div className="panel-body">
            {topQueries.length === 0 ? (
              <div style={{ padding: '24px 12px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
                No answered questions yet.
              </div>
            ) : topQueries.slice(0, 4).map(([t, c, w], i) => (
              <div key={t} className="q-row">
                <span className="q-rank">{String(i + 1).padStart(2, '0')}</span>
                <span className="q-text">{t}</span>
                <div className="q-bar"><div className="q-bar-fill" style={{ width: `${w}%` }} /></div>
                <span className="q-count">{c}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">
              <span className="panel-title-ic"><Icons.alert /></span>
              {(insightLabels.knowledgeGaps || 'Needs review').split(' ')[0]} <em>{(insightLabels.knowledgeGaps || 'Needs review').split(' ').slice(1).join(' ') || 'review'}</em>
            </div>
            <span className="panel-tag">ESCALATED OR LOW CONFIDENCE</span>
          </div>
          <div className="panel-body">
            {uniqueKnowledgeGaps.length === 0 ? (
              <div style={{ padding: '28px 20px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(21,183,154,0.10)', border: '1px solid rgba(21,183,154,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}>
                  <div style={{ width: 20, height: 20 }}><Icons.check /></div>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6, letterSpacing: '-0.01em' }}>No gaps detected this month</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 320 }}>
                    This panel surfaces questions learners asked that SISO Live! couldn't answer confidently — either escalated to support or answered below 25% confidence. When those appear, they'll show up here ranked by frequency so you know exactly what content to add next.
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingTop: 4 }}>
                  {['Escalated questions', 'Low-confidence answers', 'Content to upload next'].map(label => (
                    <span key={label} style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', padding: '4px 10px', borderRadius: 999, background: 'var(--paper-3)', border: '1px solid var(--rule)', color: 'var(--text-3)' }}>{label}</span>
                  ))}
                </div>
              </div>
            ) : uniqueKnowledgeGaps.map(([t, c]) => (
              <div key={t} className="gap-row">
                <div className="gap-dot" />
                <span className="gap-text">{t}</span>
                <span className="gap-count">{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
