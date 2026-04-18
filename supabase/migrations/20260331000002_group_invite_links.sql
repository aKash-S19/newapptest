-- Group invite links for join by code

CREATE TABLE IF NOT EXISTS public.group_invite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  uses_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.group_invite_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_invite_links' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.group_invite_links
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
