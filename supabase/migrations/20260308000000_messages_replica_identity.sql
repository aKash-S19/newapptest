-- Fix: Enable REPLICA IDENTITY FULL for messages table.
-- Required for Supabase Realtime to reliably deliver DELETE events to all
-- subscribers. Without this, the old record only contains the primary key and
-- Supabase may silently drop the event when it cannot evaluate RLS policies.
ALTER TABLE public.messages REPLICA IDENTITY FULL;
