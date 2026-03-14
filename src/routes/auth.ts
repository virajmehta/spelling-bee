import { Hono } from 'hono';
import { Env } from '../types';
import { signJWT } from '../middleware/auth';

const auth = new Hono<Env>();

auth.post('/join', async (c) => {
  const { code, displayName, role, adminSecret } = await c.req.json<{
    code: string;
    displayName: string;
    role: 'admin' | 'gambler' | 'observer';
    adminSecret?: string;
  }>();

  if (!code || !displayName || !role) {
    return c.json({ error: 'code, displayName, and role are required' }, 400);
  }

  if (!['admin', 'gambler', 'observer'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  // Admin requires secret
  if (role === 'admin') {
    if (!adminSecret || adminSecret !== c.env.ADMIN_SECRET) {
      return c.json({ error: 'Invalid admin secret' }, 403);
    }
  }

  // Find room by code
  const room = await c.env.DB.prepare('SELECT id, name, status FROM rooms WHERE code = ?')
    .bind(code.toUpperCase())
    .first<{ id: string; name: string; status: string }>();

  if (!room) {
    return c.json({ error: 'Room not found' }, 404);
  }

  // Check if user already exists (rejoin)
  const existing = await c.env.DB.prepare(
    'SELECT id, role FROM users WHERE room_id = ? AND display_name = ?'
  )
    .bind(room.id, displayName)
    .first<{ id: string; role: string }>();

  let userId: string;
  let userRole: string;

  if (existing) {
    userId = existing.id;
    userRole = existing.role;
  } else {
    userId = crypto.randomUUID();
    userRole = role;
    await c.env.DB.prepare(
      'INSERT INTO users (id, room_id, display_name, role, chip_balance) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(userId, room.id, displayName, role, 0)
      .run();
  }

  const token = await signJWT(
    {
      sub: userId,
      room: room.id,
      role: userRole as 'admin' | 'gambler' | 'observer',
      name: displayName,
      exp: Math.floor(Date.now() / 1000) + 3 * 60 * 60, // 3 hours
    },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    userId,
    role: userRole,
    roomId: room.id,
    roomName: room.name,
  });
});

// Create a new room + join as admin in one step (no JWT required)
auth.post('/create-room', async (c) => {
  const { roomName, displayName, adminSecret } = await c.req.json<{
    roomName: string;
    displayName: string;
    adminSecret: string;
  }>();

  if (!roomName || !displayName || !adminSecret) {
    return c.json({ error: 'roomName, displayName, and adminSecret are required' }, 400);
  }

  if (adminSecret !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'Invalid admin secret' }, 403);
  }

  const roomId = crypto.randomUUID();
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const userId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO rooms (id, code, name, status, betting_open, version) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(roomId, roomCode, roomName, 'setup', 1, 0),
    c.env.DB.prepare(
      'INSERT INTO users (id, room_id, display_name, role, chip_balance) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, roomId, displayName, 'admin', 0),
  ]);

  const token = await signJWT(
    {
      sub: userId,
      room: roomId,
      role: 'admin',
      name: displayName,
      exp: Math.floor(Date.now() / 1000) + 3 * 60 * 60,
    },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    userId,
    role: 'admin',
    roomId,
    roomName,
    roomCode,
  });
});

export default auth;
