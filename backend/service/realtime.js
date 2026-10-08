const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { publicApiUrl } = require('../utils/env');

/*
 * Real-time layer (Socket.IO), phase 3 contract section 1. One Socket.IO server on the API's HTTP server
 * (path /socket.io), started by app.js with init(server) after listen.
 *
 * Handshake (auth payload of the Socket.IO CONNECT packet, never a cookie):
 *   { ticket }  web: short-lived ticket from GET /api/realtime/ticket (60 s, single use)
 *   { token }   other clients (Flutter): the access token of the REST API (same checks as requireAuth)
 * A missing, invalid, expired or reused credential refuses the connection: the client receives
 * `connect_error` with message "Authentication failed" and `data.code` = AUTH_REQUIRED | INVALID_TOKEN |
 * TOKEN_EXPIRED (same codes as the REST API).
 *
 * Every socket is bound to the login session of its credential (socket.data.sessionId: the access token's `sid`
 * claim, or the `sid` claim the ticket endpoint copied from the requester's access token; null for credentials
 * issued before sessions had ids). A credential whose session has ended is refused at the handshake, and a socket
 * is closed when its session ends: tokenService.revokeRefreshToken (logout) closes the sockets of that session,
 * revokeAllRefreshTokens (password change or reset, admin password change, account deletion) and a role change
 * close every socket of the user (disconnectUser). A 60 s check also closes the sockets whose user no longer exists,
 * whose role changed or whose session ended (expired, or revoked by another process such as create-admin.js).
 *
 * Every socket joins `user:<userId>`. Client events:
 *   room:join  { room: "<prefix>:<id>" }  ack { ok: true } | { ok: false, error: CODE }
 *   room:leave { room }                   ack { ok: true } | { ok: false, error: CODE }
 * A room is joined only when the authorizer registered for its prefix allows it
 * (registerRoomAuthorizer('trip', async (user, id) => boolean)).
 *
 * Server API for the modules (never throws, no-op before init):
 *   emitToUser(userId, event, payload)    every socket of a user
 *   emitToRoom(room, event, payload)      every socket in a room (e.g. "trip:<id>")
 *   removeUserFromRoom(userId, room)      makes every socket of a user leave a room (access revoked)
 *   disconnectUser(userId, { sessionId }) closes every socket of a user, or only those of one login session
 *
 * Limitation: a single API instance (in-memory adapter, used-ticket list in memory). Several instances would
 * need the Socket.IO Redis adapter and a shared store for used tickets.
 */

const TICKET_AUDIENCE = 'realtime';
const TICKET_ISSUER = 'campuslink';
const TICKET_TTL_SECONDS = 60;
const SOCKET_PATH = '/socket.io';
// Clients only send tiny control messages (room:join / room:leave).
const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
const MAX_ROOMS_PER_SOCKET = 50;
const MAX_SOCKETS_PER_USER = 20;
const ROOM_MAX_LENGTH = 100;
const ROOM_PATTERN = /^([a-z][a-z0-9-]{0,31}):([A-Za-z0-9_-]{1,64})$/;
// room:join attempts per socket: JOIN_BURST at once, refilled at JOIN_REFILL_PER_SECOND.
const JOIN_BURST = 20;
const JOIN_REFILL_PER_SECOND = 2;
const MAX_USED_TICKETS = 100000;
// Same bound as the `sid` claim of access tokens (middleware/requireAuth.js).
const MAX_SESSION_ID_LENGTH = 128;
// Safety net: every open socket is checked again at this interval (user, role, session).
const CONNECTION_CHECK_INTERVAL_MS = 60 * 1000;
const CONNECTION_CHECK_BATCH = 500;
// How long a revocation is remembered to refuse the handshakes that were in progress when it happened.
const REVOCATION_MEMORY_MS = 5 * 60 * 1000;

let io = null;
let shutdownHooked = false;
let checkingConnections = false;
const authorizers = new Map();
// jti of the tickets already used → expiry (ms). Tickets are single use.
const usedTickets = new Map();
// userId → number of connected sockets.
const socketCounts = new Map();
// "<userId>" (every session) or "<userId>:<sessionId>" (one session) → time of the last revocation (ms).
const recentRevocations = new Map();

const corsOrigins = () =>
  (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const idOf = (value) => {
  const id = value && typeof value === 'object' && value._id ? value._id : value;
  return id ? String(id) : '';
};

const validSessionId = (value) => typeof value === 'string' && value !== '' && value.length <= MAX_SESSION_ID_LENGTH;

// Tickets are signed with a key derived from JWT_SECRET, never with JWT_SECRET itself: a ticket handed to the
// browser can then never be accepted as an access token by the REST API (whose tokens have no audience).
const ticketKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return crypto.createHmac('sha256', secret).update('campuslink:realtime-ticket:v1').digest();
};

/**
 * A new ticket for `user` (GET /api/realtime/ticket): a JWT (HS256, audience "realtime", subject = user id,
 * unique jti, `sid` = the requester's login session when it has one) valid for 60 seconds and usable once.
 * The socket opened with it belongs to that session and is closed when the session ends.
 * @returns {{ ticket: string, url: string, expiresIn: number }}
 */
const issueTicket = (user, sessionId = null) => {
  const claims = { jti: crypto.randomBytes(16).toString('base64url') };
  if (validSessionId(sessionId)) claims.sid = sessionId;
  const ticket = jwt.sign(claims, ticketKey(), {
    algorithm: 'HS256',
    audience: TICKET_AUDIENCE,
    issuer: TICKET_ISSUER,
    subject: String(user._id),
    expiresIn: TICKET_TTL_SECONDS,
  });
  return { ticket, url: publicApiUrl(), expiresIn: TICKET_TTL_SECONDS };
};

class HandshakeError extends Error {
  constructor(code) {
    super('Authentication failed');
    this.data = { code };
  }
}

const purgeUsedTickets = (now = Date.now()) => {
  usedTickets.forEach((expiresAt, jti) => {
    if (expiresAt <= now) usedTickets.delete(jti);
  });
};

// Verifies a ticket and marks it used. Returns { userId, sessionId } (sessionId null for a ticket without `sid`).
const consumeTicket = (ticket) => {
  let payload;
  try {
    payload = jwt.verify(ticket, ticketKey(), {
      algorithms: ['HS256'],
      audience: TICKET_AUDIENCE,
      issuer: TICKET_ISSUER,
    });
  } catch (error) {
    throw new HandshakeError(error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
  }
  const { jti, sub, exp, sid } = payload;
  if (typeof jti !== 'string' || !jti || !mongoose.isObjectIdOrHexString(sub)) {
    throw new HandshakeError('INVALID_TOKEN');
  }
  if (sid !== undefined && !validSessionId(sid)) throw new HandshakeError('INVALID_TOKEN');
  const now = Date.now();
  if (usedTickets.size >= MAX_USED_TICKETS) purgeUsedTickets(now);
  if (usedTickets.has(jti)) throw new HandshakeError('INVALID_TOKEN');
  usedTickets.set(jti, (Number(exp) || 0) * 1000 || now + TICKET_TTL_SECONDS * 1000);
  return { userId: sub, sessionId: sid ?? null };
};

// Loaded lazily: requiring the auth middleware loads the User model, which app.js loads anyway.
const userModel = () => mongoose.models.User || require('../models/userModel');
const refreshTokenModel = () => mongoose.models.RefreshToken || require('../models/refreshTokenModel');

const loadUser = async (userId) => userModel().findById(userId).setOptions({ populateGroup: false });

/**
 * Whether the login session `sessionId` of `userId` is still open (its refresh token exists and has not expired).
 * Ended by logout, password change or reset, admin password change, account deletion, or expiry.
 */
const isSessionActive = async (userId, sessionId) => {
  if (!validSessionId(sessionId) || !mongoose.isObjectIdOrHexString(idOf(userId))) return false;
  const found = await refreshTokenModel().exists({
    user: idOf(userId),
    sessionId,
    expiresAt: { $gt: new Date() },
  });
  return Boolean(found);
};

const authenticateSocket = async (socket) => {
  const auth = socket.handshake.auth && typeof socket.handshake.auth === 'object' ? socket.handshake.auth : {};
  const ticket = typeof auth.ticket === 'string' ? auth.ticket.trim() : '';
  const token = typeof auth.token === 'string' ? auth.token.trim().replace(/^Bearer\s+/i, '') : '';

  let user;
  let sessionId;
  if (ticket) {
    const consumed = consumeTicket(ticket);
    user = await loadUser(consumed.userId);
    if (!user) throw new HandshakeError('INVALID_TOKEN');
    ({ sessionId } = consumed);
  } else if (token) {
    const { authenticateToken } = require('../middleware/requireAuth');
    try {
      ({ user, sessionId } = await authenticateToken(token));
    } catch (error) {
      if (error instanceof HandshakeError) throw error;
      const code = ['TOKEN_EXPIRED', 'INVALID_TOKEN'].includes(error?.code) ? error.code : 'INVALID_TOKEN';
      throw new HandshakeError(code);
    }
  } else {
    throw new HandshakeError('AUTH_REQUIRED');
  }

  // A credential of a session that has ended (logout, password change, ...) opens nothing, even while it has
  // not expired yet.
  if (sessionId && !(await isSessionActive(user._id, sessionId))) throw new HandshakeError('INVALID_TOKEN');
  return { user, sessionId: sessionId || null };
};

// True when the account's sessions (or this session) were revoked at or after `since` (ms).
const revokedSince = (userId, sessionId, since) =>
  (recentRevocations.get(userId) || 0) >= since ||
  Boolean(sessionId && (recentRevocations.get(`${userId}:${sessionId}`) || 0) >= since);

const pruneRevocations = (now = Date.now()) => {
  recentRevocations.forEach((at, key) => {
    if (at <= now - REVOCATION_MEMORY_MS) recentRevocations.delete(key);
  });
};

// Whether an open socket may stay connected: its user still exists with the same role and its session is open.
const connectionStillValid = async (socket, user) => {
  if (!user || user.role !== socket.data.role) return false;
  const { sessionId } = socket.data;
  return !sessionId || isSessionActive(socket.data.userId, sessionId);
};

const ack = (callback, value) => {
  if (typeof callback === 'function') {
    try {
      callback(value);
    } catch {
      // A broken client callback must never crash the server.
    }
  }
};

// "<prefix>:<id>" → { prefix, id }, or null when the name is malformed.
const parseRoom = (payload) => {
  const room = payload && typeof payload === 'object' ? payload.room : payload;
  if (typeof room !== 'string' || room.length > ROOM_MAX_LENGTH) return null;
  const match = ROOM_PATTERN.exec(room);
  return match ? { room, prefix: match[1], id: match[2] } : null;
};

// Small token bucket per socket for room:join (each join may query the database).
const takeJoinToken = (socket) => {
  const now = Date.now();
  const bucket = socket.data.joinBucket || { tokens: JOIN_BURST, at: now };
  bucket.tokens = Math.min(JOIN_BURST, bucket.tokens + ((now - bucket.at) / 1000) * JOIN_REFILL_PER_SECOND);
  bucket.at = now;
  socket.data.joinBucket = bucket;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
};

const joinedRooms = (socket) => [...socket.rooms].filter((room) => room !== socket.id && room !== socket.data.userRoom);

const handleJoin = async (socket, payload, callback) => {
  const parsed = parseRoom(payload);
  if (!parsed) return ack(callback, { ok: false, error: 'INVALID_ROOM' });
  if (!takeJoinToken(socket)) return ack(callback, { ok: false, error: 'TOO_MANY_REQUESTS' });
  const { room, prefix, id } = parsed;

  if (prefix === 'user') {
    // Every socket is already in its own user room; other users' rooms are never joinable.
    return ack(callback, id === socket.data.userId ? { ok: true } : { ok: false, error: 'FORBIDDEN' });
  }
  if (socket.rooms.has(room)) return ack(callback, { ok: true });
  const authorize = authorizers.get(prefix);
  if (!authorize) return ack(callback, { ok: false, error: 'UNKNOWN_ROOM' });
  if (joinedRooms(socket).length >= MAX_ROOMS_PER_SOCKET) return ack(callback, { ok: false, error: 'TOO_MANY_ROOMS' });

  try {
    // Read the user again: a deleted account, a role change or an ended session applies immediately.
    const user = await loadUser(socket.data.userId);
    if (!(await connectionStillValid(socket, user))) {
      ack(callback, { ok: false, error: 'AUTH_REQUIRED' });
      socket.disconnect(true);
      return undefined;
    }
    const allowed = await authorize(user, id);
    if (allowed !== true) return ack(callback, { ok: false, error: 'FORBIDDEN' });
    if (!socket.connected) return undefined;
    socket.join(room);
    return ack(callback, { ok: true });
  } catch (error) {
    console.error(`[realtime] Room authorizer "${prefix}" failed:`, error.message);
    return ack(callback, { ok: false, error: 'INTERNAL_ERROR' });
  }
};

const handleLeave = (socket, payload, callback) => {
  const parsed = parseRoom(payload);
  if (!parsed) return ack(callback, { ok: false, error: 'INVALID_ROOM' });
  if (parsed.room !== socket.data.userRoom) socket.leave(parsed.room);
  return ack(callback, { ok: true });
};

const onConnection = (socket) => {
  const { userId } = socket.data;
  socket.data.userRoom = `user:${userId}`;
  socket.join(socket.data.userRoom);
  socketCounts.set(userId, (socketCounts.get(userId) || 0) + 1);

  socket.on('room:join', (payload, callback) => {
    handleJoin(socket, payload, callback).catch(() => {});
  });
  socket.on('room:leave', (payload, callback) => {
    handleLeave(socket, payload, callback);
  });
  socket.on('disconnect', () => {
    const count = (socketCounts.get(userId) || 1) - 1;
    if (count <= 0) socketCounts.delete(userId);
    else socketCounts.set(userId, count);
  });
};

/**
 * Safety net (every 60 s): closes the open sockets whose user no longer exists, whose role changed, or whose login
 * session ended (refresh token deleted or expired). Catches what the immediate disconnections cannot see
 * (expiry, revocations made by another process). Never throws; resolves to the number of sockets closed.
 */
const checkConnections = async () => {
  if (!io || checkingConnections || mongoose.connection.readyState !== 1) return 0;
  checkingConnections = true;
  let closed = 0;
  try {
    const sockets = [...io.of('/').sockets.values()].filter((socket) => socket.connected && socket.data.userId);
    for (let start = 0; start < sockets.length; start += CONNECTION_CHECK_BATCH) {
      const batch = sockets.slice(start, start + CONNECTION_CHECK_BATCH);
      const userIds = [...new Set(batch.map((socket) => socket.data.userId))];
      const sessionIds = [...new Set(batch.map((socket) => socket.data.sessionId).filter(Boolean))];
      // One batch at a time: bounded queries, whatever the number of connections.
      const [users, sessions] = await Promise.all([
        userModel().find({ _id: { $in: userIds } }).select('role').setOptions({ populateGroup: false }).lean(),
        sessionIds.length > 0
          ? refreshTokenModel()
              .find({ sessionId: { $in: sessionIds }, expiresAt: { $gt: new Date() } })
              .select('user sessionId')
              .lean()
          : [],
      ]);
      const roles = new Map(users.map((user) => [String(user._id), user.role]));
      const live = new Set(sessions.map((session) => `${session.user}:${session.sessionId}`));
      batch.forEach((socket) => {
        const { userId, sessionId, role } = socket.data;
        const valid = roles.get(userId) === role && (!sessionId || live.has(`${userId}:${sessionId}`));
        if (!valid && socket.connected) {
          socket.disconnect(true);
          closed += 1;
        }
      });
    }
  } catch (error) {
    console.error('[realtime] Could not check the open connections:', error.message);
  } finally {
    checkingConnections = false;
  }
  return closed;
};

/** Disconnects every client and stops accepting new ones (the HTTP server itself is closed by app.js). */
const close = () => {
  if (!io) return;
  const server = io;
  io = null;
  try {
    server.disconnectSockets(true);
    server.engine.close();
  } catch (error) {
    console.error('[realtime] Could not close the real-time server:', error.message);
  }
};

/**
 * Attaches the Socket.IO server to the API's HTTP server (called once by app.js after listen).
 * Browser origins must be in CORS_ORIGINS; clients without an Origin header (mobile apps) are accepted.
 */
const init = (httpServer) => {
  if (io) return io;
  const origins = corsOrigins();
  io = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: MAX_CLIENT_MESSAGE_BYTES,
    cors: { origin: origins, methods: ['GET', 'POST'], credentials: false },
    // CORS headers do not protect WebSocket upgrades: check the Origin of browsers here.
    allowRequest: (req, callback) => {
      const { origin } = req.headers;
      callback(null, !origin || origins.includes(origin));
    },
  });

  io.use((socket, next) => {
    const startedAt = Date.now();
    authenticateSocket(socket)
      .then(({ user, sessionId }) => {
        const userId = String(user._id);
        // The sessions of the account (or this one) were revoked while the credential was being checked.
        if (revokedSince(userId, sessionId, startedAt)) return next(new HandshakeError('INVALID_TOKEN'));
        if ((socketCounts.get(userId) || 0) >= MAX_SOCKETS_PER_USER) {
          const error = new Error('Too many connections');
          error.data = { code: 'TOO_MANY_CONNECTIONS' };
          return next(error);
        }
        socket.data.userId = userId;
        socket.data.role = user.role;
        socket.data.sessionId = sessionId;
        return next();
      })
      .catch((error) => {
        if (error instanceof HandshakeError) return next(error);
        console.error('[realtime] Handshake failed:', error.message);
        const failure = new Error('Authentication failed');
        failure.data = { code: 'INTERNAL_ERROR' };
        return next(failure);
      });
  });
  io.on('connection', onConnection);

  if (!shutdownHooked) {
    shutdownHooked = true;
    // Close the WebSocket connections first so app.js's server.close() can finish.
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  }
  const timer = setInterval(() => {
    purgeUsedTickets();
    pruneRevocations();
    checkConnections().catch(() => {});
  }, CONNECTION_CHECK_INTERVAL_MS);
  timer.unref();
  httpServer.once('close', () => clearInterval(timer));
  return io;
};

const safeEmit = (target, event, payload) => {
  if (!io || typeof event !== 'string' || !event) return false;
  try {
    io.to(target).emit(event, payload);
    return true;
  } catch (error) {
    console.error(`[realtime] Could not emit "${event}":`, error.message);
    return false;
  }
};

/** Sends `event` to every socket of a user. Never throws; false before init. */
const emitToUser = (userId, event, payload) => {
  const id = idOf(userId);
  if (!id) return false;
  return safeEmit(`user:${id}`, event, payload);
};

/** Sends `event` to every socket in `room` (e.g. "trip:<id>"). Never throws; false before init. */
const emitToRoom = (room, event, payload) => {
  if (typeof room !== 'string' || !room) return false;
  return safeEmit(room, event, payload);
};

/** Makes every socket of a user leave `room` (e.g. a passenger who cancelled). Never throws. */
const removeUserFromRoom = (userId, room) => {
  if (!io || !userId || typeof room !== 'string') return;
  try {
    io.in(`user:${idOf(userId)}`).socketsLeave(room);
  } catch (error) {
    console.error('[realtime] Could not remove a user from a room:', error.message);
  }
};

/**
 * Closes the real-time connections of a user (they leave every room): all of them, or with `sessionId` only those
 * opened with a credential of that login session. Called when sessions end (tokenService) and on an account
 * deletion or a role change (userController). A handshake in progress for the same user (or session) is refused.
 * Never throws; resolves to the number of sockets closed (0 before init, in scripts).
 */
const disconnectUser = async (userId, options = {}) => {
  const id = idOf(userId);
  if (!io || !id) return 0;
  try {
    const sessionId = options && typeof options === 'object' && validSessionId(options.sessionId) ? options.sessionId : null;
    recentRevocations.set(sessionId ? `${id}:${sessionId}` : id, Date.now());
    const sockets = await io.in(`user:${id}`).fetchSockets();
    let closed = 0;
    sockets.forEach((socket) => {
      if (sessionId && socket.data?.sessionId !== sessionId) return;
      socket.disconnect(true);
      closed += 1;
    });
    return closed;
  } catch (error) {
    console.error('[realtime] Could not close the connections of a user:', error.message);
    return 0;
  }
};

/**
 * Registers who may join the rooms "<prefix>:<id>": authorizer(user, id) resolves to true to allow
 * (user = the User document, read again at each join). Registering a prefix again replaces it.
 */
const registerRoomAuthorizer = (prefix, authorizer) => {
  if (typeof prefix !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(prefix) || prefix === 'user') {
    throw new Error('registerRoomAuthorizer: invalid room prefix');
  }
  if (typeof authorizer !== 'function') throw new Error('registerRoomAuthorizer: authorizer must be a function');
  authorizers.set(prefix, authorizer);
};

module.exports = {
  init,
  close,
  issueTicket,
  isSessionActive,
  emitToUser,
  emitToRoom,
  removeUserFromRoom,
  disconnectUser,
  checkConnections,
  registerRoomAuthorizer,
  getServer: () => io,
  TICKET_TTL_SECONDS,
  SOCKET_PATH,
};
