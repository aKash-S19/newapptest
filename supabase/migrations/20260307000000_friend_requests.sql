-- ── Migration: friend_requests table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON public.friend_requests (receiver_id, status);
CREATE INDEX IF NOT EXISTS friend_requests_sender_idx   ON public.friend_requests (sender_id, status);

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.friend_requests
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
