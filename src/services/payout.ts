/**
 * Final payout computation.
 *
 * Zero-rake parimutuel: all money goes back to winners.
 * Payout = Math.floor((betAmount / winnerPool) * totalPool)
 *
 * Any remainder from floor rounding stays unclaimed (prevents overpaying).
 */

export interface PayoutResult {
  winnerId: string;
  winnerName: string;
  totalPool: number;
  winnerPool: number;
  payouts: {
    userId: string;
    displayName: string;
    betAmount: number;
    payoutAmount: number;
  }[];
  unclaimedPool: boolean;
}

export async function computePayouts(db: D1Database, roomId: string): Promise<PayoutResult> {
  // Get winner
  const winner = await db
    .prepare("SELECT id, name FROM spellers WHERE room_id = ? AND status = 'winner'")
    .bind(roomId)
    .first<{ id: string; name: string }>();

  if (!winner) throw new Error('No winner declared');

  // Total pool = all bets in room
  const poolResult = await db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM bets WHERE room_id = ?')
    .bind(roomId)
    .first<{ total: number }>();
  const totalPool = poolResult?.total || 0;

  // Winner pool = bets on winner that were active (now 'won')
  const winnerPoolResult = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM bets WHERE room_id = ? AND speller_id = ? AND status = 'won'")
    .bind(roomId, winner.id)
    .first<{ total: number }>();
  const winnerPool = winnerPoolResult?.total || 0;

  if (winnerPool === 0) {
    return {
      winnerId: winner.id,
      winnerName: winner.name,
      totalPool,
      winnerPool: 0,
      payouts: [],
      unclaimedPool: true,
    };
  }

  // Get winning bets with user info
  const winningBets = await db
    .prepare(`
      SELECT b.id as bet_id, b.user_id, b.amount, u.display_name
      FROM bets b JOIN users u ON b.user_id = u.id
      WHERE b.room_id = ? AND b.speller_id = ? AND b.status = 'won'
      ORDER BY b.amount DESC
    `)
    .bind(roomId, winner.id)
    .all<{ bet_id: string; user_id: string; amount: number; display_name: string }>();

  const payouts: PayoutResult['payouts'] = [];
  const betUpdates: D1PreparedStatement[] = [];
  const txInserts: D1PreparedStatement[] = [];
  const balanceUpdates = new Map<string, number>();

  for (const bet of winningBets.results) {
    const payoutAmount = Math.floor((bet.amount / winnerPool) * totalPool);
    payouts.push({
      userId: bet.user_id,
      displayName: bet.display_name,
      betAmount: bet.amount,
      payoutAmount,
    });

    // Track total payout per user (might have multiple bets on winner)
    balanceUpdates.set(bet.user_id, (balanceUpdates.get(bet.user_id) || 0) + payoutAmount);

    // Mark bet as paid
    betUpdates.push(
      db.prepare("UPDATE bets SET status = 'paid' WHERE id = ?").bind(bet.bet_id)
    );

    // Record transaction
    const txId = crypto.randomUUID();
    txInserts.push(
      db.prepare('INSERT INTO chip_transactions (id, user_id, amount, type, reference_id) VALUES (?, ?, ?, ?, ?)')
        .bind(txId, bet.user_id, payoutAmount, 'payout', bet.bet_id)
    );
  }

  // Update user balances
  const balUpdates: D1PreparedStatement[] = [];
  for (const [userId, amount] of balanceUpdates) {
    balUpdates.push(
      db.prepare('UPDATE users SET chip_balance = chip_balance + ? WHERE id = ?').bind(amount, userId)
    );
  }

  await db.batch([...betUpdates, ...txInserts, ...balUpdates]);

  return {
    winnerId: winner.id,
    winnerName: winner.name,
    totalPool,
    winnerPool,
    payouts,
    unclaimedPool: false,
  };
}
