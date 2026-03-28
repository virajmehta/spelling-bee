/**
 * Bee state machine — manages round/turn lifecycle and betting gate.
 *
 * Room:  SETUP → ACTIVE → FINISHED
 * Round: PENDING → ACTIVE → COMPLETED
 * Turn:  CREATED → (word assigned) → COMPLETED (result recorded)
 *
 * Betting gate:
 *  OPEN when room is setup, or current round is completed/none active
 *  LOCKED when a round is active
 *  CLOSED permanently when room is finished
 */

export async function bumpVersion(db: D1Database, roomId: string) {
  await db.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId).run();
}

export async function startRound(
  db: D1Database,
  roomId: string
): Promise<{ id: string; roundNumber: number }> {
  // Verify no active round
  const active = await db
    .prepare("SELECT id FROM rounds WHERE room_id = ? AND status = 'active'")
    .bind(roomId)
    .first();
  if (active) throw new Error('A round is already active');

  // Get next round number
  const last = await db
    .prepare('SELECT MAX(round_number) as max_num FROM rounds WHERE room_id = ?')
    .bind(roomId)
    .first<{ max_num: number | null }>();
  const roundNumber = (last?.max_num || 0) + 1;

  // Check if room already has a speller order; if not, shuffle and save it
  const room = await db
    .prepare('SELECT speller_order FROM rooms WHERE id = ?')
    .bind(roomId)
    .first<{ speller_order: string }>();
  let spellerOrder: string[] = [];
  try { spellerOrder = JSON.parse(room?.speller_order || '[]'); } catch {}

  if (spellerOrder.length === 0) {
    // First round — shuffle all active spellers and lock in the order
    const spellers = await db
      .prepare("SELECT id FROM spellers WHERE room_id = ? AND status = 'active' ORDER BY display_order")
      .bind(roomId)
      .all<{ id: string }>();
    spellerOrder = spellers.results.map(s => s.id);
    // Fisher-Yates shuffle
    for (let i = spellerOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spellerOrder[i], spellerOrder[j]] = [spellerOrder[j], spellerOrder[i]];
    }
  }

  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO rounds (id, room_id, round_number, difficulty_tier, status, speller_order) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, roomId, roundNumber, 1, 'active', JSON.stringify(spellerOrder)),
    // Lock betting, set room to active, save speller order on room
    db.prepare("UPDATE rooms SET current_round_id = ?, betting_open = 0, status = 'active', speller_order = ?, version = version + 1 WHERE id = ?")
      .bind(id, JSON.stringify(spellerOrder), roomId),
  ]);

  return { id, roundNumber };
}

export async function checkRoundComplete(db: D1Database, roomId: string): Promise<boolean> {
  const room = await db
    .prepare("SELECT current_round_id, speller_order FROM rooms WHERE id = ?")
    .bind(roomId)
    .first<{ current_round_id: string | null; speller_order: string }>();
  if (!room?.current_round_id) return false;

  let spellerOrder: string[] = [];
  try { spellerOrder = JSON.parse(room.speller_order || '[]'); } catch {}
  if (spellerOrder.length === 0) return false;

  // Get active speller IDs
  const activeSpellers = await db
    .prepare("SELECT id FROM spellers WHERE room_id = ? AND status = 'active'")
    .bind(roomId)
    .all<{ id: string }>();
  const activeIds = new Set(activeSpellers.results.map(s => s.id));

  // Active spellers in the round order
  const activeInOrder = spellerOrder.filter(id => activeIds.has(id));

  // Get all turns with results in this round
  const turns = await db
    .prepare("SELECT speller_id FROM turns WHERE round_id = ? AND result IS NOT NULL")
    .bind(room.current_round_id)
    .all<{ speller_id: string }>();
  const completedSpellerIds = new Set(turns.results.map(t => t.speller_id));

  // Check if every active speller in the order has a completed turn
  const allDone = activeInOrder.every(id => completedSpellerIds.has(id));
  if (!allDone) return false;

  // Auto-complete the round
  await completeRound(db, roomId, room.current_round_id);
  return true;
}

export async function completeRound(db: D1Database, roomId: string, roundId: string) {
  await db.batch([
    db.prepare("UPDATE rounds SET status = 'completed' WHERE id = ? AND room_id = ?")
      .bind(roundId, roomId),
    // Open betting
    db.prepare('UPDATE rooms SET current_round_id = NULL, betting_open = 1, version = version + 1 WHERE id = ?')
      .bind(roomId),
  ]);
}

export async function createTurn(
  db: D1Database,
  roundId: string,
  spellerId: string,
  word: string | null
): Promise<string> {
  const last = await db
    .prepare('SELECT MAX(turn_order) as max_order FROM turns WHERE round_id = ?')
    .bind(roundId)
    .first<{ max_order: number | null }>();
  const turnOrder = (last?.max_order || 0) + 1;

  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO turns (id, round_id, speller_id, word, turn_order) VALUES (?, ?, ?, ?, ?)')
    .bind(id, roundId, spellerId, word, turnOrder)
    .run();

  return id;
}

export async function recordTurnResult(
  db: D1Database,
  turnId: string,
  result: 'correct' | 'incorrect' | null
) {
  await db
    .prepare('UPDATE turns SET result = ? WHERE id = ?')
    .bind(result, turnId)
    .run();
}

export async function eliminateSpeller(
  db: D1Database,
  roomId: string,
  spellerId: string
) {
  // Get current round number for eliminated_in_round
  const round = await db
    .prepare("SELECT round_number FROM rounds WHERE room_id = ? AND status = 'active' ORDER BY round_number DESC LIMIT 1")
    .bind(roomId)
    .first<{ round_number: number }>();

  // Also check completed rounds if no active
  const roundNum = round?.round_number || (await db
    .prepare('SELECT MAX(round_number) as rn FROM rounds WHERE room_id = ?')
    .bind(roomId)
    .first<{ rn: number | null }>())?.rn || 0;

  await db.batch([
    db.prepare("UPDATE spellers SET status = 'eliminated', eliminated_in_round = ? WHERE id = ? AND room_id = ?")
      .bind(roundNum, spellerId, roomId),
    // Mark bets on this speller as lost
    db.prepare("UPDATE bets SET status = 'lost' WHERE speller_id = ? AND room_id = ? AND status = 'active'")
      .bind(spellerId, roomId),
    db.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId),
  ]);
}

export async function reinstateSpeller(
  db: D1Database,
  roomId: string,
  spellerId: string
) {
  await db.batch([
    db.prepare("UPDATE spellers SET status = 'active', eliminated_in_round = NULL WHERE id = ? AND room_id = ?")
      .bind(spellerId, roomId),
    // Reactivate bets on this speller
    db.prepare("UPDATE bets SET status = 'active' WHERE speller_id = ? AND room_id = ? AND status = 'lost'")
      .bind(spellerId, roomId),
    db.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId),
  ]);
}

export async function finishBee(
  db: D1Database,
  roomId: string,
  winnerId: string
) {
  await db.batch([
    // Mark winner
    db.prepare("UPDATE spellers SET status = 'winner' WHERE id = ? AND room_id = ?")
      .bind(winnerId, roomId),
    // Mark all remaining active spellers (except winner) as eliminated
    db.prepare("UPDATE spellers SET status = 'eliminated' WHERE room_id = ? AND status = 'active' AND id != ?")
      .bind(roomId, winnerId),
    // Mark bets on non-winner active spellers as lost
    db.prepare("UPDATE bets SET status = 'lost' WHERE room_id = ? AND status = 'active' AND speller_id != ?")
      .bind(roomId, winnerId),
    // Mark bets on winner as won
    db.prepare("UPDATE bets SET status = 'won' WHERE room_id = ? AND speller_id = ? AND status = 'active'")
      .bind(roomId, winnerId),
    // Close any active rounds
    db.prepare("UPDATE rounds SET status = 'completed' WHERE room_id = ? AND status = 'active'")
      .bind(roomId),
    // Finish room
    db.prepare("UPDATE rooms SET status = 'finished', betting_open = 0, current_round_id = NULL, version = version + 1 WHERE id = ?")
      .bind(roomId),
  ]);
}
