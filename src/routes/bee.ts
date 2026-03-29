import { Hono } from 'hono';
import { Env } from '../types';
import { requireRole } from '../middleware/auth';
import * as engine from '../services/bee-engine';
import { computePayouts } from '../services/payout';

const bee = new Hono<Env>();

// Start new round (admin only)
bee.post('/rounds', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');

  try {
    const round = await engine.startRound(c.env.DB, roomId);
    return c.json(round);
  } catch (e: any) {
    return c.json({ error: e.message }, 409);
  }
});

// Complete round (admin only)
bee.post('/rounds/:id/complete', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');
  const roundId = c.req.param('id')!;
  await engine.completeRound(c.env.DB, roomId, roundId);
  return c.json({ success: true });
});

// Create turn (admin only)
bee.post('/turns', requireRole('admin'), async (c) => {
  const { roundId, spellerId, word } = await c.req.json<{
    roundId: string;
    spellerId: string;
    word?: string;
  }>();

  if (!roundId || !spellerId) {
    return c.json({ error: 'roundId and spellerId required' }, 400);
  }

  // If word provided, mark it as used
  if (word) {
    await c.env.DB.prepare(
      "UPDATE words SET used = 1 WHERE room_id = ? AND word = ? AND used = 0"
    ).bind(c.get('roomId'), word).run();
  }

  const turnId = await engine.createTurn(c.env.DB, roundId, spellerId, word || null);
  await engine.bumpVersion(c.env.DB, c.get('roomId'));
  return c.json({ id: turnId });
});

// Record or undo turn result (admin only)
bee.patch('/turns/:id', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');
  const turnId = c.req.param('id')!;
  const { result } = await c.req.json<{ result: 'correct' | 'incorrect' | null }>();

  if (result !== null && !['correct', 'incorrect'].includes(result)) {
    return c.json({ error: 'result must be correct, incorrect, or null' }, 400);
  }

  const turn = await c.env.DB.prepare(`
    SELECT t.id, t.result, t.speller_id
    FROM turns t
    JOIN rounds r ON t.round_id = r.id
    WHERE t.id = ? AND r.room_id = ?
  `)
    .bind(turnId, roomId)
    .first<{ id: string; result: 'correct' | 'incorrect' | null; speller_id: string }>();

  if (!turn) {
    return c.json({ error: 'Turn not found' }, 404);
  }

  await engine.recordTurnResult(c.env.DB, turnId, result);

  let stateChangeBumpedVersion = false;
  if (turn.result !== 'incorrect' && result === 'incorrect') {
    await engine.eliminateSpeller(c.env.DB, roomId, turn.speller_id);
    stateChangeBumpedVersion = true;
  } else if (turn.result === 'incorrect' && result !== 'incorrect') {
    const otherIncorrectTurns = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM turns t
      JOIN rounds r ON t.round_id = r.id
      WHERE r.room_id = ?
        AND t.speller_id = ?
        AND t.id != ?
        AND t.result = 'incorrect'
    `)
      .bind(roomId, turn.speller_id, turnId)
      .first<{ count: number }>();

    if ((otherIncorrectTurns?.count || 0) === 0) {
      await engine.reinstateSpeller(c.env.DB, roomId, turn.speller_id);
      stateChangeBumpedVersion = true;
    }
  }

  // Auto-complete round if all active spellers have gone
  if (result !== null) {
    const roundCompleted = await engine.checkRoundComplete(c.env.DB, roomId);
    if (roundCompleted) {
      return c.json({ success: true, roundCompleted: true });
    }
  }

  if (!stateChangeBumpedVersion) {
    await engine.bumpVersion(c.env.DB, roomId);
  }

  return c.json({ success: true });
});

// Eliminate speller (admin only)
bee.post('/spellers/:id/eliminate', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');
  const spellerId = c.req.param('id')!;
  await engine.eliminateSpeller(c.env.DB, roomId, spellerId);
  return c.json({ success: true });
});

// Reinstate speller (admin only)
bee.post('/spellers/:id/reinstate', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');
  const spellerId = c.req.param('id')!;
  await engine.reinstateSpeller(c.env.DB, roomId, spellerId);
  return c.json({ success: true });
});

// Finish bee — declare winner (admin only)
bee.post('/finish', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');
  const { winnerId } = await c.req.json<{ winnerId: string }>();

  if (!winnerId) return c.json({ error: 'winnerId required' }, 400);

  const room = await c.env.DB.prepare('SELECT status FROM rooms WHERE id = ?')
    .bind(roomId)
    .first<{ status: string }>();
  if (!room) return c.json({ error: 'Room not found' }, 404);
  if (room.status === 'finished') {
    return c.json({ error: 'Bee is already finished' }, 409);
  }

  const winner = await c.env.DB.prepare(
    "SELECT id FROM spellers WHERE id = ? AND room_id = ? AND status IN ('active', 'winner')"
  )
    .bind(winnerId, roomId)
    .first<{ id: string }>();
  if (!winner) {
    return c.json({ error: 'Winner not found in this room' }, 404);
  }

  await engine.finishBee(c.env.DB, roomId, winnerId);

  // Compute payouts
  const payoutResult = await computePayouts(c.env.DB, roomId);
  if (!payoutResult.unclaimedPool) {
    await engine.bumpVersion(c.env.DB, roomId);
  }
  return c.json(payoutResult);
});

// Get next unused word in order (admin only)
bee.get('/words/next', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');

  const word = await c.env.DB.prepare(
    'SELECT id, word, definition, origin, pronunciation, sentence, sort_order FROM words WHERE room_id = ? AND used = 0 ORDER BY sort_order LIMIT 1'
  )
    .bind(roomId)
    .first();

  const remaining = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM words WHERE room_id = ? AND used = 0'
  ).bind(roomId).first<{ count: number }>();

  return c.json({ word: word || null, remaining: remaining?.count || 0 });
});

// Skip current word (mark as used without assigning to a turn)
bee.post('/words/skip', requireRole('admin'), async (c) => {
  const roomId = c.get('roomId');

  const word = await c.env.DB.prepare(
    'SELECT id FROM words WHERE room_id = ? AND used = 0 ORDER BY sort_order LIMIT 1'
  ).bind(roomId).first<{ id: string }>();

  if (!word) return c.json({ error: 'No words remaining' }, 404);

  await c.env.DB.prepare('UPDATE words SET used = 1 WHERE id = ?').bind(word.id).run();

  return c.json({ skipped: true });
});

export default bee;
