import { Hono } from 'hono';
import { Env } from '../types';
import { requireRole } from '../middleware/auth';

const betting = new Hono<Env>();

// Place bet (gambler only)
betting.post('/', requireRole('gambler'), async (c) => {
  const roomId = c.get('roomId');
  const userId = c.get('userId');
  const { spellerId, amount } = await c.req.json<{ spellerId: string; amount: number }>();

  if (!spellerId || !amount || amount <= 0) {
    return c.json({ error: 'spellerId and positive amount required' }, 400);
  }

  // Refuse stale UI state and concurrent overspending before a bet enters the pool.
  const deduction = await c.env.DB.prepare(`
    UPDATE users
    SET chip_balance = chip_balance - ?
    WHERE id = ?
      AND room_id = ?
      AND chip_balance >= ?
      AND EXISTS (
        SELECT 1 FROM rooms
        WHERE id = ?
          AND betting_open = 1
          AND status != 'finished'
      )
      AND EXISTS (
        SELECT 1 FROM spellers
        WHERE id = ?
          AND room_id = ?
          AND status = 'active'
      )
  `)
    .bind(amount, userId, roomId, amount, roomId, spellerId, roomId)
    .run();

  if ((deduction.meta?.changes ?? 0) === 0) {
    const [room, speller, user] = await Promise.all([
      c.env.DB.prepare('SELECT betting_open, status FROM rooms WHERE id = ?').bind(roomId)
        .first<{ betting_open: number; status: string }>(),
      c.env.DB.prepare("SELECT id FROM spellers WHERE id = ? AND room_id = ? AND status = 'active'").bind(spellerId, roomId)
        .first<{ id: string }>(),
      c.env.DB.prepare('SELECT chip_balance FROM users WHERE id = ? AND room_id = ?').bind(userId, roomId)
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

    return c.json({ error: 'Could not place bet' }, 409);
  }

  const betId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const refundDeduction = async () => {
    await c.env.DB.prepare('UPDATE users SET chip_balance = chip_balance + ? WHERE id = ? AND room_id = ?')
      .bind(amount, userId, roomId)
      .run();
  };

  const betInsert = await c.env.DB.prepare(`
    INSERT INTO bets (id, room_id, user_id, speller_id, amount, status)
    SELECT ?, ?, ?, ?, ?, 'active'
    WHERE EXISTS (
      SELECT 1 FROM rooms
      WHERE id = ?
        AND betting_open = 1
        AND status != 'finished'
    )
      AND EXISTS (
        SELECT 1 FROM spellers
        WHERE id = ?
          AND room_id = ?
          AND status = 'active'
      )
  `)
    .bind(betId, roomId, userId, spellerId, amount, roomId, spellerId, roomId)
    .run();

  if ((betInsert.meta?.changes ?? 0) === 0) {
    await refundDeduction();

    const [room, speller] = await Promise.all([
      c.env.DB.prepare('SELECT betting_open, status FROM rooms WHERE id = ?').bind(roomId)
        .first<{ betting_open: number; status: string }>(),
      c.env.DB.prepare("SELECT id FROM spellers WHERE id = ? AND room_id = ? AND status = 'active'").bind(spellerId, roomId)
        .first<{ id: string }>(),
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

    return c.json({ error: 'Could not place bet' }, 409);
  }

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO chip_transactions (id, user_id, amount, type, reference_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(txId, userId, -amount, 'bet', betId),
      c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId),
    ]);
  } catch {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM chip_transactions WHERE id = ?').bind(txId),
      c.env.DB.prepare('DELETE FROM bets WHERE id = ?').bind(betId),
    ]).catch(() => null);
    await refundDeduction().catch(() => null);

    return c.json({ error: 'Failed to place bet' }, 500);
  }

  return c.json({ betId, amount, spellerId });
});

export default betting;
