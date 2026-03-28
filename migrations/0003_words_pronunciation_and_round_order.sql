-- Add pronunciation to words and speller_order to rounds

ALTER TABLE words ADD COLUMN pronunciation TEXT NOT NULL DEFAULT '';

ALTER TABLE rounds ADD COLUMN speller_order TEXT NOT NULL DEFAULT '[]';
