-- Add group banner image

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS banner_url TEXT;
