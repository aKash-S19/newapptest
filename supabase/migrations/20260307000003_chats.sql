-- ── Migration: E2EE Chat Rooms ────────────────────────────────────────────────

-- ── 1. Per-user ECDH public keys (for E2EE key exchange) ─────────────────────
CREATE TABLE IF NOT EXISTS public.user_public_keys (
  user_id    uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  public_key text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_public_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.user_public_keys
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Chat rooms ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chats (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.chats
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Chat members (always 2 for a DM) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_members (
  chat_id   uuid        NOT NULL REFERENCES public.chats(id)   ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- Fast lookup: all chats for a given user
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON public.chat_members (user_id);

ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.chat_members
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. Enable realtime ────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_members;
