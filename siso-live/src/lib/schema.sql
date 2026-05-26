-- ============================================================
-- SISO Live! — PostgreSQL Database Schema
-- AbbVie Precision Learning Tool
-- ============================================================
-- Run this file to set up the database from scratch.
-- Command: psql -U your_user -d siso_live -f schema.sql
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- USERS
-- Stores AbbVie employee accounts.
-- Passwords are hashed with bcrypt (never stored plain text).
-- Role determines access level: 'user' or 'admin'
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  role            VARCHAR(20) NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'admin')),
  department      VARCHAR(100),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  login_count     INTEGER NOT NULL DEFAULT 0,
  last_login      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for fast email lookup on login
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ────────────────────────────────────────────────────────────
-- DOCUMENTS
-- Tracks every document uploaded to the RAG knowledge base.
-- The actual document content lives in Pinecone (vector DB).
-- This table is the admin's view into what's been ingested.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name       VARCHAR(500) NOT NULL,
  file_type       VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing', 'active', 'error', 'archived')),
  chunk_count     INTEGER,
  char_count      INTEGER,
  error_message   TEXT,
  uploaded_by     UUID NOT NULL REFERENCES users(id),
  ingested_at     TIMESTAMP WITH TIME ZONE,
  archived_at     TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);

-- ────────────────────────────────────────────────────────────
-- QUERIES
-- Every question asked through SISO Live! is logged here.
-- This is the core analytics table.
-- Answers compliance requirements (who asked what, when).
-- Powers the admin dashboard (what topics, confidence trends).
-- Links to feedback for the training loop.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queries (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id),
  session_id      UUID NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT,
  confidence      DECIMAL(5,4),       -- e.g. 0.9700 = 97%
  escalated       BOOLEAN NOT NULL DEFAULT false,
  sources         JSONB,              -- Array of source document names
  tokens_used     JSONB,              -- { input, output, total }
  duration_ms     INTEGER,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queries_user_id ON queries(user_id);
CREATE INDEX IF NOT EXISTS idx_queries_session_id ON queries(session_id);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at);
CREATE INDEX IF NOT EXISTS idx_queries_escalated ON queries(escalated);
-- Partial index for fast escalation queries in admin dashboard
CREATE INDEX IF NOT EXISTS idx_queries_escalated_true ON queries(created_at)
  WHERE escalated = true;

-- ────────────────────────────────────────────────────────────
-- FEEDBACK
-- Thumbs up / thumbs down ratings with optional comments.
-- One feedback record per query per user.
-- Powers the "most downvoted topics" panel in admin dashboard.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id        UUID NOT NULL REFERENCES queries(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  rating          VARCHAR(4) NOT NULL CHECK (rating IN ('up', 'down')),
  comment         TEXT,               -- Optional explanation (from thumbs down)
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE,
  -- One feedback per query per user (can update if they change mind)
  UNIQUE(query_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_query_id ON feedback(query_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);

-- ────────────────────────────────────────────────────────────
-- AUDIT LOG
-- Immutable record of all system events.
-- Required for pharma-grade compliance.
-- Covers: logins, queries, document uploads, admin actions.
-- This table is append-only — never update or delete records.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type      VARCHAR(50) NOT NULL,
  user_id         UUID REFERENCES users(id),
  entity_id       UUID,               -- ID of the affected record
  entity_type     VARCHAR(50),        -- 'query', 'document', 'user', etc.
  metadata        JSONB,              -- Event-specific data
  ip_address      INET,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);

-- ────────────────────────────────────────────────────────────
-- API USAGE TRACKING
-- Tracks monthly spend against our budget cap.
-- Aggregated daily — no personal data stored here.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date            DATE NOT NULL,
  provider        VARCHAR(50) NOT NULL, -- 'anthropic', 'cohere', 'pinecone'
  operation       VARCHAR(50) NOT NULL, -- 'query', 'embed', 'ingest'
  tokens_input    INTEGER NOT NULL DEFAULT 0,
  tokens_output   INTEGER NOT NULL DEFAULT 0,
  request_count   INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  UNIQUE(date, provider, operation)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage(date);

-- ────────────────────────────────────────────────────────────
-- HELPFUL VIEWS FOR ADMIN DASHBOARD
-- These pre-built queries make dashboard queries fast.
-- ────────────────────────────────────────────────────────────

-- Daily active users
CREATE OR REPLACE VIEW v_daily_active_users AS
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_queries,
  AVG(confidence) as avg_confidence,
  SUM(CASE WHEN escalated THEN 1 ELSE 0 END) as escalations,
  SUM(CASE WHEN escalated THEN 1 ELSE 0 END)::float / COUNT(*) as escalation_rate
FROM queries
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Top queried topics (last 30 days)
CREATE OR REPLACE VIEW v_top_queries_30d AS
SELECT
  question,
  COUNT(*) as query_count,
  AVG(confidence) as avg_confidence,
  SUM(CASE WHEN escalated THEN 1 ELSE 0 END) as escalation_count
FROM queries
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY question
ORDER BY query_count DESC
LIMIT 50;

-- Feedback summary by source document
CREATE OR REPLACE VIEW v_feedback_by_source AS
SELECT
  source_doc,
  COUNT(*) as total_feedback,
  SUM(CASE WHEN f.rating = 'up' THEN 1 ELSE 0 END) as thumbs_up,
  SUM(CASE WHEN f.rating = 'down' THEN 1 ELSE 0 END) as thumbs_down,
  ROUND(
    SUM(CASE WHEN f.rating = 'up' THEN 1 ELSE 0 END)::numeric /
    NULLIF(COUNT(*), 0) * 100, 1
  ) as satisfaction_pct
FROM feedback f
JOIN queries q ON f.query_id = q.id,
  jsonb_array_elements_text(q.sources) as source_doc
GROUP BY source_doc
ORDER BY total_feedback DESC;
