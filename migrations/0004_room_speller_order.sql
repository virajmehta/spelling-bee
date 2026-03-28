-- Move speller_order from per-round to per-room (shuffle once at start of bee)
ALTER TABLE rooms ADD COLUMN speller_order TEXT NOT NULL DEFAULT '[]';
