import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Server } from 'socket.io';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(projectRoot, '.env') });

const app = express();
const httpServer = createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim());
const corsOrigin = allowedOrigins.includes('*') ? '*' : allowedOrigins;
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '256kb' }));
const io = new Server(httpServer, { cors: { origin: corsOrigin, methods: ['GET', 'POST', 'DELETE'] } });

type Member = { id: string; name: string; avatarUrl: string; micMuted: boolean; sharing: boolean; camera: boolean; screenStreamId?: string; cameraStreamId?: string };
type ChatMessage = { id: string; senderId: string; name: string; avatarUrl: string; text: string; createdAt: number };
type Room = { id: string; name: string; isPrivate: boolean; ownerHash?: Buffer; passwordSalt?: Buffer; passwordHash?: Buffer; members: Map<string, Member>; clientSessions: Map<string, string>; messages: ChatMessage[] };
const rooms = new Map<string, Room>();
rooms.set('sala-geral', { id: 'sala-geral', name: 'Sala Geral', isPrivate: false, members: new Map(), clientSessions: new Map(), messages: [] });

function hashOwnerToken(token: string) { return createHash('sha256').update(token).digest(); }
function safeEqual(left?: Buffer, right?: Buffer) { return Boolean(left && right && left.length === right.length && timingSafeEqual(left, right)); }
function roomSummary(room: Room) { return { id: room.id, name: room.name, private: room.isPrivate, count: room.members.size, capacity: 10 }; }
function broadcastPublicRooms() { io.emit('public-rooms', [...rooms.values()].filter((room) => !room.isPrivate).map(roomSummary)); }
function isAvatar(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 180_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'realtime-room' }));
app.get('/api/rooms', (_req, res) => res.json([...rooms.values()].filter((room) => !room.isPrivate).map(roomSummary)));
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada.' });
  // Private rooms can be looked up only by their exact invite ID; they never enter public search.
  res.json({ id: room.id, name: room.isPrivate ? undefined : room.name, private: room.isPrivate, count: room.members.size, capacity: 10 });
});
app.get('/api/my-rooms', (req, res) => {
  const token = req.header('x-owner-token');
  if (!token || token.length < 32 || token.length > 200) return res.status(401).json({ error: 'Identidade de criação inválida.' });
  const ownerHash = hashOwnerToken(token);
  res.json([...rooms.values()].filter((room) => safeEqual(room.ownerHash, ownerHash)).map(roomSummary));
});

app.post('/api/rooms', (req, res) => {
  const { ownerToken, name, private: isPrivate, password } = req.body ?? {};
  if (typeof ownerToken !== 'string' || ownerToken.length < 32 || ownerToken.length > 200) return res.status(400).json({ error: 'Identidade de criação inválida.' });
  const roomName = typeof name === 'string' ? name.trim().slice(0, 48) : '';
  if (roomName.length < 2) return res.status(400).json({ error: 'O nome da sala precisa ter pelo menos 2 caracteres.' });
  if (typeof isPrivate !== 'boolean') return res.status(400).json({ error: 'Escolha se a sala será pública ou privada.' });
  const secret = typeof password === 'string' ? password : '';
  if (isPrivate && secret.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (!isPrivate && secret) return res.status(400).json({ error: 'Salas públicas não usam senha.' });
  const ownerHash = hashOwnerToken(ownerToken);
  const owned = [...rooms.values()].filter((room) => safeEqual(room.ownerHash, ownerHash));
  const currentTypeCount = owned.filter((room) => room.isPrivate === isPrivate).length;
  if (currentTypeCount >= 3) return res.status(409).json({ error: `Você já atingiu o limite de 3 salas ${isPrivate ? 'privadas' : 'públicas'}. Apague uma sala para criar outra.` });

  let id = `sala-${randomBytes(4).toString('hex')}`;
  while (rooms.has(id)) id = `sala-${randomBytes(4).toString('hex')}`;
  const room: Room = { id, name: roomName, isPrivate, ownerHash, members: new Map(), clientSessions: new Map(), messages: [] };
  if (isPrivate) { room.passwordSalt = randomBytes(16); room.passwordHash = scryptSync(secret, room.passwordSalt, 64); }
  rooms.set(id, room);
  if (!isPrivate) broadcastPublicRooms();
  res.status(201).json(roomSummary(room));
});

app.delete('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  const token = req.header('x-owner-token');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!room || !room.ownerHash) return res.status(404).json({ error: 'Sala não encontrada ou não pode ser removida.' });
  if (!token || !safeEqual(room.ownerHash, hashOwnerToken(token))) return res.status(403).json({ error: 'Somente quem criou a sala pode apagá-la.' });
  if (room.isPrivate && (!room.passwordHash || !room.passwordSalt || !password || !safeEqual(scryptSync(password, room.passwordSalt, 64), room.passwordHash))) {
    return res.status(403).json({ error: 'Senha incorreta. A sala privada não foi apagada.' });
  }
  rooms.delete(room.id);
  io.to(room.id).emit('room-deleted', { roomId: room.id });
  io.in(room.id).disconnectSockets(true);
  if (!room.isPrivate) broadcastPublicRooms();
  res.status(204).end();
});

io.on('connection', (socket) => {
  let currentRoom: string | undefined;
  const recentMessages: number[] = [];

  socket.on('join-room', (payload: { roomId?: string; name?: string; password?: string; avatarUrl?: string; clientId?: string } = {}, ack?: (data: unknown) => void) => {
    const roomId = payload.roomId?.trim().slice(0, 80);
    if (!roomId) { ack?.({ error: 'Informe um ID de sala válido.' }); return; }
    const room = rooms.get(roomId);
    if (!room) { ack?.({ error: 'Sala não encontrada. Peça um convite ou escolha uma sala pública da lista.' }); return; }
    const password = payload.password ?? '';
    if (room.passwordHash && (!password || !room.passwordSalt || !safeEqual(scryptSync(password, room.passwordSalt, 64), room.passwordHash))) {
      ack?.({ error: 'Senha incorreta ou não informada. Peça a senha ao criador da sala.' }); return;
    }
    const memberName = payload.name?.trim().slice(0, 32) || 'Convidado';
    const clientId = typeof payload.clientId === 'string' && /^[a-f0-9-]{36}$/i.test(payload.clientId) ? payload.clientId : undefined;
    const existingClientSocketId = clientId ? room.clientSessions.get(clientId) : undefined;
    const existingClient = existingClientSocketId && existingClientSocketId !== socket.id ? room.members.get(existingClientSocketId) : undefined;
    const normalizedName = memberName.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
    // In this app, the displayed profile name is the identity. Keep one presence per name in a room.
    const duplicates = [...room.members.values()].filter((member) => member.id !== socket.id && (member === existingClient || member.name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR') === normalizedName));
    duplicates.forEach((duplicate) => replaceMemberSession(roomId, room, duplicate));
    if (room.members.size >= 10 && !room.members.has(socket.id)) { ack?.({ error: 'Esta sala já atingiu o limite de 10 participantes.' }); return; }
    if (currentRoom) leaveRoom();
    currentRoom = roomId;
    const member: Member = { id: socket.id, name: memberName, avatarUrl: isAvatar(payload.avatarUrl) ? payload.avatarUrl : '', micMuted: false, sharing: false, camera: false };
    const existing = [...room.members.values()];
    room.members.set(socket.id, member);
    if (clientId) room.clientSessions.set(clientId, socket.id);
    socket.join(roomId);
    ack?.({ roomId, self: member, participants: existing, messages: room.messages.slice(-100), room: roomSummary(room) });
    socket.to(roomId).emit('user-joined', member);
    if (!room.isPrivate) broadcastPublicRooms();
  });

  socket.on('signal', (payload: { to?: string; data?: unknown } = {}) => {
    if (!currentRoom || !payload.to || !payload.data) return;
    const target = rooms.get(currentRoom)?.members.has(payload.to);
    if (target) io.to(payload.to).emit('signal', { from: socket.id, data: payload.data });
  });

  socket.on('member-state', (state: Partial<Pick<Member, 'micMuted' | 'sharing' | 'camera' | 'screenStreamId' | 'cameraStreamId' | 'avatarUrl'>> & { clientId?: string }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    const member = room?.members.get(socket.id);
    if (!member) return;
    const clientId = typeof state.clientId === 'string' && /^[a-f0-9-]{36}$/i.test(state.clientId) ? state.clientId : undefined;
    const existingClientSocketId = clientId ? room?.clientSessions.get(clientId) : undefined;
    const existingClient = existingClientSocketId && existingClientSocketId !== socket.id ? room?.members.get(existingClientSocketId) : undefined;
    const normalizedName = member.name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
    const duplicates = [...(room?.members.values() ?? [])].filter((candidate) => candidate.id !== socket.id && (candidate === existingClient || candidate.name.normalize('NFKC').trim().toLocaleLowerCase('pt-BR') === normalizedName));
    if (room) duplicates.forEach((duplicate) => replaceMemberSession(currentRoom!, room, duplicate));
    if (room && clientId) room.clientSessions.set(clientId, socket.id);
    if (typeof state.micMuted === 'boolean') member.micMuted = state.micMuted;
    if (typeof state.sharing === 'boolean') member.sharing = state.sharing;
    if (typeof state.camera === 'boolean') member.camera = state.camera;
    if (isAvatar(state.avatarUrl)) member.avatarUrl = state.avatarUrl;
    if (typeof state.screenStreamId === 'string' || state.screenStreamId === undefined) member.screenStreamId = state.screenStreamId;
    if (typeof state.cameraStreamId === 'string' || state.cameraStreamId === undefined) member.cameraStreamId = state.cameraStreamId;
    io.to(currentRoom).emit('member-updated', member);
  });

  socket.on('chat-message', (payload: { text?: string } = {}) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    const sender = room?.members.get(socket.id);
    const text = payload.text?.trim();
    if (!room || !sender || !text || text.length > 2000) return;
    const now = Date.now();
    while (recentMessages.length && now - recentMessages[0] > 10_000) recentMessages.shift();
    if (recentMessages.length >= 12) { socket.emit('chat-error', { error: 'Aguarde um pouco antes de enviar mais mensagens.' }); return; }
    recentMessages.push(now);
    const message: ChatMessage = { id: randomBytes(8).toString('hex'), senderId: sender.id, name: sender.name, avatarUrl: sender.avatarUrl, text, createdAt: now };
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);
    io.to(currentRoom).emit('chat-message', message);
  });

  socket.on('disconnecting', leaveRoom);
  function leaveRoom() {
    if (!currentRoom) return;
    const roomId = currentRoom;
    const room = rooms.get(roomId);
    const removed = room?.members.delete(socket.id) ?? false;
    if (removed && room) for (const [id, sessionSocketId] of room.clientSessions) if (sessionSocketId === socket.id) room.clientSessions.delete(id);
    if (removed) socket.to(roomId).emit('user-disconnected', { id: socket.id });
    currentRoom = undefined;
    if (room && !room.isPrivate) broadcastPublicRooms();
  }

  function replaceMemberSession(roomId: string, room: Room, member: Member) {
    const previousSocket = io.sockets.sockets.get(member.id);
    room.members.delete(member.id);
    for (const [id, sessionSocketId] of room.clientSessions) if (sessionSocketId === member.id) room.clientSessions.delete(id);
    io.to(roomId).emit('user-disconnected', { id: member.id });
    previousSocket?.emit('session-replaced');
    previousSocket?.disconnect(true);
  }
});

const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.json({ service: 'realtime-room', mode: 'development', client: `http://localhost:${process.env.APP_CLIENT_PORT ?? 5173}` }));
}

const port = Number(process.env.PORT ?? process.env.APP_SERVER_PORT ?? 3001);
const host = process.env.APP_SERVER_HOST ?? '0.0.0.0';
httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') console.error(`A porta ${port} já está em uso. Feche o servidor antigo do Conecta e tente novamente.`);
  else console.error('Falha ao iniciar o servidor:', error);
  process.exitCode = 1;
});
httpServer.listen(port, host, () => console.log(`Conecta server listening on http://${host}:${port}`));
