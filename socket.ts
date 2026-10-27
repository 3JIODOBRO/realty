'use client';
import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

let socket: Socket | null = null;
let currentToken: string | null = null;

export function getSocket(token: string): Socket {
  if (socket && currentToken === token) return socket;
  socket?.disconnect();
  currentToken = token;
  socket = io(`${API_URL}/chat`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}

/** emit with ack + timeout, so the UI can mark a message as failed and offer retry */
export function emitAck<T>(s: Socket, event: string, data: unknown, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    s.timeout(timeoutMs).emit(event, data, (err: Error | null, res: T) => (err ? reject(err) : resolve(res)));
  });
}
