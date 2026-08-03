import { useState } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';

/* ============================================================
   SYSTEM HEALTH PANEL
   Ported verbatim from index.html (~lines 3918-4022).

   Local state: health, running. "Check search health" runs a real
   diagnostic via AdminAPI.getDiagnostics() — Pinecone (search index)
   and Cohere (language model) connection status, plus a live test
   query against the index.
   ============================================================ */
export default function SystemHealthPanel() {
  const [health, setHealth] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const d = await AdminAPI.getDiagnostics();
      setHealth(d);
    } catch (e) {
      setHealth({ error: e.message });
    } finally {
      setRunning(false);
    }
  };

  const pineconeOk = health && health.pinecone?.status === 'connected';
  const cohereOk = health && health.cohere?.status === 'connected';
  const vectorCount = health?.pinecone?.vectorCount;
  const matches = health?.testQuery?.matches || [];

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <div className="panel-title"><span className="panel-title-ic"><Icons.shield /></span>Search <em>health</em></div>
        <button className="export-btn" onClick={run} disabled={running} style={{ opacity: running ? 0.6 : 1 }}>
          {running ? 'Checking...' : 'Check search health'}
        </button>
      </div>
      {!health && !running && (
        <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--text-3)' }}>
          Checks the source index, language model, and a live supplier inclusion source lookup.
        </div>
      )}
      {running && (
        <div style={{ padding: '20px 24px', fontSize: 13, color: 'var(--text-3)' }}>Checking services…</div>
      )}
      {health && !running && (
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {health.error && (
            <div style={{ fontSize: 13, color: 'var(--signal)', background: 'var(--signal-soft)', borderRadius: 8, padding: '10px 14px' }}>
              Diagnostic failed: {health.error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160, background: 'var(--bg-2)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', marginBottom: 4 }}>AI SEARCH INDEX</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: pineconeOk ? 'var(--teal)' : 'var(--signal)' }}>
                {health.pinecone?.status === 'connected' ? 'Connected' : health.pinecone?.status === 'not_initialized' ? 'Not connected' : 'Error'}
              </div>
              {vectorCount != null && (
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                  {vectorCount === 0
                    ? <span style={{ color: 'var(--signal)' }}>No documents are searchable yet</span>
                    : <span style={{ color: 'var(--teal)' }}>{vectorCount} source sections indexed</span>
                  }
                </div>
              )}
              {health.pinecone?.error && <div style={{ fontSize: 11, color: 'var(--signal)', marginTop: 2 }}>{health.pinecone.error}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 160, background: 'var(--bg-2)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', marginBottom: 4 }}>AI LANGUAGE MODEL</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: cohereOk ? 'var(--teal)' : 'var(--signal)' }}>
                {cohereOk ? 'Connected' : 'Error'}
              </div>
              {health.cohere?.error && <div style={{ fontSize: 11, color: 'var(--signal)', marginTop: 2 }}>{health.cohere.error}</div>}
            </div>
            {health.config && (
              <div style={{ flex: 1, minWidth: 160, background: 'var(--bg-2)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', marginBottom: 4 }}>SETTINGS</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
                  <div>Confidence threshold: <strong style={{ color: parseFloat(health.config.confidenceThreshold) > 0.5 ? 'var(--signal)' : 'var(--text)' }}>{health.config.confidenceThreshold}</strong></div>
                  <div>Search index: <strong style={{ color: 'var(--text)' }}>{health.config.pineconeIndex}</strong></div>
                </div>
              </div>
            )}
          </div>
          {matches.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', marginBottom: 8 }}>LIVE TEST: "What is supplier inclusion?" - SOURCE SECTIONS FOUND</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {matches.map((m, i) => (
                  <div key={i} style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{m.source || 'Unknown'}</span>
                      <span style={{ fontFamily: 'var(--mono)', color: m.score >= 0.40 ? 'var(--teal)' : 'var(--signal)' }}>
                        score: {m.score}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-2)', lineHeight: 1.5 }}>{m.preview}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {pineconeOk && cohereOk && matches.length === 0 && vectorCount === 0 && (
            <div style={{ fontSize: 13, color: 'var(--signal)', background: 'var(--signal-soft)', borderRadius: 8, padding: '10px 14px' }}>
              AI services are connected but no documents are searchable yet. Use "Re-index" on each document below to make them available to the AI.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
