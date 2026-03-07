-- ── Storage: create avatars bucket and policies ────────────────────────────────
-- NOTE: Run this manually in Supabase SQL editor if the bucket doesn't exist yet.
-- The bucket must be created via the Supabase Dashboard or API first.

-- Allow authenticated users to upload their own avatar (using service role from Edge Function)
-- We generate signed upload URLs from the Edge Function so the client can upload directly.
-- Public read is enabled on the bucket so avatars can be displayed.

-- Allow public viewing of all avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy: allow anyone to read avatars  
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND policyname = 'avatars_public_read'
  ) THEN
    CREATE POLICY avatars_public_read ON storage.objects
      FOR SELECT USING (bucket_id = 'avatars');
  END IF;
END $$;

-- Policy: service role can manage all avatars
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND policyname = 'avatars_service_role_all'
  ) THEN
    CREATE POLICY avatars_service_role_all ON storage.objects
      FOR ALL TO service_role USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');
  END IF;
END $$;
