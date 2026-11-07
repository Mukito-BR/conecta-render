import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const app = express();
const httpServer = createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((origin) => origin.trim());
const corsOrigin = allowedOrigins.includes('*') ? '*' : allowedOrigins;
app.use(cors({ origin: corsOrigin }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'realtime-room' }));

// In production, serve the Vite build from this same public web service.
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));

const io = new Server(httpServer, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });
type Member = { id: string; name: string; micMuted: boolean; sharing: boolean; camera: boolean; screenStreamId?: string; cameraStreamId?: string };
type Room = { members: Map<string, Member>; passwordSalt?: Buffer; passwordHash?: Buffer };
const rooms = new Map<string, Room>();

io.on('connection', (socket) => {
  let currentRoom: string | undefined;
  socket.on('join-room', (payload: { roomId?: string; name?: string; password?: string } = {}, ack?: (data: unknown) => void) => {
    const roomId = payload.roomId?.trim().slice(0, 80);
    if (!roomId) { ack?.({ error: 'Informe um ID de sala válido.' }); return; }
    const password = payload.password?.trim() ?? '';
    let room = rooms.get(roomId);
    if (!room) {
      if (password && password.length < 6) { ack?.({ error: 'A senha precisa ter pelo menos 6 caracteres.' }); return; }
      room = { members: new Map<string, Member>() };
      if (password) {
        room.passwordSalt = randomBytes(16);
        room.passwordHash = scryptSync(password, room.passwordSalt, 64);
      }
      rooms.set(roomId, room);
    }
    if (room.passwordHash && (!password || !room.passwordSalt || !timingSafeEqual(scryptSync(password, room.passwordSalt, 64), room.passwordHash))) {
      ack?.({ error: 'Senha incorreta ou não informada. Peça a senha ao criador da sala.' }); return;
    }
    if (!room.passwordHash && password) { ack?.({ error: 'Esta sala é pública e não usa senha.' }); return; }
    if (currentRoom) leaveRoom();
    currentRoom = roomId;
    const member: Member = { id: socket.id, name: payload.name?.trim().slice(0, 32) || 'Convidado', micMuted: false, sharing: false, camera: false };
    const existing = [...room.members.values()];
    room.members.set(socket.id, member);
    socket.join(roomId);
    // Send current membership to the joiner, then announce them to existing peers.
    ack?.({ roomId, self: member, participants: existing });
    socket.to(roomId).emit('user-joined', member);
  });

  socket.on('signal', (payload: { to?: string; data?: unknown } = {}) => {
    if (!currentRoom || !payload.to || !payload.data) return;
    const target = rooms.get(currentRoom)?.members.has(payload.to);
    if (target) io.to(payload.to).emit('signal', { from: socket.id, data: payload.data });
  });

  socket.on('member-state', (state: Partial<Pick<Member, 'micMuted' | 'sharing' | 'camera' | 'screenStreamId' | 'cameraStreamId'>>) => {
    if (!currentRoom) return;
    const member = rooms.get(currentRoom)?.members.get(socket.id);
    if (!member) return;
    if (typeof state.micMuted === 'boolean') member.micMuted = state.micMuted;
    if (typeof state.sharing === 'boolean') member.sharing = state.sharing;
    if (typeof state.camera === 'boolean') member.camera = state.camera;
    if (typeof state.screenStreamId === 'string' || state.screenStreamId === undefined) member.screenStreamId = state.screenStreamId;
    if (typeof state.cameraStreamId === 'string' || state.cameraStreamId === undefined) member.cameraStreamId = state.cameraStreamId;
    io.to(currentRoom).emit('member-updated', member);
  });

  socket.on('disconnecting', leaveRoom);
  function leaveRoom() {
    if (!currentRoom) return;
    const roomId = currentRoom;
    rooms.get(roomId)?.members.delete(socket.id);
    socket.to(roomId).emit('user-disconnected', { id: socket.id });
    currentRoom = undefined;
  }
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, '0.0.0.0', () => console.log(`Signaling server listening on http://0.0.0.0:${port}`));
