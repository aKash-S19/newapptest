-- Lock down active app tables now that client reads/writes are mediated by edge functions.
-- This migration removes direct anon/authenticated table access and keeps service_role access only.

-- Remove legacy permissive anon read policies from older migrations.
DROP POLICY IF EXISTS anon_read_messages ON public.messages;
DROP POLICY IF EXISTS anon_read_public_keys ON public.user_public_keys;
DROP POLICY IF EXISTS anon_read_requests ON public.friend_requests;
DROP POLICY IF EXISTS anon_read_chat_members ON public.chat_members;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chats',
    'chat_members',
    'messages',
    'friend_requests',
    'groups',
    'group_members',
    'group_keys',
    'user_public_keys',
    'group_join_requests',
    'group_reports',
    'group_bans'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);

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
