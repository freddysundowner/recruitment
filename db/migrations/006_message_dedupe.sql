-- Lets reminders be queued repeatedly without ever sending the same one twice.
ALTER TABLE messages ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX messages_dedupe_key ON messages (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
