-- Add per-user rejoin tokens and prevent duplicate display names within a room.

ALTER TABLE users ADD COLUMN rejoin_token TEXT NOT NULL DEFAULT '';

UPDATE users
SET rejoin_token = lower(hex(randomblob(16)))
WHERE rejoin_token = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_room_display_name_unique
ON users(room_id, display_name COLLATE NOCASE);
