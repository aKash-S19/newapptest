-- Fix RLS so users can actually be added to groups
-- 1) Allow group creator to add themselves as an admin
CREATE POLICY "Group creators can add themselves as admin" ON group_members
FOR INSERT WITH CHECK (
  auth.uid() = user_id AND
  role = 'admin' AND
  EXISTS (
    SELECT 1 FROM groups 
    WHERE id = group_id AND created_by = auth.uid()
  )
);

-- 2) Allow users to insert themselves as 'member' if they know the group UUID
CREATE POLICY "Users can join groups with invite UUID" ON group_members
FOR INSERT WITH CHECK (
  auth.uid() = user_id AND
  role = 'member'
);
