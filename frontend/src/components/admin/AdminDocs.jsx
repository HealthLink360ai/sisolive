import { useState, useEffect } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';
import SystemHealthPanel from './SystemHealthPanel.jsx';

/* ============================================================
   ADMIN DOCS
   Ported verbatim from index.html (~lines 4027-4159).

   Local state: docs, loading, filter, searchTerm, reindexing{}.
   Renders SystemHealthPanel at the top. Uses native confirm()/
   alert() for delete/reingest — intentional, ported as-is.
   ============================================================ */
export default function AdminDocs() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All documents');
  const [searchTerm, setSearchTerm] = useState('');
  const [reindexing, setReindexing] = useState({});

  useEffect(() => {
    AdminAPI.getDocs()
      .then(d => { setDocs(Array.isArray(d) ? d : (d.documents || d.docs || [])); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this document from the knowledge base?')) return;
    try {
      await AdminAPI.deleteDoc(id);
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      alert('Failed to delete document: ' + e.message);
    }
  };

  const handleReingest = async (id) => {
    setReindexing(prev => ({ ...prev, [id]: true }));
    try {
      const result = await AdminAPI.reingestDoc(id);
      setDocs(prev => prev.map(d => d.id === id ? { ...d, has_vectors: true, status: 'active', chunk_count: result.chunkCount } : d));
    } catch (e) {
      alert('Re-index failed: ' + e.message);
    } finally {
      setReindexing(prev => ({ ...prev, [id]: false }));
    }
  };

  if (loading) {
    return <div style={{ padding: 40, color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'center' }}>Loading documents…</div>;
  }

  const needsReindex = docs.some(d => d.has_vectors === false);
  const filteredDocs = docs.filter((d) => {
    const missingVectors = d.has_vectors === false;
    if (filter === 'Searchable' && missingVectors) return false;
    if (filter === 'Needs indexing' && !missingVectors) return false;
    const haystack = `${d.name || ''} ${d.filename || ''} ${d.title || ''} ${d.file_type || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase().trim());
  });

  return (
    <>
      <SystemHealthPanel />

      {needsReindex && (
        <div style={{ background: 'var(--signal-soft)', border: '1px solid var(--signal)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--signal)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 16, height: 16, flexShrink: 0 }}><Icons.alert /></div>
          Some documents aren't searchable yet. Click <strong>Re-index</strong> next to each affected document to activate it. This usually takes under 30 seconds.
        </div>
      )}

      <div className="docs-toolbar">
        <div className="docs-search">
          <div className="docs-search-ic"><Icons.search /></div>
          <input
            placeholder="Search documents, topics, sources..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="docs-filters">
          {['All documents', 'Searchable', 'Needs indexing'].map((t) => (
            <span key={t} className={`docs-chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>{t}</span>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.files /></span>All <em>documents</em></div>
          <span className="panel-tag">{filteredDocs.length} OF {docs.length} DOCUMENTS</span>
        </div>
        {docs.length === 0 ? (
          <div style={{ padding: '40px 20px', color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>
            No documents in the knowledge base yet. Upload files above to get started.
          </div>
        ) : (
          <div className="docs-table">
            <div className="docs-table-head">
            <span>Document</span><span>Sections</span><span>Status</span><span></span>
            </div>
            {filteredDocs.length === 0 && (
              <div style={{ padding: '28px 20px', color: 'var(--text-3)', fontSize: 14, textAlign: 'center' }}>
                No documents match this view.
              </div>
            )}
            {filteredDocs.map((d) => {
              const missingVectors = d.has_vectors === false;
              return (
                <div key={d.id || d.name} className="docs-table-row">
                  <div className="doc-row-main" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className="doc-row-ic"><div style={{ width: 15, height: 15 }}><Icons.files /></div></div>
                    <div>
                      <div className="doc-name">{d.name || d.filename || d.title}</div>
                      <div className="doc-meta">{d.file_type?.toUpperCase() || ''} {d.file_size_bytes ? `· ${Math.round(d.file_size_bytes / 1024)}KB` : ''}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{d.chunk_count ? `${d.chunk_count} sections` : '-'}</span>
                  <span className={`doc-status ${missingVectors ? 'warn' : ''}`}>
                    {missingVectors ? 'NOT SEARCHABLE' : (d.status || 'ACTIVE').toUpperCase()}
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {missingVectors && (
                      <button
                        className="export-btn"
                        style={{ padding: '5px 10px', fontSize: 11, background: 'var(--signal)', color: '#fff' }}
                        onClick={() => handleReingest(d.id)}
                        disabled={reindexing[d.id]}
                      >
                        {reindexing[d.id] ? 'Indexing...' : 'Re-index'}
                      </button>
                    )}
                    <button className="doc-action-btn" onClick={() => handleDelete(d.id)}>
                      <div style={{ width: 14, height: 14 }}><Icons.close /></div>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
