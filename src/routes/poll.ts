import { Hono } from 'hono';
import { Env, Room, Speller } from '../types';
import { calculateOdds } from '../services/pool-math';

const poll = new Hono<Env>();

poll.get('/', async (c) => {
  const roomId = c.get('roomId');
  const userId = c.get('userId');
  const role = c.get('role');
  const clientVersion = parseInt(c.req.query('version') || '0');

  // Check room version
  const room = await c.env.DB.prepare(
    'SELECT id, code, name, status, current_round_id, betting_open, version FROM rooms WHERE id = ?'
  )
    .bind(roomId)
    .first<Room>();

  if (!room) return c.json({ error: 'Room not found' }, 404);

  // Return 304 if version unchanged
  if (clientVersion > 0 && room.version === clientVersion) {
    return new Response(null, { status: 304 });
  }

  // Parallel queries
  const [spellersResult, roundsResult, betsResult, currentTurnResult] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, name, display_order, status, eliminated_in_round FROM spellers WHERE room_id = ? ORDER BY display_order'
    ).bind(roomId).all<Speller>(),

    c.env.DB.prepare(
      'SELECT id, round_number, difficulty_tier, status FROM rounds WHERE room_id = ? ORDER BY round_number DESC LIMIT 5'
    ).bind(roomId).all(),

    c.env.DB.prepare(
      "SELECT b.speller_id, s.name as speller_name, b.amount, b.status FROM bets b JOIN spellers s ON b.speller_id = s.id WHERE b.room_id = ?"
    ).bind(roomId).all<{ speller_id: string; speller_name: string; amount: number; status: string }>(),

    room.current_round_id
      ? c.env.DB.prepare(
          'SELECT t.id, t.speller_id, t.word, t.result, t.turn_order, s.name as speller_name FROM turns t JOIN spellers s ON t.speller_id = s.id WHERE t.round_id = ? ORDER BY t.turn_order DESC LIMIT 10'
        ).bind(room.current_round_id).all()
      : Promise.resolve({ results: [] }),
  ]);

  const spellers = spellersResult.results;
  const activeSpellerIds = spellers.filter(s => s.status === 'active' || s.status === 'winner').map(s => s.id);

  // Calculate odds
  const { totalPool, odds } = calculateOdds(
    betsResult.results as any,
    activeSpellerIds
  );

  // Ensure all active spellers appear in odds (even with 0 bets)
  for (const s of spellers) {
    if ((s.status === 'active' || s.status === 'winner') && !odds.find(o => o.spellerId === s.id)) {
      odds.push({
        spellerId: s.id,
        spellerName: s.name,
        poolOnSpeller: 0,
        totalPool,
        payoutPerChip: 0,
        impliedOdds: 'N/A',
        percentage: 0,
      });
    }
  }

  const response: any = {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      bettingOpen: !!room.betting_open,
      version: room.version,
    },
    spellers,
    rounds: roundsResult.results,
    currentTurns: currentTurnResult.results,
    totalPool,
    odds,
  };

  // Gambler-specific: include their bets and balance
  if (role === 'gambler') {
    const [myBets, myUser] = await Promise.all([
      c.env.DB.prepare(
        'SELECT b.id, b.speller_id, b.amount, b.status, s.name as speller_name, s.status as speller_status FROM bets b JOIN spellers s ON b.speller_id = s.id WHERE b.user_id = ? AND b.room_id = ? ORDER BY b.created_at DESC'
      ).bind(userId, roomId).all(),
      c.env.DB.prepare('SELECT chip_balance FROM users WHERE id = ?').bind(userId).first<{ chip_balance: number }>(),
    ]);

    response.myBets = myBets.results;
    response.chipBalance = myUser?.chip_balance || 0;
  }

  // Gamblers list (for admin chip crediting)
  if (role === 'admin') {
    const gamblers = await c.env.DB.prepare(
      "SELECT id, display_name, chip_balance FROM users WHERE room_id = ? AND role = 'gambler' ORDER BY display_name"
    ).bind(roomId).all<{ id: string; display_name: string; chip_balance: number }>();
    response.gamblers = gamblers.results.map(g => ({
      userId: g.id, displayName: g.display_name, chipBalance: g.chip_balance,
    }));
  }

  // Recent activity — last 20 turns across all rounds with round info
  const recentActivity = await c.env.DB.prepare(`
    SELECT t.id, t.word, t.result, t.turn_order,
           s.name as speller_name, s.status as speller_status,
           r.round_number
    FROM turns t
    JOIN spellers s ON t.speller_id = s.id
    JOIN rounds r ON t.round_id = r.id
    WHERE r.room_id = ?
    ORDER BY r.round_number DESC, t.turn_order DESC
    LIMIT 20
  `).bind(roomId).all();
  response.recentActivity = recentActivity.results;

  // If room is finished, include payout info
  if (room.status === 'finished') {
    const winner = spellers.find(s => s.status === 'winner');
    const paidBets = await c.env.DB.prepare(
      "SELECT b.user_id, u.display_name, b.amount as bet_amount, ct.amount as payout_amount FROM bets b JOIN users u ON b.user_id = u.id JOIN chip_transactions ct ON ct.reference_id = b.id AND ct.type = 'payout' WHERE b.room_id = ? AND b.status = 'paid' ORDER BY ct.amount DESC"
    ).bind(roomId).all();

    response.payout = {
      winner: winner ? { id: winner.id, name: winner.name } : null,
      totalPool,
      payouts: paidBets.results,
    };
  }

  return c.json(response);
});

export default poll;
