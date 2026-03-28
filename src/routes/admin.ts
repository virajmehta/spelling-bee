import { Hono } from 'hono';
import { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { bumpVersion } from '../services/bee-engine';
import wordsData from '../../words/words.json';

const admin = new Hono<Env>();

admin.use('/*', requireRole('admin'));

// Create room
admin.post('/room', async (c) => {
  const { name, code } = await c.req.json<{ name: string; code?: string }>();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const roomCode = (code || Math.random().toString(36).substring(2, 8)).toUpperCase();
  const roomId = crypto.randomUUID();

  await c.env.DB.prepare(
    'INSERT INTO rooms (id, code, name, status, betting_open, version) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(roomId, roomCode, name, 'setup', 1, 0)
    .run();

  // Update the admin's room_id to this new room
  await c.env.DB.prepare('UPDATE users SET room_id = ? WHERE id = ?')
    .bind(roomId, c.get('userId'))
    .run();

  return c.json({ roomId, code: roomCode, name });
});

// Bulk add spellers
admin.post('/spellers', async (c) => {
  const roomId = c.get('roomId');
  const { spellers } = await c.req.json<{ spellers: string[] }>();

  if (!spellers?.length) return c.json({ error: 'spellers array required' }, 400);

  const stmts = spellers.map((name, i) =>
    c.env.DB.prepare(
      'INSERT INTO spellers (id, room_id, name, display_order, status) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), roomId, name.trim(), i + 1, 'active')
  );

  stmts.push(c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId));
  await c.env.DB.batch(stmts);

  return c.json({ added: spellers.length });
});

// Credit chips to a gambler
admin.post('/credits', async (c) => {
  const roomId = c.get('roomId');
  const { userId, amount } = await c.req.json<{ userId: string; amount: number }>();

  if (!userId || !amount || amount <= 0) {
    return c.json({ error: 'userId and positive amount required' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ? AND room_id = ?')
    .bind(userId, roomId)
    .first<{ id: string; role: string }>();

  if (!user) return c.json({ error: 'User not found in this room' }, 404);

  const txId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET chip_balance = chip_balance + ? WHERE id = ?')
      .bind(amount, userId),
    c.env.DB.prepare(
      'INSERT INTO chip_transactions (id, user_id, amount, type) VALUES (?, ?, ?, ?)'
    ).bind(txId, userId, amount, 'credit'),
    c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId),
  ]);

  return c.json({ success: true });
});

// Credit all gamblers at once
admin.post('/credits/all', async (c) => {
  const roomId = c.get('roomId');
  const { amount } = await c.req.json<{ amount: number }>();

  if (!amount || amount <= 0) {
    return c.json({ error: 'Positive amount required' }, 400);
  }

  const gamblers = await c.env.DB.prepare(
    "SELECT id FROM users WHERE room_id = ? AND role = 'gambler'"
  )
    .bind(roomId)
    .all<{ id: string }>();

  const stmts: D1PreparedStatement[] = [];
  for (const g of gamblers.results) {
    stmts.push(
      c.env.DB.prepare('UPDATE users SET chip_balance = chip_balance + ? WHERE id = ?')
        .bind(amount, g.id)
    );
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO chip_transactions (id, user_id, amount, type) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), g.id, amount, 'credit')
    );
  }
  stmts.push(c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId));
  if (stmts.length > 0) await c.env.DB.batch(stmts);

  return c.json({ credited: gamblers.results.length, amount });
});

// Import words from built-in word list
admin.post('/words/import', async (c) => {
  const roomId = c.get('roomId');
  const words = wordsData as { word: string; definition: string; origin: string; pronunciation: string; sentence: string }[];

  const stmts: D1PreparedStatement[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO words (id, room_id, word, definition, origin, pronunciation, sentence, difficulty_tier, used, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), roomId, w.word, w.definition, w.origin, w.pronunciation || '', w.sentence || '', 1, 0, i + 1)
    );
  }

  stmts.push(c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId));
  await c.env.DB.batch(stmts);

  return c.json({ imported: words.length });
});

// Upload custom word list (replaces unused words)
admin.post('/words/upload', async (c) => {
  const roomId = c.get('roomId');
  const body = await c.req.json();

  if (!Array.isArray(body)) {
    return c.json({ error: 'Payload must be an array of word objects' }, 400);
  }
  for (const entry of body) {
    if (!entry.word || !entry.definition) {
      return c.json({ error: 'Each entry must have "word" and "definition"' }, 400);
    }
  }

  // Count unused words that will be replaced
  const unusedCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM words WHERE room_id = ? AND used = 0'
  ).bind(roomId).first<{ cnt: number }>();
  const replaced = unusedCount?.cnt || 0;

  // Find max sort_order among remaining (used) words
  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM words WHERE room_id = ? AND used = 1'
  ).bind(roomId).first<{ max_order: number }>();
  const startOrder = (maxOrder?.max_order || 0) + 1;

  const stmts: D1PreparedStatement[] = [];

  // Delete all unused words
  stmts.push(
    c.env.DB.prepare('DELETE FROM words WHERE room_id = ? AND used = 0').bind(roomId)
  );

  // Insert new words
  for (let i = 0; i < body.length; i++) {
    const w = body[i];
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO words (id, room_id, word, definition, origin, pronunciation, sentence, difficulty_tier, used, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), roomId, w.word, w.definition,
        w.origin || '', w.pronunciation || '', w.sentence || '',
        1, 0, startOrder + i
      )
    );
  }

  stmts.push(c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId));
  await c.env.DB.batch(stmts);

  return c.json({ imported: body.length, replaced });
});

// Get all gamblers (for chip crediting)
admin.get('/gamblers', async (c) => {
  const roomId = c.get('roomId');
  const gamblers = await c.env.DB.prepare(
    "SELECT id, display_name, chip_balance FROM users WHERE room_id = ? AND role = 'gambler' ORDER BY display_name"
  )
    .bind(roomId)
    .all();

  return c.json({ gamblers: gamblers.results });
});

// Delete a speller
admin.delete('/spellers/:id', async (c) => {
  const roomId = c.get('roomId');
  const spellerId = c.req.param('id');

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM spellers WHERE id = ? AND room_id = ?').bind(spellerId, roomId),
    c.env.DB.prepare('UPDATE rooms SET version = version + 1 WHERE id = ?').bind(roomId),
  ]);

  return c.json({ success: true });
});

export default admin;
