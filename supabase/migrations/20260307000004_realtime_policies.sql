-- Allow anon role to SELECT friend_requests so realtime events are delivered
-- to the client (which uses the anon key). Without this, the service_role-only
-- RLS blocks realtime broadcast to the anon client entirely.
DO $$ BEGIN
  CREATE POLICY "anon_read_requests" ON public.friend_requests
    FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Same for chat_members so realtime new-chat events are delivered
DO $$ BEGIN
  CREATE POLICY "anon_read_chat_members" ON public.chat_members
    FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
