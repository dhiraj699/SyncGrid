import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { createCorsOriginMatcher } from '../../config/cors.js';
import { ROLES } from '../../domain/access.js';
import { SheetNotFoundError } from '../../engine/sheetSession.js';
import { projectEvent } from '../../security/masking.js';
import { joinSchema, presenceSchema, submitOpsSchema } from '../schemas.js';

const CATCH_UP_LIMIT = 2_000;
const sheetRoom = (sheetId) => `sheet:${sheetId}`;
const roleRoom = (sheetId, role) => `sheet:${sheetId}:role:${role}`;

const toErrorPayload = (error) => {
  if (error instanceof ZodError) return { code: 'VALIDATION_FAILED', message: 'Malformed payload' };
  if (error instanceof SheetNotFoundError) return { code: error.code, message: error.message };
  return { code: error.code ?? 'INTERNAL_ERROR', message: error.expose ? error.message : 'Unexpected server error' };
};

export function attachGateway({ httpServer, registry, authService, config, logger }) {
  const corsOrigin = createCorsOriginMatcher(config.CORS_ORIGIN || config.CLIENT_ORIGIN, config.NODE_ENV === 'production');
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    perMessageDeflate: { threshold: 1024 },
    maxHttpBufferSize: 2_000_000,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const presenceBySheet = new Map();
  const wiredSessions = new WeakSet();

  /** Broadcasts once per role room so each role receives a payload masked for it, never a superset. */
  const wireSession = (session) => {
    if (wiredSessions.has(session)) return;
    wiredSessions.add(session);
    const sheetId = session.sheet.id;

    session.on('committed', ({ events, revision }) => {
      for (const role of ROLES) {
        const projected = events.map((event) => projectEvent(event, session.columnsByKey, role));
        io.to(roleRoom(sheetId, role)).emit('sheet:events', { events: projected, revision });
      }
    });
    session.on('schema', () => io.to(sheetRoom(sheetId)).emit('sheet:resync', { reason: 'SCHEMA_CHANGED' }));
  };

  io.use(async (socket, next) => {
    try {
      socket.data.user = await authService.authenticate(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const log = logger.child({ userId: user.id, socketId: socket.id });

    const on = (event, schema, handler) => {
      socket.on(event, async (rawPayload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          reply({ ok: true, ...(await handler(schema.parse(rawPayload))) });
        } catch (error) {
          if (!(error instanceof ZodError)) log.error({ err: error, event }, 'socket handler failed');
          reply({ ok: false, error: toErrorPayload(error) });
        }
      });
    };

    const requireJoined = (sheetId) => {
      if (socket.data.sheetId !== sheetId) throw Object.assign(new Error('Join the sheet first'), { code: 'NOT_JOINED', expose: true });
    };

    on('sheet:join', joinSchema, async ({ sheetId, lastKnownRevision }) => {
      const session = await registry.get(sheetId);
      wireSession(session);
      socket.join([sheetRoom(sheetId), roleRoom(sheetId, user.role)]);
      socket.data.sheetId = sheetId;

      const presence = presenceBySheet.get(sheetId) ?? new Map();
      presenceBySheet.set(sheetId, presence);
      presence.set(socket.id, { socketId: socket.id, userId: user.id, name: user.name, initials: user.initials, color: user.color, cellId: null });

      const response = {
        revision: session.revision,
        vectorClock: { ...session.vectorClock },
        lamport: session.lamport,
        presence: [...presence.values()].filter((entry) => entry.socketId !== socket.id),
      };

      if (lastKnownRevision !== undefined) {
        const gap = session.revision - lastKnownRevision;
        if (gap < 0 || gap > CATCH_UP_LIMIT) response.resyncRequired = true;
        else if (gap > 0) {
          const missed = await session.eventsAfter(lastKnownRevision, CATCH_UP_LIMIT);
          response.catchUp = missed.map((event) => projectEvent(event, session.columnsByKey, user.role));
        }
      }
      socket.to(sheetRoom(sheetId)).emit('presence:update', presence.get(socket.id));
      return response;
    });

    on('ops:submit', submitOpsSchema, async ({ sheetId, ops, atomic }) => {
      requireJoined(sheetId);
      const session = await registry.get(sheetId);
      const { results, revision } = await session.submit({ author: { id: user.id, role: user.role }, ops, atomic });
      return { results, revision, reconciled: true };
    });

    on('presence:select', presenceSchema, async ({ sheetId, cellId }) => {
      requireJoined(sheetId);
      const entry = presenceBySheet.get(sheetId)?.get(socket.id);
      if (entry) {
        entry.cellId = cellId;
        socket.to(sheetRoom(sheetId)).emit('presence:update', entry);
      }
      return {};
    });

    socket.on('disconnect', () => {
      const { sheetId } = socket.data;
      if (!sheetId) return;
      presenceBySheet.get(sheetId)?.delete(socket.id);
      io.to(sheetRoom(sheetId)).emit('presence:leave', { socketId: socket.id });
    });
  });

  return io;
}
