import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config.js';

export const createSheetSocket = (token) =>
  io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

export const emitWithAck = (socket, event, payload, timeoutMs = 10_000) =>
  socket.timeout(timeoutMs).emitWithAck(event, payload);
