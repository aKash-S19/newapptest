-- Signaling table for 1:1 WebRTC voice calls.
-- Signaling payloads are end-to-end encrypted by the clients.

CREATE TABLE IF NOT EXISTS public.call_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice', 'end', 'decline', 'busy')),
  signal_payload text,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 minutes')
);

CREATE INDEX IF NOT EXISTS idx_call_signals_to_user_created_at
  ON public.call_signals (to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_signals_chat_call_created_at
  ON public.call_signals (chat_id, call_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_call_signals_expires_at
  ON public.call_signals (expires_at);

ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_signals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.call_signals FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'call_signals'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all
      ON public.call_signals
      AS PERMISSIVE
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
