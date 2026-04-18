
-- Enable RLS for the new tables
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policies for groups
CREATE POLICY "Allow authenticated users to create groups" ON groups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow group members to see the group" ON groups FOR SELECT USING (id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid()));
CREATE POLICY "Allow group admin to update group" ON groups FOR UPDATE USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Allow group admin to delete group" ON groups FOR DELETE USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
);

-- Policies for group_members
CREATE POLICY "Allow user to see their memberships" ON group_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Allow group admin to manage members" ON group_members FOR ALL USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Allow user to leave a group" ON group_members FOR DELETE USING (user_id = auth.uid());


-- Policies for messages
CREATE POLICY "Allow group members to see messages" ON messages FOR SELECT USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
);
CREATE POLICY "Allow group members to send messages" ON messages FOR INSERT WITH CHECK (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid()) AND user_id = auth.uid()
);
CREATE POLICY "Allow message sender to delete their own messages" ON messages FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "Allow group admin to delete any message" ON messages FOR DELETE USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid() AND role = 'admin')
);
