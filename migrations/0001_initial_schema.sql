-- Spelling Bee Betting Pool - Initial Schema
-- All chip amounts stored as integers (cents equivalent)

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'finished')),
  current_round_id TEXT,
  betting_open INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'gambler', 'observer')),
  chip_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_room ON users(room_id);

CREATE TABLE IF NOT EXISTS spellers (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'eliminated', 'winner')),
  eliminated_in_round INTEGER
);

CREATE INDEX IF NOT EXISTS idx_spellers_room ON spellers(room_id);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  round_number INTEGER NOT NULL,
  difficulty_tier INTEGER NOT NULL DEFAULT 1 CHECK (difficulty_tier BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_id);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  speller_id TEXT NOT NULL REFERENCES spellers(id),
  word TEXT,
  result TEXT CHECK (result IN ('correct', 'incorrect') OR result IS NULL),
  turn_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_round ON turns(round_id);

CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  word TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  sentence TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  difficulty_tier INTEGER NOT NULL DEFAULT 1 CHECK (difficulty_tier BETWEEN 1 AND 5),
  used INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_words_room_tier ON words(room_id, difficulty_tier, used);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  speller_id TEXT NOT NULL REFERENCES spellers(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  round_id TEXT REFERENCES rounds(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lost', 'won', 'paid')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bets_room ON bets(room_id);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_speller ON bets(speller_id);

CREATE TABLE IF NOT EXISTS chip_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('credit', 'bet', 'payout')),
  reference_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chip_tx_user ON chip_transactions(user_id);
