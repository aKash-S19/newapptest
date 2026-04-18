-- Security hardening without changing the custom edge-function auth flow.
-- This migration is additive and backward-compatible.

-- Enforce encrypted message wire format for all new writes.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    ALTER TABLE public.messages
      DROP CONSTRAINT IF EXISTS messages_encrypted_body_format_chk;

    ALTER TABLE public.messages
      ADD CONSTRAINT messages_encrypted_body_format_chk
      CHECK (
        encrypted_body ~ '^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$'
      ) NOT VALID;
  END IF;
END $$;

-- Lock down auth-critical tables from direct anon/authenticated access.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'sessions',
    'login_attempts',
    'user_settings',
    'user_username_history'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Ensure service_role policy exists on the same auth-critical tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users',
    'sessions',
    'login_attempts',
    'user_settings',
    'user_username_history'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND policyname = 'service_role_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "service_role_all" ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;
