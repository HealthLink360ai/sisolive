const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const { ingestDocument } = require('../services/ingestion.service');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();

const ALLOWED_TYPES = ['application/pdf', 'text/csv', 'text/plain'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const storage = multer.diskStorage({
  destination: '/tmp/siso-uploads/',
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

// POST /api/upload/document — admin only
router.post('/document', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  const documentId = uuidv4();
  const { originalname, mimetype, size, path: filePath } = req.file;
  const fileType = path.extname(originalname).toLowerCase().slice(1);

  try {
    // Create DB record first (status: processing)
    await query(`
      INSERT INTO documents (id, filename, file_type, file_size_bytes, status, uploaded_by)
      VALUES ($1, $2, $3, $4, 'processing', $5)
    `, [documentId, originalname, fileType, size, req.user.id]);

    // Respond immediately — ingestion happens async
    res.json({
      documentId,
      filename: originalname,
      status: 'processing',
      message: 'Document received and queued for processing. This typically takes 30-60 seconds.',
    });

    // Process in background (don't await — response already sent)
    ingestDocument(filePath, documentId, originalname, req.user.id)
      .catch(err => logger.error({ err, documentId }, 'Background ingestion failed'));

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
