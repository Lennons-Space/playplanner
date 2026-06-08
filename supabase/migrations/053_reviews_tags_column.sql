-- Migration 037 was never applied to production, leaving tags missing.
-- Applied directly to prod 2026-06-09 via ALTER TABLE; this file records it.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS tags text[];
