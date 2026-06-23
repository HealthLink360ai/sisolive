const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const { ingestDocument } = require('../services/ingestion.service');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();

const ALLOWED_TYPES = [
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc (older Word)
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_DIR = '/tmp/siso-uploads';
const INGESTION_TIMEOUT_MS = 55000; // Allow up to 55s for AI-based PDF extraction on large files

// Ensure upload directory exists
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* non-fatal */ }

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
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

// Upload handler — shared by POST /api/upload/document and POST /api/admin/upload
async function uploadHandler(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
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

  const documentId = uuidv4();
  const { originalname, size, path: filePath } = req.file;
  const fileType = path.extname(originalname).toLowerCase().slice(1);

  try {
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
        ingestDocument(filePath, documentId, originalname, req.user.id),
        ingestionTimeout,
      ]);
      const doc = await query('SELECT chunk_count FROM documents WHERE id = $1', [documentId]);
      return res.json({
        documentId,
        filename: originalname,
        status: 'active',
        chunkCount: doc.rows[0]?.chunk_count ?? 0,
        message: 'Document processed and ready for queries.',
      });
    } catch (ingestionErr) {
      if (ingestionErr.message === 'timeout') {
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
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
}

// Register on both paths: /document (legacy) and / (frontend calls POST /api/admin/upload)
router.post('/document', requireAdmin, upload.single('file'), handleMulterError, uploadHandler);
router.post('/', upload.single('file'), handleMulterError, uploadHandler);

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
