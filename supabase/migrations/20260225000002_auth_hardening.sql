-- ── Migration: auth security hardening ───────────────────────────────────────
-- Adds: device_hash, security Q&A to users
-- Creates: sessions, login_attempts

-- ── users: new columns ────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS device_hash          text,
  ADD COLUMN IF NOT EXISTS security_question    text,
  ADD COLUMN IF NOT EXISTS security_answer_hash text;

CREATE INDEX IF NOT EXISTS users_device_hash_idx
  ON public.users (device_hash)
  WHERE device_hash IS NOT NULL;

-- ── sessions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT now() + INTERVAL '30 days',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON public.sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON public.sessions (user_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.sessions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── login_attempts (rate limiting) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username     text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_username_time_idx
  ON public.login_attempts (username, attempted_at);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.login_attempts
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
