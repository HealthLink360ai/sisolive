import { useState, useRef } from 'react';
import Icons from '../icons/Icons.jsx';
import { AdminAPI } from '../../api/admin.js';

/* ============================================================
   ADMIN UPLOAD
   Ported verbatim from index.html (~lines 3812-3913).

   Local state: files[], dragOver — plus a file input ref.
   Uploads go through AdminAPI.uploadDocument(). Drag/drop zone
   with per-file progress in the upload queue below it.
   ============================================================ */
export default function AdminUpload() {
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();

  const handleFiles = async (fileList) => {
    const newFiles = Array.from(fileList).map(f => ({
      file: f, name: f.name, size: f.size, status: 'Uploading', pct: 0, id: Date.now() + Math.random()
    }));
    setFiles(prev => [...prev, ...newFiles]);

    for (const item of newFiles) {
      try {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, pct: 30, status: 'Processing' } : f));
        await AdminAPI.uploadDocument(item.file);
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, pct: 100, status: 'Indexed', error: null } : f));
      } catch (e) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, pct: 0, status: 'Failed', error: e.message || 'Upload failed' } : f));
      }
    }
  };

  const fmtSize = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

  return (
    <>
      <div className="panel" style={{ overflow: 'visible' }}>
        <div className="panel-head">
          <div className="panel-title"><span className="panel-title-ic"><Icons.upload /></span>Add to <em>knowledge base</em></div>
          <span className="panel-tag">CHUNKED &amp; EMBEDDED ON UPLOAD</span>
        </div>
        <div className="panel-body" style={{ padding: '16px 20px 20px', overflow: 'visible' }}>
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.csv,.txt"
            style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
          <div
            className="upload-zone"
            style={{ padding: '44px 24px', borderColor: dragOver ? 'var(--ink)' : undefined, background: dragOver ? 'var(--paper-2)' : undefined }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}>
            <div className="up-ic"><div style={{ width: 22, height: 22 }}><Icons.upload /></div></div>
            <div className="up-h">Drop files to ingest</div>
            <div className="up-p">PDF, DOCX, CSV, and TXT files are processed into searchable source sections after upload.</div>
            <div className="file-pills">
              {['PDF', 'DOCX', 'CSV', 'TXT'].map((t) => (
                <span key={t} className="file-pill">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title"><span className="panel-title-ic"><Icons.refresh /></span>Upload <em>queue</em></div>
            <span className="panel-tag">{files.length} FILES</span>
          </div>
          <div className="panel-body">
            {files.map((f) => (
              <div key={f.id} className="upload-row">
                <div className="upload-row-ic"><Icons.files /></div>
                <div className="upload-row-main">
                  <div className="upload-row-name">{f.name}</div>
                  <div className="upload-row-meta" style={{ color: f.status === 'Failed' ? 'var(--warn, #c0392b)' : undefined }}>
                    {f.status} · {fmtSize(f.size)}
                  </div>
                  {f.error && <div style={{ fontSize: 11, color: 'var(--warn, #c0392b)', marginTop: 2, lineHeight: 1.4 }}>{f.error}</div>}
                  <div className="upload-progress">
                    <div className="upload-progress-fill" style={{ width: `${f.pct}%` }} />
                  </div>
                </div>
                <span className="upload-pct">{f.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><div className="panel-title"><span className="panel-title-ic"><Icons.info /></span>Ingestion <em>tips</em></div><span className="panel-tag">BEST PRACTICES</span></div>
        <div className="panel-body" style={{ padding: '4px 8px 12px' }}>
          {[
            ['Use descriptive filenames', 'They become part of source attribution.'],
            ['Prefer text-native PDFs', 'OCR works on scans but adds latency.'],
            ['Add a one-page summary', 'Improves search quality for broad questions.'],
            ['Mark drafts clearly', 'Use "Draft" in the filename to gate confidence.']
          ].map(([t, d]) => (
            <div key={t} className="tip-row">
              <div className="tip-ic"><Icons.check /></div>
              <div>
                <div className="tip-t">{t}</div>
                <div className="tip-d">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
