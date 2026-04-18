
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    text TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- Index for TTL on messages
CREATE INDEX messages_expires_at_idx ON messages (expires_at) WHERE expires_at IS NOT NULL;

-- Function to delete expired messages
CREATE OR REPLACE FUNCTION delete_expired_messages()
RETURNS void AS $$
BEGIN
    DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= NOW();
END;
$$ LANGUAGE plpgsql;

-- This would typically be run by a cron job, for example using pg_cron
-- SELECT cron.schedule('*/5 * * * *', 'SELECT delete_expired_messages()');
-- For this example, we will assume a cron job is set up to call delete_expired_messages() periodically.
