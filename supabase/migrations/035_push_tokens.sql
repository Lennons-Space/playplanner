-- Migration 035: push_tokens table
--
-- PURPOSE
-- -------
-- Stores Expo push tokens so the server can send notifications to users.
-- One user can have multiple tokens (one per device). Tokens are deleted
-- automatically when the user's account is deleted (ON DELETE CASCADE),
-- which satisfies GDPR Art.17 (right to erasure) without extra code.
--
-- PRIVACY
-- -------
-- Push tokens are device-level identifiers and are therefore personal data
-- under UK/EU GDPR. RLS ensures users can only read and write their own rows.
-- The service role (Edge Functions only) bypasses RLS server-side when needed.
--
-- TOKEN LIFETIME
-- ------
-- Expo push tokens persist until the user reinstalls the app or revokes
-- notification permission. The `updated_at` column lets us detect stale tokens
-- and prune them during a future cleanup job if needed.

CREATE TABLE push_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text        NOT NULL,
  platform    text        NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- One row per (user, token) pair — prevents duplicate registrations when
  -- the app calls upsert on every launch after re-granting permission.
  UNIQUE (user_id, token)
);

-- RLS: users can only access their own tokens. The Edge Function uses the
-- service role key (bypasses RLS), which is safe because it runs server-side.
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own push tokens"
  ON push_tokens FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index speeds up the per-user token lookup in the Edge Function.
CREATE INDEX push_tokens_user_id_idx ON push_tokens (user_id);

-- Auto-update updated_at on upsert so we can track token freshness.
CREATE OR REPLACE FUNCTION update_push_token_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION update_push_token_updated_at();
