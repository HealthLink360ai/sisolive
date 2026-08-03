const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const { ingestDocument } = require('../services/ingestion.service');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const { logAudit } = require('../utils/auditLog');
const router = express.Router();

// Fixed allow-list mapping mimetype -> stored extension. The stored
// filename/extension and the file_type recorded in the DB are always
// derived from this map, never from the client-supplied originalname —
// that field is attacker-controlled and only used for display.
const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};
const ALLOWED_TYPES = Object.keys(MIME_TO_EXT);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_DIR = '/tmp/siso-uploads';
const INGESTION_TIMEOUT_MS = 55000; // Allow up to 55s for AI-based PDF extraction on large files

// Ensure upload directory exists
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* non-fatal */ }

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}.${MIME_TO_EXT[file.mimetype] || 'bin'}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported. Allowed: PDF, DOCX, CSV, TXT`));
    }
  },
});

// Client-supplied Content-Type is trivially spoofable, so verify the actual
// file bytes match what was claimed before we trust and ingest it. CSV/TXT
// have no reliable magic number, so those are accepted on mimetype alone.
const FILE_SIGNATURES = {
  pdf: [Buffer.from('%PDF')],
  docx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // docx is a zip container
  doc: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], // OLE compound file
};

function verifyFileSignature(filePath, ext) {
  const expectedSignatures = FILE_SIGNATURES[ext];
  if (!expectedSignatures) return true;
  const buffer = Buffer.alloc(8);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }
  return expectedSignatures.some((sig) => buffer.slice(0, sig.length).equals(sig));
}

// Multer error handler — surfaces file-type and size errors to the client
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
}

const UPLOAD_LIMIT_PER_USER = 20;

// Upload handler — shared by POST /api/upload/document and POST /api/upload/ (both admin-only)
async function uploadHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  const { originalname, size, path: filePath } = req.file;
  const fileType = MIME_TO_EXT[req.file.mimetype];
  // Hoisted so the outer catch (audit logging on failure) can reference it even
  // if the failure happens before/after it's assigned below.
  let documentId;

  try {
    if (!verifyFileSignature(filePath, fileType)) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'File content does not match its declared type.' });
    }

    // Enforce per-user upload limit (admins are exempt)
    if (req.user.role !== 'admin') {
      const countResult = await query(
        'SELECT COUNT(*) FROM documents WHERE uploaded_by = $1 AND status != $2',
        [req.user.id, 'error']
      );
      const count = parseInt(countResult.rows[0].count);
      if (count >= UPLOAD_LIMIT_PER_USER) {
        return res.status(403).json({
          error: `You've reached the ${UPLOAD_LIMIT_PER_USER}-document limit. Please contact your SISO administrator to expand your knowledge base.`,
          code: 'UPLOAD_LIMIT_REACHED',
          current: count,
          limit: UPLOAD_LIMIT_PER_USER,
        });
      }
    }

    documentId = uuidv4();

    // Create DB record first (status: processing)
    await query(`
      INSERT INTO documents (id, filename, file_type, file_size_bytes, status, uploaded_by)
      VALUES ($1, $2, $3, $4, 'processing', $5)
    `, [documentId, originalname, fileType, size, req.user.id]);

    // Run ingestion synchronously with a 25s timeout.
    // On Vercel, the function is killed after the response is sent, so fire-and-forget
    // never completes. We race ingestion against a timeout and return partial status
    // if the document is large enough to need more time.
    const ingestionTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), INGESTION_TIMEOUT_MS)
    );

    try {
      await Promise.race([
        // Pass the server-verified fileType (derived from MIME_TO_EXT above), not the
        // client-controlled originalname — see ingestion.service.js for why.
        ingestDocument(filePath, documentId, originalname, req.user.id, fileType),
        ingestionTimeout,
      ]);
      const doc = await query('SELECT chunk_count FROM documents WHERE id = $1', [documentId]);
      // Awaited (not fire-and-forget) — see the Vercel note above: work started after
      // the response is sent is never guaranteed to complete. logAudit swallows its
      // own errors, so this can't turn an audit-log hiccup into a failed upload.
      await logAudit({
        userId: req.user.id,
        action: 'document.upload',
        entityType: 'document',
        entityId: documentId,
        metadata: { filename: originalname, fileType, sizeBytes: size },
        ipAddress: req.ip,
      });
      return res.json({
        documentId,
        filename: originalname,
        status: 'active',
        chunkCount: doc.rows[0]?.chunk_count ?? 0,
        message: 'Document processed and ready for queries.',
      });
    } catch (ingestionErr) {
      if (ingestionErr.message === 'timeout') {
        await logAudit({
          userId: req.user.id,
          action: 'document.upload',
          entityType: 'document',
          entityId: documentId,
          metadata: { filename: originalname, fileType, sizeBytes: size, status: 'processing' },
          ipAddress: req.ip,
        });
        return res.json({
          documentId,
          filename: originalname,
          status: 'processing',
          message: 'Document is large — processing continues in the background. Check status in a minute.',
        });
      }
      throw ingestionErr;
    }

  } catch (error) {
    logger.error({ errorMessage: error.message, errorStack: error.stack, filename: originalname }, 'Upload failed');
    await logAudit({
      userId: req.user?.id,
      action: 'document.upload_failed',
      entityType: 'document',
      entityId: documentId ?? null,
      metadata: { filename: originalname, fileType, sizeBytes: size, error: error.message },
      ipAddress: req.ip,
    });
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
}

// Register on both paths: /document (the frontend calls POST /api/upload/document) and /
// (legacy path). Both are admin-only — uploads write directly into the shared RAG
// knowledge base, so non-admins must never be able to reach either one.
router.post('/document', requireAdmin, upload.single('file'), handleMulterError, uploadHandler);
router.post('/', requireAdmin, upload.single('file'), handleMulterError, uploadHandler);

// GET /api/upload/status/:documentId — check processing status
router.get('/status/:documentId', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, filename, status, chunk_count, processed_at, error_message FROM documents WHERE id = $1',
      [req.params.documentId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
