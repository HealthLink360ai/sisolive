import { useEffect, useState } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';

/* ============================================================
   ADMIN — ESCALATIONS
   Ported from index.html (~lines 4165-4243).

   Adds user attribution: the backend now includes user_name (plus
   user_email / user_department) on each escalation row. Displayed
   defensively next to the existing timestamp since older rows or
   edge cases may not have it populated.

   Note: the source file's "Last 30 days ↓" range-pill decoration
   (CSS class .range-pill — non-functional, no onClick, no backend
   date-range support per prior audit) does not appear in this
   component's source range, so there is nothing to strip here.
   ============================================================ */
export default function AdminEscalations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AdminAPI.getEscalations()
      .then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Total (30d)</div><div className="metric-ic"><Icons.alert /></div></div>
          <div className="metric-val amber">{loading ? '—' : items.length}</div>
          <div className="metric-foot"><span>questions escalated</span></div>
        </div>
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Avg confidence</div><div className="metric-ic"><Icons.target /></div></div>
          <div className="metric-val">
            {loading || items.length === 0 ? '—' : Math.round(items.reduce((s, it) => s + (parseFloat(it.confidence_score) || 0), 0) / items.length * 100) + '%'}
          </div>
          <div className="metric-foot"><span>at time of escalation</span></div>
        </div>
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Below 40%</div><div className="metric-ic"><Icons.refresh /></div></div>
          <div className="metric-val amber">
            {loading ? '—' : items.filter(it => parseFloat(it.confidence_score) < 0.40).length}
          </div>
          <div className="metric-foot"><span>very low confidence</span></div>
        </div>
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Unique questions</div><div className="metric-ic"><Icons.message /></div></div>
          <div className="metric-val">
            {loading ? '—' : new Set(items.map(it => it.question)).size}
          </div>
          <div className="metric-foot"><span>distinct escalations</span></div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.alert /></span>Escalation <em>log</em></div>
          <span className="panel-tag">LAST 30 DAYS · {loading ? '…' : items.length} ITEMS</span>
        </div>
        <div className="panel-body" style={{ padding: '4px 12px 12px' }}>
          {loading && <div style={{ padding: '24px 12px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>Loading…</div>}
          {!loading && items.length === 0 && (
            <div style={{ padding: '24px 12px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No escalations in the last 30 days.</div>
          )}
          {!loading && items.map((it, i) => {
            const conf = it.confidence_score != null ? Math.round(parseFloat(it.confidence_score) * 100) : null;
            return (
              <div key={i} className="esc-row">
                <span className="esc-state open">ESCALATED</span>
                <div className="esc-main">
                  <div className="esc-q">{it.question}</div>
                  <div className="esc-meta"><strong>{it.user_name || '—'}</strong> · {fmtDate(it.created_at)}</div>
                </div>
                {conf != null && (
                  <div className="esc-conf">
                    <div className="esc-conf-lbl">CONF</div>
                    <div className={`esc-conf-v ${conf < 40 ? 'warn' : ''}`}>{conf}%</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
