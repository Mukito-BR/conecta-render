import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Headphones, Lock, MessageCircle, Mic, MicOff, MonitorUp, PhoneOff, Plus, Radio, Users, Copy, Check, Volume2, VolumeX, Trash2, X, Send, Link2 } from 'lucide-react';
import { ChatMessage, Participant, useWebRTC, getBrowserClientId } from './useWebRTC';

type RoomChannel = { id: string; name: string; private: boolean; owned?: boolean; count?: number; capacity?: number };
const API_URL = import.meta.env.VITE_SIGNAL_URL || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3001` : location.origin);

function readLocalRooms(): RoomChannel[] {
  try {
    const value = JSON.parse(localStorage.getItem('conecta:rooms') || '[]');
    return Array.isArray(value) ? value.filter((room) => room && typeof room.id === 'string').map((room) => ({ id: room.id, name: room.name || room.id, private: Boolean(room.private), owned: Boolean(room.owned) })) : [];
  } catch { return []; }
}

function initialRoomState() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'sala-geral';
  const rooms = readLocalRooms();
  const privateRoom = params.get('private') === '1' || Boolean(rooms.find((room) => room.id === roomId)?.private);
  if (!rooms.some((room) => room.id === roomId)) rooms.push({ id: roomId, name: roomId === 'sala-geral' ? 'Sala Geral' : roomId, private: privateRoom });
  else if (params.get('private') === '1') rooms.forEach((room) => { if (room.id === roomId) room.private = true; });
  return { roomId, privateRoom, rooms };
}

function upsertRoom(rooms: RoomChannel[], next: RoomChannel) {
  return rooms.some((room) => room.id === next.id) ? rooms.map((room) => room.id === next.id ? next : room) : [...rooms, next];
}

function getOwnerToken() {
  let token = localStorage.getItem('conecta:owner-token');
  if (!token) { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); localStorage.setItem('conecta:owner-token', token); }
  return token;
}

function Avatar({ name, src, className = '' }: { name: string; src?: string; className?: string }) {
  return <span className={`avatar ${className}`}>{src ? <img src={src} alt=""/> : name.slice(0, 1).toUpperCase()}</span>;
}

function resizeAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160;
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(objectUrl); reject(new Error('Não foi possível processar a imagem.')); return; }
      const side = Math.min(image.width, image.height); const x = (image.width - side) / 2; const y = (image.height - side) / 2;
      context.drawImage(image, x, y, side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(objectUrl); resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Não foi possível abrir essa imagem.')); };
    image.src = objectUrl;
  });
}

function Video({ stream, label, muted = false }: { stream?: MediaStream; label: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream ?? null; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} aria-label={label} />;
}

export default function Room() {
  const [initial] = useState(initialRoomState);
  const [rooms, setRooms] = useState<RoomChannel[]>(initial.rooms);
  const [publicRooms, setPublicRooms] = useState<RoomChannel[]>([]);
  const [directorySearch, setDirectorySearch] = useState('');
  const [roomId, setRoomId] = useState(initial.roomId);
  const [privateRoom, setPrivateRoom] = useState(initial.privateRoom);
  const [roomPassword, setRoomPassword] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('conecta:name') || 'Convidado');
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem('conecta:avatar') || '');
  const [ownerToken] = useState(getOwnerToken);
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [outputVolume, setOutputVolume] = useState(() => {
    const saved = localStorage.getItem('conecta:output-volume');
    if (saved === null) return 1;
    const parsed = Number(saved);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
  });
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatDraft, setChatDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [draftPassword, setDraftPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoomChannel | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const rtc = useWebRTC();
  const profileKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
  const selfProfileKey = profileKey(name);
  const visibleParticipants = rtc.participants.filter((person, index, people) => profileKey(person.name) !== selfProfileKey && people.findIndex((candidate) => profileKey(candidate.name) === profileKey(person.name)) === index);
  const visiblePeerIds = new Set(visibleParticipants.map((person) => person.id));
  const screens = Object.entries(rtc.media).filter(([key]) => key === 'self' || visibleParticipants.some((p) => p.sharing && key === `${p.id}:${p.screenStreamId}`));
  const cameras = Object.entries(rtc.media).filter(([key]) => key === 'camera:self' || visibleParticipants.some((p) => p.camera && key === `${p.id}:${p.cameraStreamId}`));
  const stageFeeds = [...screens.map(([key, stream]) => ({ key, stream, kind: 'screen' as const })), ...cameras.map(([key, stream]) => ({ key, stream, kind: 'camera' as const }))];
  const audioPeers = Object.entries(rtc.media).filter(([key]) => key !== 'self' && key !== 'camera:self' && visiblePeerIds.has(key.slice(0, key.indexOf(':'))));

  useEffect(() => { localStorage.setItem('conecta:rooms', JSON.stringify(rooms)); }, [rooms]);
  useEffect(() => { localStorage.setItem('conecta:output-volume', String(outputVolume)); }, [outputVolume]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [publicResponse, ownedResponse] = await Promise.all([
          fetch(`${API_URL}/api/rooms`),
          fetch(`${API_URL}/api/my-rooms`, { headers: { 'x-owner-token': ownerToken } }),
        ]);
        if (!active) return;
        let publicList: RoomChannel[] = [];
        if (publicResponse.ok) { publicList = await publicResponse.json() as RoomChannel[]; setPublicRooms(publicList); }
        if (ownedResponse.ok) {
          const owned = await ownedResponse.json() as RoomChannel[];
          const ownedIds = new Set(owned.map((room) => room.id));
          const publicIds = new Set(publicList.map((room) => room.id));
          setRooms((current) => owned.reduce((list, room) => upsertRoom(list, { ...room, owned: true }), current.filter((room) => room.owned ? ownedIds.has(room.id) : room.private || publicIds.has(room.id))));
        }
      } catch { /* Keep the last available directory snapshot. */ }
    };
    void load(); const interval = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ownerToken]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [rtc.messages]);
  useEffect(() => {
    const candidate = roomId.trim();
    if (!candidate) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(candidate)}`);
        if (!response.ok) return;
        const info = await response.json() as { private?: boolean };
        setPrivateRoom(Boolean(info.private));
      } catch { /* Keep the room type from the invite or local room list. */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [roomId]);
  useEffect(() => {
    if (rtc.error === 'Esta sala foi apagada pelo criador.' || rtc.error === 'Este perfil foi conectado em outro dispositivo. Para manter uma única presença, esta sessão foi desconectada.') {
      rtc.disconnect(); setJoined(false); setMuted(false);
    }
  }, [rtc.error, rtc.disconnect]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer); }, [notice]);

  const leave = () => { rtc.disconnect(); setJoined(false); setMuted(false); };
  const toggleMicrophone = async () => {
    if (!joined) { setMuted((value) => !value); return; }
    if (!rtc.microphoneAvailable) {
      if (await rtc.requestMicrophone()) setMuted(false);
      return;
    }
    setMuted(rtc.toggleMic());
  };
  const selectRoom = (room: RoomChannel) => {
    if (room.id === roomId) return;
    if (joined) leave();
    setRooms((current) => upsertRoom(current, { ...room, owned: Boolean(room.owned) }));
    setRoomId(room.id); setPrivateRoom(room.private); setRoomPassword('');
    const query = new URLSearchParams({ room: room.id }); if (room.private) query.set('private', '1');
    history.replaceState(null, '', `${location.pathname}?${query}`);
  };
  const openCreate = () => { setDraftName(''); setDraftPrivate(false); setDraftPassword(''); setCreateOpen(true); };
  const createRoom = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const response = await fetch(`${API_URL}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerToken, name: draftName, private: draftPrivate, password: draftPrivate ? draftPassword : '' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível criar a sala.');
      if (joined) leave();
      const created: RoomChannel = { ...result, owned: true };
      setRooms((current) => upsertRoom(current, created)); setRoomId(created.id); setPrivateRoom(created.private); setRoomPassword(draftPrivate ? draftPassword : '');
      const query = new URLSearchParams({ room: created.id }); if (created.private) query.set('private', '1');
      history.replaceState(null, '', `${location.pathname}?${query}`); setCreateOpen(false); setNotice('Sala criada. Entre para começar e convide seus amigos.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao criar a sala.'); }
    finally { setBusy(false); }
  };
  const join = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); localStorage.setItem('conecta:name', name);
    let detectedPrivate = privateRoom;
    try {
      const response = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId.trim())}`);
      if (response.ok) detectedPrivate = Boolean((await response.json() as { private?: boolean }).private);
    } catch { /* The join socket will show the connection error if the server is unreachable. */ }
    setPrivateRoom(detectedPrivate);
    if (detectedPrivate && !roomPassword) { setNotice('Esta sala é privada. Informe a senha para entrar.'); setBusy(false); return; }
    const query = new URLSearchParams({ room: roomId }); if (detectedPrivate) query.set('private', '1');
    history.replaceState(null, '', `${location.pathname}?${query}`);
    const ok = await rtc.connect(roomId, name, detectedPrivate ? roomPassword : '', avatarUrl);
    if (ok) { setJoined(true); setMuted(false); setRooms((current) => upsertRoom(current, { ...(current.find((room) => room.id === roomId) ?? {}), id: roomId, name: current.find((room) => room.id === roomId)?.name || roomId, private: detectedPrivate })); }
    setBusy(false);
  };
  const copyInvite = async () => {
    const query = new URLSearchParams({ room: roomId }); if (privateRoom) query.set('private', '1');
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?${query}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { setNotice('Não foi possível copiar automaticamente. Copie o endereço da barra do navegador.'); }
  };
  const deleteRoom = async (event: React.MouseEvent, room: RoomChannel) => {
    event.stopPropagation();
    if (!room.owned) {
      if (!window.confirm(`Remover “${room.name}” da sua lista neste navegador? A sala não será apagada para outros participantes.`)) return;
      if (joined && room.id === roomId) leave();
      setRooms((current) => current.filter((saved) => saved.id !== room.id));
      if (room.id === roomId) { setRoomId('sala-geral'); setPrivateRoom(false); setRoomPassword(''); history.replaceState(null, '', `${location.pathname}?room=sala-geral`); }
      setNotice('Sala removida da sua lista.'); return;
    }
    if (room.private) { setDeleteTarget(room); setDeletePassword(''); return; }
    if (!window.confirm(`Apagar “${room.name}”? A sala, o chat e o convite deixarão de funcionar.`)) return;
    await removeOwnedRoom(room, '');
  };
  const removeOwnedRoom = async (room: RoomChannel, password: string) => {
    setDeleteBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE', headers: { 'x-owner-token': ownerToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Não foi possível apagar essa sala.'); }
      if (joined && room.id === roomId) leave();
      setRooms((current) => current.filter((saved) => saved.id !== room.id));
      if (room.id === roomId) { setRoomId('sala-geral'); setPrivateRoom(false); setRoomPassword(''); history.replaceState(null, '', `${location.pathname}?room=sala-geral`); }
      setDeleteTarget(null); setDeletePassword(''); setNotice('Sala apagada.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Erro ao apagar sala.'); }
    finally { setDeleteBusy(false); }
  };
  const changeAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) { setNotice('Escolha uma imagem de até 8 MB.'); return; }
    try { const resized = await resizeAvatar(file); localStorage.setItem('conecta:avatar', resized); setAvatarUrl(resized); if (joined) rtc.updateAvatar(resized); setNotice('Foto de perfil atualizada. Ela aparecerá para quem entrar na sala.'); }
    catch { setNotice('Não foi possível carregar essa imagem.'); }
  };
  const copyProfileCode = async () => {
    try {
      const profile = encodeURIComponent(JSON.stringify({ version: 1, id: getBrowserClientId(), name, avatarUrl }));
      await navigator.clipboard.writeText(btoa(profile));
      setNotice('Código do perfil copiado. Importe este código no outro dispositivo para usar a mesma identidade.');
    } catch { setNotice('Não foi possível copiar o código do perfil. Verifique a permissão da área de transferência.'); }
  };
  const importProfileCode = () => {
    const code = window.prompt('Cole o código do seu perfil. Este dispositivo passará a usar a mesma identidade:');
    if (!code) return;
    try {
      const profile = JSON.parse(decodeURIComponent(atob(code.trim()))) as { version?: number; id?: string; name?: string; avatarUrl?: string };
      if (profile.version !== 1 || typeof profile.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(profile.id) || typeof profile.name !== 'string' || !profile.name.trim()) throw new Error('invalid profile');
      if (joined) leave();
      localStorage.setItem('conecta:participant-id', profile.id);
      localStorage.setItem('conecta:name', profile.name.trim().slice(0, 32));
      if (typeof profile.avatarUrl === 'string' && profile.avatarUrl.length <= 180_000) { localStorage.setItem('conecta:avatar', profile.avatarUrl); setAvatarUrl(profile.avatarUrl); }
      setName(profile.name.trim().slice(0, 32));
      setNotice('Perfil vinculado. Entre na sala novamente; ele aparecerá como uma única identidade nos dispositivos vinculados.');
    } catch { setNotice('Código de perfil inválido. Copie novamente do dispositivo onde seu perfil já está configurado.'); }
  };
  const sendChat = (event: FormEvent) => { event.preventDefault(); if (!chatDraft.trim()) return; rtc.sendMessage(chatDraft); setChatDraft(''); };
  const visibleDirectory = publicRooms.filter((room) => !rooms.some((saved) => saved.id === room.id) && `${room.name} ${room.id}`.toLocaleLowerCase('pt-BR').includes(directorySearch.trim().toLocaleLowerCase('pt-BR')));

  return <div className="app-shell">
    <aside className="rail"><div className="logo">c<span>.</span></div><div className="rail-separator"/><button className="rail-room active" title="Conecta"><Headphones size={21}/></button><button className="rail-add" onClick={openCreate} title="Criar uma sala"><Plus size={22}/></button><div className="rail-bottom"><span className="status-dot"/></div></aside>

    <aside className="channels">
      <div className="workspace-title">Conecta <span>⌄</span></div>
      <div className="channel-caption">MINHAS SALAS <button onClick={openCreate} title="Criar sala">＋</button></div>
      {rooms.map((room) => <div className={`channel-row ${room.id === roomId ? 'selected' : ''}`} key={room.id}><button className={`channel ${room.id === roomId ? 'active' : ''}`} onClick={() => selectRoom(room)}>{room.private ? <Lock size={16}/> : <Volume2 size={17}/>}<span>{room.name}</span><i>{joined && room.id === roomId ? `${visibleParticipants.length + 1}/10` : ''}</i></button><button className={`channel-delete ${room.owned ? 'owned-delete' : ''}`} title={room.owned ? `Apagar ${room.name}` : `Remover ${room.name} da sua lista`} onClick={(event) => deleteRoom(event, room)}>{room.owned ? <Trash2 size={14}/> : <X size={14}/>}</button></div>)}
      <div className="channel-caption public-caption">SALAS PÚBLICAS <span>{publicRooms.length}</span></div>
      <input className="room-search" aria-label="Buscar salas públicas" placeholder="Buscar sala pública..." value={directorySearch} onChange={(event) => setDirectorySearch(event.target.value)}/>
      {visibleDirectory.length ? visibleDirectory.map((room) => <button className="channel directory-channel" key={room.id} onClick={() => selectRoom(room)}><Volume2 size={16}/><span>{room.name}</span><i>{room.count}/{room.capacity}</i></button>) : <div className="directory-empty">{directorySearch.trim() ? 'Nenhuma sala pública encontrada. Para uma sala privada, use o link ou ID e a senha.' : publicRooms.length ? 'Você já adicionou as salas públicas disponíveis.' : 'Nenhuma sala pública criada ainda.'}</div>}
      <div className="channel-hint">Salas privadas só aparecem<br/>para quem recebeu o convite.</div>
      <div className="member-title"><span>PARTICIPANTES — {joined ? visibleParticipants.length + 1 : 0}/10</span></div>
      {joined && <div className={`member ${rtc.speaking && !muted && rtc.microphoneAvailable ? 'speaking' : ''}`}><Avatar name={name} src={avatarUrl} className="self-avatar"/><span className="member-name">{name} <small>você</small></span><span className="member-icons">{muted || !rtc.microphoneAvailable ? <MicOff size={14}/> : <Mic size={14}/>}</span></div>}
      {visibleParticipants.map((person: Participant) => <div className="member" key={person.id}><Avatar name={person.name} src={person.avatarUrl} className="other-avatar"/><span className="member-name">{person.name}</span><span className="member-icons">{person.micMuted && <MicOff size={14}/>}</span></div>)}
      <div className="profile"><button className="profile-avatar-button" title="Escolher imagem de perfil" onClick={() => fileInput.current?.click()}><Avatar name={name} src={avatarUrl} className="self-avatar"/><span className="avatar-edit">+</span></button><input ref={fileInput} className="avatar-file-input" type="file" accept="image/*" onChange={changeAvatar}/><div className="profile-name"><b>{name}</b><small>{joined ? 'Conectado à voz' : 'Disponível'}</small></div><button aria-label="Copiar código do perfil" title="Copiar código deste perfil para vincular outro dispositivo" onClick={() => void copyProfileCode()}><Copy size={15}/></button><button aria-label="Importar código de perfil" title="Vincular este dispositivo a um perfil existente" onClick={importProfileCode}><Link2 size={16}/></button><button title={joined && !rtc.microphoneAvailable ? 'Ativar microfone' : 'Microfone'} onClick={() => void toggleMicrophone()}>{muted || (joined && !rtc.microphoneAvailable) ? <MicOff size={17}/> : <Mic size={17}/>}</button></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">{privateRoom ? <Lock size={16}/> : <Volume2 size={18}/>}<b>{rooms.find((room) => room.id === roomId)?.name || roomId}</b><span className="divider"/><span>{joined ? 'Canal de voz conectado' : privateRoom ? 'Sala privada' : 'Sala de voz'}</span><span className={`connection ${rtc.connected ? 'online' : ''}`}/></div><div className="top-actions"><span className="secure-label">P2P · WebRTC</span><div className="volume-menu"><button className="icon-button" onClick={() => setVolumeOpen((open) => !open)} title="Ajustar volume da sala" aria-label="Ajustar volume da sala" aria-expanded={volumeOpen}>{outputVolume === 0 ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>{volumeOpen && <div className="volume-popover"><label htmlFor="room-output-volume">VOLUME DA SALA</label><input id="room-output-volume" type="range" min="0" max="1" step="0.05" value={outputVolume} onChange={(event) => setOutputVolume(Number(event.target.value))}/><span>{Math.round(outputVolume * 100)}%</span></div>}</div><button className={`chat-toggle ${chatOpen ? 'active' : ''}`} onClick={() => setChatOpen((open) => !open)}><MessageCircle size={16}/> Chat</button><button className="icon-button" onClick={copyInvite} title="Copiar link de convite">{copied ? <Check size={18}/> : <Copy size={18}/>}</button><button className="invite-button" onClick={copyInvite}>Convidar pessoas</button></div></header>
      <div className={`room-layout ${chatOpen ? 'chat-visible' : ''}`}>
        <section className="stage">
          {stageFeeds.length ? <div className={`screen-grid count-${Math.min(stageFeeds.length, 3)}`}>{stageFeeds.map(({ key, stream, kind }) => { const self = key === 'self' || key === 'camera:self'; const peerId = self ? undefined : key.split(':')[0]; const peerName = self ? name : visibleParticipants.find((p) => p.id === peerId)?.name || 'Participante'; const peerAvatar = self ? avatarUrl : visibleParticipants.find((p) => p.id === peerId)?.avatarUrl; return <article className={`screen-card ${kind === 'camera' ? 'camera-card' : ''}`} key={key}><Video stream={stream} muted={self} label={kind === 'screen' ? 'Compartilhamento de tela' : 'Câmera'}/>{kind === 'screen' ? <div className="live-badge"><i/> AO VIVO</div> : <div className="camera-badge"><Camera size={13}/> CÂMERA</div>}<div className="screen-caption"><Avatar name={peerName} src={peerAvatar} className="tiny"/>{peerName}{kind === 'screen' ? ' está transmitindo' : ' · câmera'}</div></article>; })}</div> : <div className="empty-stage"><div className="ambient ambient-one"/><div className="ambient ambient-two"/><div className="stage-icon"><Radio size={27}/></div><p className="eyebrow">{privateRoom ? 'SALA PRIVADA' : 'SALA DE VOZ'}</p><h1>{joined ? 'Sua sala está pronta.' : 'Um espaço para estar junto.'}</h1><p className="stage-copy">{joined ? 'Ative sua voz, câmera ou compartilhe sua tela para começar.' : 'Entre na sala para conversar por voz, texto e compartilhar o que está na sua tela.'}</p>{!joined && <form className="join-form" onSubmit={join}><label>SEU NOME<input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required placeholder="Como podemos te chamar?"/></label><label>ID DA SALA<input value={roomId} onChange={(e) => { setRoomId(e.target.value); const known = rooms.find((room) => room.id === e.target.value); if (known) setPrivateRoom(known.private); }} maxLength={80} required placeholder="Ex.: sala-do-projeto"/></label><label className="private-toggle"><input type="checkbox" checked={privateRoom} onChange={(e) => { setPrivateRoom(e.target.checked); setRoomPassword(''); }}/> <span><b>Exigir senha para entrar</b><small>Só entra quem tiver a senha que você definir.</small></span></label>{privateRoom && <label>SENHA DA SALA<input type="password" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} minLength={6} required autoComplete="current-password" placeholder="Mínimo de 6 caracteres"/></label>}<button className="primary-button" type="submit" disabled={busy}><Headphones size={17}/>{busy ? 'Conectando…' : 'Entrar na sala'}</button></form>}{joined && <div className="waiting-people"><Avatar name={name} src={avatarUrl} className="self-avatar"/><span>Você está aqui. Compartilhe o convite para chamar pessoas.</span></div>}</div>}
          {audioPeers.map(([id, stream]) => <audio key={id} autoPlay ref={(element) => { if (element) { if (element.srcObject !== stream) element.srcObject = stream; element.volume = outputVolume; } }}/>) }
        </section>
        {chatOpen && <aside className="chat-panel"><header className="chat-header"><div><MessageCircle size={17}/><b>Chat da sala</b></div><button onClick={() => setChatOpen(false)} title="Fechar chat"><X size={17}/></button></header><div className="message-list">{joined ? rtc.messages.length ? rtc.messages.map((message: ChatMessage) => <article className={`chat-message ${message.senderId === rtc.selfId ? 'own-message' : ''}`} key={message.id}><Avatar name={message.name} src={message.avatarUrl} className="message-avatar"/><div className="message-content"><div className="message-meta"><b>{message.senderId === rtc.selfId ? 'Você' : message.name}</b><time>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></div></article>) : <div className="chat-empty"><MessageCircle size={22}/><b>Comece a conversa</b><span>As mensagens enviadas aqui ficam visíveis para quem está na sala.</span></div> : <div className="chat-empty"><Lock size={21}/><b>Entre na sala para conversar</b><span>O chat abre junto com a conexão da sala.</span></div>}<div ref={messagesEnd}/></div><form className="chat-compose" onSubmit={sendChat}><input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} maxLength={2000} disabled={!joined} placeholder={joined ? `Mensagem em ${rooms.find((room) => room.id === roomId)?.name || roomId}` : 'Entre na sala para enviar mensagem'}/><button type="submit" disabled={!joined || !chatDraft.trim()} title="Enviar mensagem"><Send size={16}/></button></form></aside>}
      </div>
      <footer className="control-dock">{joined ? <><div className="dock-context"><span className="voice-indicator"><i/><i/><i/><i/><i/></span><span><b>Conectado</b><small>{rooms.find((room) => room.id === roomId)?.name || roomId}</small></span></div><div className="controls"><button className={`control ${muted || !rtc.microphoneAvailable ? 'danger' : ''}`} onClick={() => void toggleMicrophone()}><span>{muted || !rtc.microphoneAvailable ? <MicOff size={19}/> : <Mic size={19}/>}</span><small>{!rtc.microphoneAvailable ? 'Ativar mic' : muted ? 'Ativar mic' : 'Mutar mic'}</small></button><button className={`control ${rtc.cameraEnabled ? 'sharing' : ''}`} onClick={() => rtc.toggleCamera()}><span>{rtc.cameraEnabled ? <CameraOff size={19}/> : <Camera size={19}/>}</span><small>{rtc.cameraEnabled ? 'Parar câmera' : 'Ativar câmera'}</small></button><button className={`control screen-control ${rtc.media.self ? 'sharing' : ''}`} onClick={() => rtc.media.self ? rtc.stopScreen() : rtc.shareScreen()}><span><MonitorUp size={19}/></span><small>{rtc.media.self ? 'Parar tela' : 'Transmitir tela'}</small></button><button className="control leave-control" onClick={leave}><span><PhoneOff size={19}/></span><small>Desconectar</small></button></div><div className="dock-right"><span><Users size={15}/>{visibleParticipants.length + 1}/10</span></div></> : <div className="dock-invite"><span>🔒 &nbsp;Áudio, câmera e tela são transmitidos apenas enquanto você está na sala.</span><button onClick={copyInvite}><Copy size={15}/>{copied ? 'Link copiado' : 'Copiar convite'}</button></div>}</footer>
      {(rtc.error || notice) && <div className="toast" role="status"><span>{rtc.error || notice}</span><button onClick={() => { rtc.setError(''); setNotice(''); }}>×</button></div>}
      {createOpen && <div className="modal-backdrop" role="presentation"><form className="create-room-modal" onSubmit={createRoom}><button className="modal-close" type="button" onClick={() => setCreateOpen(false)} title="Fechar"><X size={18}/></button><div className="modal-icon"><Headphones size={21}/></div><p className="eyebrow">NOVO CANAL</p><h2>Criar sala de voz</h2><p className="modal-copy">Crie um espaço para até 10 pessoas. Neste navegador, o limite é 3 salas públicas e 3 privadas.</p><label>NOME DA SALA<input value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={48} minLength={2} required autoFocus placeholder="Ex.: Resenha da galera"/></label><div className="visibility-picker"><label className={draftPrivate ? '' : 'chosen'}><input type="radio" name="visibility" checked={!draftPrivate} onChange={() => { setDraftPrivate(false); setDraftPassword(''); }}/><Volume2 size={17}/><span><b>Pública</b><small>Aparece na lista para todos.</small></span></label><label className={draftPrivate ? 'chosen' : ''}><input type="radio" name="visibility" checked={draftPrivate} onChange={() => setDraftPrivate(true)}/><Lock size={17}/><span><b>Privada</b><small>Só entra com o convite e a senha.</small></span></label></div>{draftPrivate && <label>SENHA (MÍNIMO 6 CARACTERES)<input type="password" value={draftPassword} onChange={(e) => setDraftPassword(e.target.value)} minLength={6} required autoComplete="new-password" placeholder="Defina uma senha para os convidados"/></label>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar sala'}</button></form></div>}
      {deleteTarget && <div className="modal-backdrop" role="presentation"><form className="create-room-modal" onSubmit={(event) => { event.preventDefault(); void removeOwnedRoom(deleteTarget, deletePassword); }}><button className="modal-close" type="button" onClick={() => { setDeleteTarget(null); setDeletePassword(''); }} title="Cancelar"><X size={18}/></button><div className="modal-icon"><Lock size={20}/></div><p className="eyebrow">CONFIRMAR EXCLUSÃO</p><h2>Apagar sala privada</h2><p className="modal-copy">Para apagar “{deleteTarget.name}”, informe a senha criada para esta sala. O chat e o convite também deixarão de funcionar.</p><label>SENHA DA SALA<input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} required autoComplete="current-password" autoFocus placeholder="Digite a senha da sala"/></label><button className="primary-button delete-confirm-button" type="submit" disabled={deleteBusy}>{deleteBusy ? 'Verificando…' : 'Apagar sala'}</button></form></div>}
    </main>
  </div>;
}
