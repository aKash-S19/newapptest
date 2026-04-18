-- Fix foreign key relationship for group_members to groups

-- Drop existing FK if exists and recreate with proper naming
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_group_id_fkey;

ALTER TABLE group_members 
ADD CONSTRAINT group_members_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

-- Ensure foreign key to users exists
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_user_id_fkey;

ALTER TABLE group_members 
ADD CONSTRAINT group_members_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Ensure groups has proper FK to auth.users for created_by
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_created_by_fkey;

ALTER TABLE groups 
ADD CONSTRAINT groups_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Refresh schema cache to recognize relationships
NOTIFY pgrst, 'reload schema';