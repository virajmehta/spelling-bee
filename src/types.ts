export interface Env {
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
    ADMIN_SECRET: string;
  };
  Variables: {
    userId: string;
    roomId: string;
    role: 'admin' | 'gambler' | 'observer';
    displayName: string;
  };
}

export interface Room {
  id: string;
  code: string;
  name: string;
  status: 'setup' | 'active' | 'finished';
  current_round_id: string | null;
  betting_open: number; // 0 or 1
  version: number;
  speller_order: string; // JSON array of speller IDs
  created_at: string;
}

export interface User {
  id: string;
  room_id: string;
  display_name: string;
  role: 'admin' | 'gambler' | 'observer';
  chip_balance: number;
  created_at: string;
}

export interface Speller {
  id: string;
  room_id: string;
  name: string;
  display_order: number;
  status: 'active' | 'eliminated' | 'winner';
  eliminated_in_round: number | null;
}

export interface Round {
  id: string;
  room_id: string;
  round_number: number;
  difficulty_tier: number;
  status: 'pending' | 'active' | 'completed';
}

export interface Turn {
  id: string;
  round_id: string;
  speller_id: string;
  word: string | null;
  result: 'correct' | 'incorrect' | null;
  turn_order: number;
}

export interface Word {
  id: string;
  room_id: string;
  word: string;
  definition: string;
  sentence: string;
  origin: string;
  difficulty_tier: number;
  used: number;
  sort_order: number;
}

export interface Bet {
  id: string;
  room_id: string;
  user_id: string;
  speller_id: string;
  amount: number;
  round_id: string | null;
  status: 'active' | 'lost' | 'won' | 'paid';
  created_at: string;
}

export interface ChipTransaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'credit' | 'bet' | 'payout';
  reference_id: string | null;
  created_at: string;
}

export interface JWTPayload {
  sub: string;
  room: string;
  role: 'admin' | 'gambler' | 'observer';
  name: string;
  exp: number;
}
