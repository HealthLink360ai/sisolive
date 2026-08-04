import { useEffect, useState } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';

/* ============================================================
   ADMIN — FEEDBACK
   Ported from index.html (~lines 4248-4329).

   Adds user attribution: the backend now includes user_name (plus
   user_email / user_department) on each feedback row. Displayed
   defensively next to the existing timestamp since older rows or
   edge cases may not have it populated.

   Note: the source file's "Last 30 days ↓" range-pill decoration
   (CSS class .range-pill — non-functional, no onClick, no backend
   date-range support per prior audit) does not appear in this
   component's source range, so there is nothing to strip here.
   ============================================================ */
export default function AdminFeedback() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    AdminAPI.getFeedback()
      .then(d => { setItems(Array.isArray(d) ? d : []); setError(''); setLoading(false); })
      .catch((e) => { setError(e.message || 'Feedback data is temporarily unavailable.'); setLoading(false); });
  }, []);

  const helpful = items.filter(it => it.rating === 'up' || it.rating === 1 || it.rating === true).length;
  const notHelpful = items.filter(it => it.rating === 'down' || it.rating === -1 || it.rating === false).length;
  const withComments = items.filter(it => it.comment && it.comment.trim()).length;

  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (error) {
    return (
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.alert /></span>Feedback <em>unavailable</em></div>
          <span className="panel-tag">CHECK SESSION OR API</span>
        </div>
        <div style={{ padding: '32px 24px', color: 'var(--text-2)', fontSize: 14, lineHeight: 1.55 }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Helpful</div><div className="metric-ic"><Icons.thumbup /></div></div>
          <div className="metric-val green">{loading ? '—' : helpful}</div>
          <div className="metric-foot"><span>rated helpful (30d)</span></div>
        </div>
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Not helpful</div><div className="metric-ic"><Icons.thumbdown /></div></div>
          <div className="metric-val amber">{loading ? '—' : notHelpful}</div>
          <div className="metric-foot"><span>rated not helpful</span></div>
        </div>
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">With comments</div><div className="metric-ic"><Icons.message /></div></div>
          <div className="metric-val">{loading ? '—' : withComments}</div>
          <div className="metric-foot"><span>detailed signal</span></div>
        </div>
        <div className="metric">
          <div className="metric-head"><div className="metric-lbl">Satisfaction</div><div className="metric-ic"><Icons.check /></div></div>
          <div className="metric-val green">
            {loading || items.length === 0 ? '—' : <>{Math.round((helpful / items.length) * 100)}<span className="pct">%</span></>}
          </div>
          <div className="metric-foot"><span>of rated responses</span></div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.thumbup /></span>Recent <em>feedback</em></div>
          <span className="panel-tag">LAST 30 DAYS · {loading ? '…' : items.length} ITEMS</span>
        </div>
        <div className="panel-body" style={{ padding: '4px 12px 12px' }}>
          {loading && <div style={{ padding: '24px 12px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>Loading…</div>}
          {!loading && items.length === 0 && (
            <div style={{ padding: '24px 12px', color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>
              Feedback will appear here as users rate answers.
            </div>
          )}
          {!loading && items.map((it, i) => {
            const isUp = it.rating === 'up' || it.rating === 1 || it.rating === true;
            return (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--rule)' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isUp ? 'var(--teal-soft, #e6f4f1)' : 'var(--signal-soft)',
                  color: isUp ? 'var(--teal)' : 'var(--signal)'
                }}>
                  <div style={{ width: 14, height: 14 }}>{isUp ? <Icons.thumbup /> : <Icons.thumbdown />}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4, marginBottom: 3 }}>{it.question}</div>
                  {it.comment && <div style={{ fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic', lineHeight: 1.4 }}>"{it.comment}"</div>}
                </div>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', flexShrink: 0, textAlign: 'right' }}>
                  <span>{it.user_name || '—'}</span><br />{fmtDate(it.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
