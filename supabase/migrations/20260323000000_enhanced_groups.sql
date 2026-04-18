-- Enhanced group chat features: avatars, member counts, last message preview

-- Add avatar column to groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS mute_notifications BOOLEAN DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Add updated_at to track last activity
ALTER TABLE groups ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();

-- Function to get member count for a group
CREATE OR REPLACE FUNCTION get_group_member_count(group_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM group_members WHERE group_id = $1;
$$ LANGUAGE sql STABLE;

-- Function to get last message in a group
CREATE OR REPLACE FUNCTION get_group_last_message(group_id UUID)
RETURNS TABLE(
  id UUID,
  text TEXT,
  created_at TIMESTAMPTZ,
  user_id UUID,
  username TEXT
) AS $$
  SELECT m.id, m.text, m.created_at, m.user_id, u.username
  FROM messages m
  JOIN users u ON m.user_id = u.id
  WHERE m.group_id = $1
  ORDER BY m.created_at DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Function to get user's role in a group
CREATE OR REPLACE FUNCTION get_user_group_role(group_id UUID, user_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2;
$$ LANGUAGE sql STABLE;

-- Create index for faster group member queries
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_id_created ON messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_groups_last_activity ON groups(last_activity DESC);

-- Add RLS policies for groups
DROP POLICY IF EXISTS "Users can view groups they belong to" ON groups;
CREATE POLICY "Users can view groups they belong to" ON groups
  FOR SELECT USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update groups" ON groups;
CREATE POLICY "Admins can update groups" ON groups
  FOR UPDATE USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Add RLS for group_members
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view group members" ON group_members;
CREATE POLICY "Members can view group members" ON group_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can add members" ON group_members;
CREATE POLICY "Admins can add members" ON group_members
  FOR INSERT WITH CHECK (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
    OR group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'member')
  );

DROP POLICY IF EXISTS "Admins can remove members" ON group_members;
CREATE POLICY "Admins can remove members" ON group_members
  FOR DELETE USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Trigger to update last_activity on new messages
CREATE OR REPLACE FUNCTION update_group_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    UPDATE groups SET last_activity = NEW.created_at WHERE id = NEW.group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_group_activity ON messages;
CREATE TRIGGER trigger_update_group_activity
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_group_last_activity();