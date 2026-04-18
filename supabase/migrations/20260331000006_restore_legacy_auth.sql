-- Restore legacy emoji-pin auth columns for demo

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS device_hash text,
  ADD COLUMN IF NOT EXISTS security_question text,
  ADD COLUMN IF NOT EXISTS security_answer_hash text;

CREATE INDEX IF NOT EXISTS users_device_hash_idx
  ON public.users (device_hash)
  WHERE device_hash IS NOT NULL;

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
DO $$ BEGIN
  CREATE POLICY "service_role_all" ON public.sessions
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
