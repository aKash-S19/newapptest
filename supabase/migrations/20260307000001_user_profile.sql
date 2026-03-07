-- ── Migration: profile avatars & user preferences ────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_url    text,
  ADD COLUMN IF NOT EXISTS display_name  text;
