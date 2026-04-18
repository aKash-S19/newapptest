-- Secure RLS for Supabase Auth + remove anon access

-- Remove legacy sensitive columns
ALTER TABLE public.users
  DROP COLUMN IF EXISTS password_hash,
  DROP COLUMN IF EXISTS device_hash,
  DROP COLUMN IF EXISTS security_question,
  DROP COLUMN IF EXISTS security_answer_hash;

-- Remove anon read policies
DROP POLICY IF EXISTS anon_read_messages ON public.messages;
DROP POLICY IF EXISTS anon_read_public_keys ON public.user_public_keys;
DROP POLICY IF EXISTS anon_read_requests ON public.friend_requests;
DROP POLICY IF EXISTS anon_read_chat_members ON public.chat_members;

-- Users: allow authenticated read, self insert/update
DO $$ BEGIN
  CREATE POLICY "users_read_all" ON public.users
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "users_insert_self" ON public.users
    FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "users_update_self" ON public.users
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- User settings: only owner
DO $$ BEGIN
  CREATE POLICY "settings_read_own" ON public.user_settings
    FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "settings_upsert_own" ON public.user_settings
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "settings_update_own" ON public.user_settings
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Public keys: authenticated read, self write
DO $$ BEGIN
  CREATE POLICY "public_keys_read_auth" ON public.user_public_keys
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "public_keys_write_self" ON public.user_public_keys
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "public_keys_update_self" ON public.user_public_keys
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Friend requests: only involved users
DO $$ BEGIN
  CREATE POLICY "friend_requests_read" ON public.friend_requests
    FOR SELECT TO authenticated USING (sender_id = auth.uid() OR receiver_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "friend_requests_insert" ON public.friend_requests
    FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "friend_requests_update" ON public.friend_requests
    FOR UPDATE TO authenticated USING (sender_id = auth.uid() OR receiver_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "friend_requests_delete" ON public.friend_requests
    FOR DELETE TO authenticated USING (sender_id = auth.uid() OR receiver_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Chats + members: read only for members
DO $$ BEGIN
  CREATE POLICY "chat_members_read" ON public.chat_members
    FOR SELECT TO authenticated USING (
      chat_id IN (SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "chats_read" ON public.chats
    FOR SELECT TO authenticated USING (
      id IN (SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Messages: read for members of chat or group
DO $$ BEGIN
  CREATE POLICY "messages_read_members" ON public.messages
    FOR SELECT TO authenticated USING (
      (chat_id IS NOT NULL AND chat_id IN (SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid()))
      OR
      (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
