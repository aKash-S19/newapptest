-- Allow group messages to share the messages table
-- Add group_id and allow chat_id to be null for group messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  ALTER COLUMN chat_id DROP NOT NULL;

-- Ensure each message belongs to exactly one context
DO $$ BEGIN
  ALTER TABLE public.messages
    ADD CONSTRAINT messages_chat_or_group_chk
    CHECK (
      (chat_id IS NOT NULL AND group_id IS NULL) OR
      (chat_id IS NULL AND group_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS messages_group_created_idx
  ON public.messages (group_id, created_at DESC);
