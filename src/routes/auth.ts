import { Hono } from 'hono';
import { Env } from '../types';
import { signJWT } from '../middleware/auth';

const auth = new Hono<Env>();

auth.post('/join', async (c) => {
  const { code, displayName, role, adminSecret, rejoinToken } = await c.req.json<{
    code: string;
    displayName: string;
    role: 'admin' | 'gambler' | 'observer';
    adminSecret?: string;
    rejoinToken?: string;
  }>();

  const normalizedCode = code?.trim().toUpperCase();
  const normalizedDisplayName = displayName?.trim();

  if (!normalizedCode || !normalizedDisplayName || !role) {
    return c.json({ error: 'code, displayName, and role are required' }, 400);
  }

  if (!['admin', 'gambler', 'observer'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  // Find room by code
  const room = await c.env.DB.prepare('SELECT id, name, status FROM rooms WHERE code = ?')
    .bind(normalizedCode)
    .first<{ id: string; name: string; status: string }>();

  if (!room) {
    return c.json({ error: 'Room not found' }, 404);
  }

  // Check if user already exists (rejoin)
  const existing = await c.env.DB.prepare(
    'SELECT id, role, display_name, rejoin_token FROM users WHERE room_id = ? AND display_name = ? COLLATE NOCASE'
  )
    .bind(room.id, normalizedDisplayName)
    .first<{ id: string; role: string; display_name: string; rejoin_token: string }>();

  let userId: string;
  let userRole: string;
  let userRejoinToken: string;
  let issuedDisplayName: string;

  if (existing) {
    const canRejoinAsAdmin = existing.role === 'admin'
      && (existing.rejoin_token === rejoinToken || adminSecret === c.env.ADMIN_SECRET);
    const canRejoinAsGuest = existing.role !== 'admin'
      && !!existing.rejoin_token
      && existing.rejoin_token === rejoinToken;

    if (!canRejoinAsAdmin && !canRejoinAsGuest) {
      return c.json({ error: 'Display name is already in use in this room' }, 409);
    }

    userId = existing.id;
    userRole = existing.role;
    userRejoinToken = existing.rejoin_token || crypto.randomUUID();
    issuedDisplayName = existing.display_name;

    if (!existing.rejoin_token) {
      await c.env.DB.prepare('UPDATE users SET rejoin_token = ? WHERE id = ?')
        .bind(userRejoinToken, userId)
        .run();
    }
  } else {
    if (role === 'admin' && adminSecret !== c.env.ADMIN_SECRET) {
      return c.json({ error: 'Invalid admin secret' }, 403);
    }

    userId = crypto.randomUUID();
    userRole = role;
    userRejoinToken = crypto.randomUUID();
    issuedDisplayName = normalizedDisplayName;
    await c.env.DB.prepare(
      'INSERT INTO users (id, room_id, display_name, role, chip_balance, rejoin_token) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, room.id, normalizedDisplayName, role, 0, userRejoinToken)
      .run();
  }

  const token = await signJWT(
    {
      sub: userId,
      room: room.id,
      role: userRole as 'admin' | 'gambler' | 'observer',
      name: issuedDisplayName,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    userId,
    role: userRole,
    roomId: room.id,
    roomName: room.name,
    displayName: issuedDisplayName,
    rejoinToken: userRejoinToken,
  });
});

// Create a new room + join as admin in one step (no JWT required)
auth.post('/create-room', async (c) => {
  const { roomName, displayName, adminSecret } = await c.req.json<{
    roomName: string;
    displayName: string;
    adminSecret: string;
  }>();

  const normalizedRoomName = roomName?.trim();
  const normalizedDisplayName = displayName?.trim();

  if (!normalizedRoomName || !normalizedDisplayName || !adminSecret) {
    return c.json({ error: 'roomName, displayName, and adminSecret are required' }, 400);
  }

  if (adminSecret !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'Invalid admin secret' }, 403);
  }

  const roomId = crypto.randomUUID();
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const userId = crypto.randomUUID();
  const userRejoinToken = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO rooms (id, code, name, status, betting_open, version) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(roomId, roomCode, normalizedRoomName, 'setup', 1, 0),
    c.env.DB.prepare(
      'INSERT INTO users (id, room_id, display_name, role, chip_balance, rejoin_token) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, roomId, normalizedDisplayName, 'admin', 0, userRejoinToken),
  ]);

  const token = await signJWT(
    {
      sub: userId,
      room: roomId,
      role: 'admin',
      name: normalizedDisplayName,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    userId,
    role: 'admin',
    roomId,
    roomName: normalizedRoomName,
    roomCode,
    displayName: normalizedDisplayName,
    rejoinToken: userRejoinToken,
  });
});

export default auth;
