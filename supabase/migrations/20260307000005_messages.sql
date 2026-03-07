-- ── Migration: Messages + Chat enhancements ──────────────────────────────────

-- Add last_read_at to chat_members (tracks when user last read each chat)
ALTER TABLE public.chat_members ADD COLUMN IF NOT EXISTS last_read_at timestamptz;

-- Add last_message_at to chats (for efficient sorting by recency)
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

-- ── Messages table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id        uuid        NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  encrypted_body text        NOT NULL,
  msg_type       text        NOT NULL DEFAULT 'text'
    CHECK (msg_type IN ('text','image','video','file','voice')),
  file_name      text,
  file_size      bigint,
  mime_type      text,
  status         text        NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','delivered','read')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_chat_created_idx
  ON public.messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_idx
  ON public.messages (sender_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all" ON public.messages
    AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow anon to SELECT so realtime events are delivered to the client
DO $$ BEGIN
  CREATE POLICY "anon_read_messages" ON public.messages
    FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow anon to SELECT user_public_keys (needed for key exchange)
DO $$ BEGIN
  CREATE POLICY "anon_read_public_keys" ON public.user_public_keys
    FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
