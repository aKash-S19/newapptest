-- Track username changes and enforce case-insensitive uniqueness
CREATE TABLE IF NOT EXISTS public.user_username_history (
  id           bigserial   PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  old_username text        NOT NULL,
  new_username text        NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_username_history_user_idx
  ON public.user_username_history (user_id, changed_at DESC);

ALTER TABLE public.user_username_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all" ON public.user_username_history
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Case-insensitive uniqueness for usernames
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
    ON public.users (lower(username));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
