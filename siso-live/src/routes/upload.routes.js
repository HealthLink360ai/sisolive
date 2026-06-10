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

const ALLOWED_TYPES = ['application/pdf', 'text/csv', 'text/plain'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_DIR = '/tmp/siso-uploads';
const INGESTION_TIMEOUT_MS = 25000;

// Ensure upload directory exists (Vercel /tmp is writable but not pre-created)
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
      cb(new Error(`File type not supported. Allowed: PDF, CSV, TXT`));
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

// POST /api/upload/document — admin only
router.post('/document', requireAdmin, upload.single('file'), handleMulterError, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
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
    logger.error({ error, filename: originalname }, 'Upload failed');
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// GET /api/upload/status/:documentId — check processing status
router.get('/status/:documentId', requireAdmin, async (req, res) => {
  const result = await query(
    'SELECT id, filename, status, chunk_count, processed_at, error_message FROM documents WHERE id = $1',
    [req.params.documentId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
  res.json(result.rows[0]);
});

module.exports = router;
