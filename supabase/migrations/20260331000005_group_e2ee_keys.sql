-- Group E2EE key distribution

CREATE TABLE IF NOT EXISTS public.group_keys (
  group_id      uuid        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  encrypted_key text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE public.group_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "group_keys_read_self" ON public.group_keys
    FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_keys_write_admin" ON public.group_keys
    FOR INSERT TO authenticated WITH CHECK (
      sender_id = auth.uid()
      AND group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid() AND role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "group_keys_update_admin" ON public.group_keys
    FOR UPDATE TO authenticated USING (
      sender_id = auth.uid()
      AND group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid() AND role = 'admin')
    ) WITH CHECK (
      sender_id = auth.uid()
      AND group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid() AND role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
