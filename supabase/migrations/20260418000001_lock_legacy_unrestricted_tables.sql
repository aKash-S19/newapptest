-- Lock down legacy/unused unrestricted tables without impacting active app flows.
-- This is intentionally conservative: active realtime/client tables are handled in a later phase.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chat_group_members',
    'chat_groups',
    'chat_messages',
    'group_chat_members',
    'group_chats',
    'group_join_confirmations',
    'group_key_rotations',
    'group_member_keys',
    'group_message_receipts',
    'group_typing_presence',
    'group_invite_links'
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
