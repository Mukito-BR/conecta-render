import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Headphones, Lock, Mic, MicOff, MonitorUp, PhoneOff, Radio, Users, Copy, Check, Volume2 } from 'lucide-react';
import { Participant, useWebRTC } from './useWebRTC';

type RoomChannel = { id: string; private: boolean };

function loadRoomState() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'sala-geral';
  let rooms: RoomChannel[] = [];
  try { rooms = JSON.parse(localStorage.getItem('conecta:rooms') || '[]') as RoomChannel[]; } catch { rooms = []; }
  if (!Array.isArray(rooms)) rooms = [];
  const privateRoom = params.get('private') === '1' || Boolean(rooms.find((room) => room.id === roomId)?.private);
  if (!rooms.some((room) => room.id === roomId)) rooms.push({ id: roomId, private: privateRoom });
  else if (params.get('private') === '1') rooms = rooms.map((room) => room.id === roomId ? { ...room, private: true } : room);
  if (rooms.length === 0) rooms.push({ id: 'sala-geral', private: false });
  return { roomId, privateRoom, rooms };
}

function upsertRoom(rooms: RoomChannel[], next: RoomChannel) {
  return rooms.some((room) => room.id === next.id)
    ? rooms.map((room) => room.id === next.id ? next : room)
    : [...rooms, next];
}

function Video({ stream, label, muted = false }: { stream?: MediaStream; label: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream ?? null; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} aria-label={label} />;
}

export default function Room() {
  const [initialRoomState] = useState(loadRoomState);
  const [rooms, setRooms] = useState<RoomChannel[]>(initialRoomState.rooms);
  const [roomId, setRoomId] = useState(initialRoomState.roomId);
  const [privateRoom, setPrivateRoom] = useState(initialRoomState.privateRoom);
  const [roomPassword, setRoomPassword] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('conecta:name') || 'Alex');
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const rtc = useWebRTC();
  const screens = Object.entries(rtc.media).filter(([key]) => key === 'self' || rtc.participants.some((p) => p.sharing && key === `${p.id}:${p.screenStreamId}`));
  const cameras = Object.entries(rtc.media).filter(([key]) => key === 'camera:self' || rtc.participants.some((p) => p.camera && key === `${p.id}:${p.cameraStreamId}`));
  const stageFeeds = [...screens.map(([key, stream]) => ({ key, stream, kind: 'screen' as const })), ...cameras.map(([key, stream]) => ({ key, stream, kind: 'camera' as const }))];
  const audioPeers = Object.entries(rtc.media).filter(([key]) => key !== 'self' && key !== 'camera:self');

  useEffect(() => { localStorage.setItem('conecta:rooms', JSON.stringify(rooms)); }, [rooms]);

  const leave = () => { rtc.disconnect(); setJoined(false); setMuted(false); };
  const createRoom = () => {
    if (joined) leave();
    const next = `sala-${Math.random().toString(36).slice(2, 9)}`;
    setRooms((current) => upsertRoom(current, { id: next, private: false }));
    setRoomId(next); setPrivateRoom(false); setRoomPassword('');
    history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(next)}`);
  };
  const selectRoom = (room: RoomChannel) => {
    if (room.id === roomId) return;
    if (joined) leave();
    setRoomId(room.id); setPrivateRoom(room.private); setRoomPassword('');
    const query = new URLSearchParams({ room: room.id });
    if (room.private) query.set('private', '1');
    history.replaceState(null, '', `${location.pathname}?${query}`);
  };
  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    localStorage.setItem('conecta:name', name);
    const query = new URLSearchParams({ room: roomId });
    if (privateRoom) query.set('private', '1');
    history.replaceState(null, '', `${location.pathname}?${query}`);
    const ok = await rtc.connect(roomId, name, privateRoom ? roomPassword : '');
    if (ok) {
      setJoined(true);
      setRooms((current) => upsertRoom(current, { id: roomId, private: privateRoom }));
    }
  };
  const copyInvite = async () => {
    const query = new URLSearchParams({ room: roomId });
    if (privateRoom) query.set('private', '1');
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}?${query}`);
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };

  return <div className="app-shell">
    <aside className="rail">
      <div className="logo">c<span>.</span></div><div className="rail-separator"/>
      <button className="rail-room active" title="Conecta"><Headphones size={21}/></button>
      <button className="rail-add" onClick={createRoom} title="Criar uma sala">+</button>
      <div className="rail-bottom"><span className="status-dot"/></div>
    </aside>

    <aside className="channels">
      <div className="workspace-title">Conecta <span>⌄</span></div>
      <div className="channel-caption">CANAIS DE VOZ <button onClick={createRoom} title="Criar canal de voz">＋</button></div>
      {rooms.map((room) => <button key={room.id} className={`channel ${room.id === roomId ? 'active' : ''}`} onClick={() => selectRoom(room)}>{room.private ? <Lock size={16}/> : <Volume2 size={17}/>}<span>{room.id}</span><i>{joined && room.id === roomId ? rtc.participants.length + 1 : 0}</i></button>)}
      <div className="channel-hint">Converse e compartilhe sua tela<br/>com quem você convidar.</div>
      <div className="member-title"><span>PARTICIPANTES — {joined ? rtc.participants.length + 1 : 0}</span></div>
      {joined && <div className={`member ${rtc.speaking && !muted ? 'speaking' : ''}`}><span className="avatar self-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="member-name">{name} <small>você</small></span><span className="member-icons">{muted ? <MicOff size={14}/> : <Mic size={14}/>}</span></div>}
      {rtc.participants.map((person: Participant) => <div className="member" key={person.id}><span className="avatar other-avatar">{person.name.slice(0, 1).toUpperCase()}</span><span className="member-name">{person.name}</span><span className="member-icons">{person.micMuted && <MicOff size={14}/>}</span></div>)}
      <div className="profile"><div className="avatar self-avatar">{name.slice(0, 1).toUpperCase()}</div><div><b>{name}</b><small>{joined ? 'Conectado à voz' : 'Disponível'}</small></div><button title="Microfone" onClick={() => setMuted((value) => { const next = !value; if (joined) rtc.toggleMic(); return next; })}>{muted ? <MicOff size={17}/> : <Mic size={17}/>}</button></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">{privateRoom ? <Lock size={16}/> : <Volume2 size={18}/>}<b>{roomId}</b><span className="divider"/><span>{joined ? 'Canal de voz conectado' : privateRoom ? 'Sala privada' : 'Sala de voz'}</span><span className={`connection ${rtc.connected ? 'online' : ''}`}/></div><div className="top-actions"><span className="secure-label">P2P · WebRTC</span><button className="icon-button" onClick={copyInvite} title="Copiar link de convite">{copied ? <Check size={18}/> : <Copy size={18}/>}</button><button className="invite-button" onClick={copyInvite}>Convidar pessoas</button></div></header>
      <section className="stage">
        {stageFeeds.length ? <div className={`screen-grid count-${Math.min(stageFeeds.length, 3)}`}>{stageFeeds.map(({ key, stream, kind }) => { const self = key === 'self' || key === 'camera:self'; const peerId = self ? undefined : key.split(':')[0]; const peerName = self ? name : rtc.participants.find((p) => p.id === peerId)?.name || 'Participante'; return <article className={`screen-card ${kind === 'camera' ? 'camera-card' : ''}`} key={key}><Video stream={stream} muted={self} label={kind === 'screen' ? 'Compartilhamento de tela' : 'Câmera'}/>{kind === 'screen' ? <div className="live-badge"><i/> AO VIVO</div> : <div className="camera-badge"><Camera size={13}/> CÂMERA</div>}<div className="screen-caption"><span className="avatar tiny">{peerName.slice(0, 1).toUpperCase()}</span>{peerName}{kind === 'screen' ? ' está transmitindo' : ' · câmera'}</div></article>; })}</div> : <div className="empty-stage"><div className="ambient ambient-one"/><div className="ambient ambient-two"/><div className="stage-icon"><Radio size={27}/></div><p className="eyebrow">{privateRoom ? 'SALA PRIVADA' : 'SALA DE VOZ'}</p><h1>{joined ? 'Sua sala está pronta.' : 'Um espaço para estar junto.'}</h1><p className="stage-copy">{joined ? 'Ative sua voz, câmera ou compartilhe sua tela para começar.' : 'Crie uma sala para conversar e compartilhar o que está na sua tela.'}</p>{!joined && <form className="join-form" onSubmit={join}><label>SEU NOME<input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required placeholder="Como podemos te chamar?"/></label><label>ID DA SALA<input value={roomId} onChange={(e) => setRoomId(e.target.value)} maxLength={80} required placeholder="Ex.: sala-do-projeto"/></label><label className="private-toggle"><input type="checkbox" checked={privateRoom} onChange={(e) => { setPrivateRoom(e.target.checked); setRoomPassword(''); }}/> <span><b>Exigir senha para entrar</b><small>Só entra quem tiver a senha que você definir.</small></span></label>{privateRoom && <label>SENHA DA SALA<input type="password" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} minLength={6} required autoComplete="new-password" placeholder="Mínimo de 6 caracteres"/></label>}<button className="primary-button" type="submit"><Headphones size={17}/> Entrar na sala</button></form>}{joined && <div className="waiting-people"><div className="avatar self-avatar">{name.slice(0, 1).toUpperCase()}</div><span>Você está aqui. Compartilhe o convite para chamar pessoas.</span></div>}</div>}
        {audioPeers.map(([id, stream]) => <audio key={id} autoPlay ref={(element) => { if (element && element.srcObject !== stream) element.srcObject = stream; }}/>) }
      </section>
      <footer className="control-dock">{joined ? <><div className="dock-context"><span className="voice-indicator"><i/><i/><i/><i/><i/></span><span><b>Conectado</b><small>{roomId}</small></span></div><div className="controls"><button className={`control ${muted ? 'danger' : ''}`} onClick={() => setMuted((value) => { const next = !value; rtc.toggleMic(); return next; })}><span>{muted ? <MicOff size={19}/> : <Mic size={19}/>}</span><small>{muted ? 'Ativar mic' : 'Mutar mic'}</small></button><button className={`control ${rtc.cameraEnabled ? 'sharing' : ''}`} onClick={() => rtc.toggleCamera()}><span>{rtc.cameraEnabled ? <CameraOff size={19}/> : <Camera size={19}/>}</span><small>{rtc.cameraEnabled ? 'Parar câmera' : 'Ativar câmera'}</small></button><button className={`control screen-control ${rtc.media.self ? 'sharing' : ''}`} onClick={() => rtc.media.self ? rtc.stopScreen() : rtc.shareScreen()}><span><MonitorUp size={19}/></span><small>{rtc.media.self ? 'Parar tela' : 'Transmitir tela'}</small></button><button className="control leave-control" onClick={leave}><span><PhoneOff size={19}/></span><small>Desconectar</small></button></div><div className="dock-right"><span><Users size={15}/>{rtc.participants.length + 1}</span></div></> : <div className="dock-invite"><span>🔒 &nbsp;Áudio, câmera e tela são transmitidos apenas enquanto você está na sala.</span><button onClick={copyInvite}><Copy size={15}/>{copied ? 'Link copiado' : 'Copiar convite'}</button></div>}</footer>
      {rtc.error && <div className="toast" role="status"><span>{rtc.error}</span><button onClick={() => rtc.setError('')}>×</button></div>}
    </main>
  </div>;
}
