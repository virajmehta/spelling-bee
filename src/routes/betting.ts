import { Hono } from 'hono';
import { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { bumpVersion } from '../services/bee-engine';

const betting = new Hono<Env>();

// Place bet (gambler only)
betting.post('/', requireRole('gambler'), async (c) => {
  const roomId = c.get('roomId');
  const userId = c.get('userId');
  const { spellerId, amount } = await c.req.json<{ spellerId: string; amount: number }>();

  if (!spellerId || !amount || amount <= 0) {
    return c.json({ error: 'spellerId and positive amount required' }, 400);
  }

  // Check betting is open and validate in a batch read
  const [room, speller, user] = await Promise.all([
    c.env.DB.prepare('SELECT betting_open, status FROM rooms WHERE id = ?').bind(roomId)
      .first<{ betting_open: number; status: string }>(),
    c.env.DB.prepare("SELECT id, status FROM spellers WHERE id = ? AND room_id = ? AND status = 'active'").bind(spellerId, roomId)
      .first<{ id: string; status: string }>(),
    c.env.DB.prepare('SELECT chip_balance FROM users WHERE id = ?').bind(userId)
      .first<{ chip_balance: number }>(),
  ]);

  if (!room || room.status === 'finished') {
    return c.json({ error: 'Betting is closed — bee is finished' }, 409);
  }
  if (!room.betting_open) {
    return c.json({ error: 'Betting is locked during the current round' }, 409);
  }
  if (!speller) {
    return c.json({ error: 'Speller not found or already eliminated' }, 404);
  }
  if (!user || user.chip_balance < amount) {
    return c.json({ error: 'Insufficient chip balance' }, 400);
  }

  const betId = crypto.randomUUID();
  const txId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bets (id, room_id, user_id, speller_id, amount, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(betId, roomId, userId, spellerId, amount, 'active'),
    c.env.DB.prepare('UPDATE users SET chip_balance = chip_balance - ? WHERE id = ? AND chip_balance >= ?')
      .bind(amount, userId, amount),
    c.env.DB.prepare(
      'INSERT INTO chip_transactions (id, user_id, amount, type, reference_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(txId, userId, -amount, 'bet', betId),
    c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId),
  ]);

  return c.json({ betId, amount, spellerId });
});

export default betting;
