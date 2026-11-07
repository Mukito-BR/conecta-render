import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export type Participant = { id: string; name: string; micMuted: boolean; sharing: boolean; camera: boolean; screenStreamId?: string; cameraStreamId?: string };
type Signal = { from: string; data: RTCSessionDescriptionInit | RTCIceCandidateInit };
const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3001` : location.origin);
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(import.meta.env.VITE_TURN_URL ? [{ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : []),
  ],
};

export function useWebRTC() {
  const socketRef = useRef<Socket | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const streams = useRef(new Map<string, MediaStream>());
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const endScreenRef = useRef<(() => void) | null>(null);
  const analyserRef = useRef<number | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [media, setMedia] = useState<Record<string, MediaStream>>({});
  const [speaking, setSpeaking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [error, setError] = useState('');

  const upsert = useCallback((person: Participant) => setParticipants((list) => list.some((p) => p.id === person.id) ? list.map((p) => p.id === person.id ? { ...p, ...person } : p) : [...list, person]), []);
  const removePeer = useCallback((id: string) => {
    peers.current.get(id)?.close(); peers.current.delete(id); pendingIce.current.delete(id);
    for (const key of [...streams.current.keys()]) if (key.startsWith(`${id}:`)) streams.current.delete(key);
    setMedia((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${id}:`))));
    setParticipants((list) => list.filter((p) => p.id !== id));
  }, []);

  const makePeer = useCallback((id: string) => {
    const existing = peers.current.get(id); if (existing) return existing;
    const pc = new RTCPeerConnection(rtcConfig); peers.current.set(id, pc);
    const addLocalTracks = () => {
      for (const stream of [localStream.current, screenStream.current, cameraStream.current]) {
        stream?.getTracks().filter((track) => track.readyState === 'live' && !pc.getSenders().some((sender) => sender.track?.id === track.id)).forEach((track) => pc.addTrack(track, stream!));
      }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) socketRef.current?.emit('signal', { to: id, data: candidate.toJSON() }); };
    pc.ontrack = ({ track, streams: remote }) => {
      let stream = remote[0];
      if (!stream) {
        const key = `${id}:fallback`;
        stream = streams.current.get(key) ?? new MediaStream();
        if (!stream.getTracks().some((item) => item.id === track.id)) stream.addTrack(track);
        streams.current.set(key, stream);
      }
      const key = `${id}:${stream.id}`;
      streams.current.set(key, stream); setMedia((current) => ({ ...current, [key]: stream! }));
      track.onended = () => { if (stream && stream.getTracks().every((item) => item.readyState === 'ended')) { streams.current.delete(key); setMedia((current) => { const next = { ...current }; delete next[key]; return next; }); } };
    };
    pc.onnegotiationneeded = async () => {
      try { if (pc.signalingState === 'closed') return; await pc.setLocalDescription(); socketRef.current?.emit('signal', { to: id, data: pc.localDescription }); }
      catch { setError('A renegociação de áudio e vídeo falhou.'); }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removePeer(id); };
    addLocalTracks();
    return pc;
  }, [removePeer]);

  const connect = useCallback(async (roomId: string, name: string, password = '') => {
    setError('');
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      localStream.current = audio;
      const socket = io(SIGNAL_URL); socketRef.current = socket;
      socket.on('user-joined', (person: Participant) => { upsert(person); makePeer(person.id); });
      socket.on('member-updated', upsert);
      socket.on('user-disconnected', ({ id }: { id: string }) => removePeer(id));
      socket.on('signal', async ({ from, data }: Signal) => {
        try {
          const pc = makePeer(from);
          if ('candidate' in data) {
            if (!pc.remoteDescription) pendingIce.current.set(from, [...(pendingIce.current.get(from) ?? []), data as RTCIceCandidateInit]);
            else await pc.addIceCandidate(data as RTCIceCandidateInit).catch(() => undefined);
            return;
          }
          const description = data as RTCSessionDescriptionInit;
          const collision = description.type === 'offer' && pc.signalingState !== 'stable';
          const polite = (socket.id ?? '').localeCompare(from) > 0;
          if (collision && !polite) return;
          if (collision && polite) await pc.setLocalDescription({ type: 'rollback' });
          await pc.setRemoteDescription(description);
          const queued = pendingIce.current.get(from) ?? [];
          pendingIce.current.delete(from);
          for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => undefined);
          if (description.type === 'offer') { await pc.setLocalDescription(); socket.emit('signal', { to: from, data: pc.localDescription }); }
        } catch { setError('Falha na conexão de mídia. Confira a rede e a configuração TURN.'); }
      });
      const joinedRoom = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => {
          setError(`Não conectou ao servidor da sala (${SIGNAL_URL}).`);
          socket.disconnect(); setConnected(false); resolve(false);
        }, 12000);
        socket.once('connect', () => {
          setConnected(true);
          socket.emit('join-room', { roomId, name, password }, (result: { error?: string; participants?: Participant[] }) => {
            window.clearTimeout(timeout);
            if (result.error) { setError(result.error); socket.disconnect(); setConnected(false); resolve(false); return; }
            setParticipants(result.participants ?? []); resolve(true);
          });
        });
        socket.once('connect_error', () => {
          window.clearTimeout(timeout); setError(`Não conectou ao servidor da sala (${SIGNAL_URL}).`);
          socket.disconnect(); setConnected(false); resolve(false);
        });
      });
      if (!joinedRoom) { audio.getTracks().forEach((track) => track.stop()); localStream.current = null; socketRef.current = null; return false; }
      startMeter(audio);
      return true;
    } catch (e) {
      const err = e as DOMException;
      setError(err.name === 'NotAllowedError' ? 'Microfone bloqueado. Permita o acesso nas configurações do navegador e tente novamente.' : err.name === 'NotFoundError' ? 'Nenhum microfone foi encontrado neste computador.' : 'Não foi possível abrir o microfone. Verifique se outro app está usando o dispositivo.');
      return false;
    }
  }, [makePeer, removePeer, upsert]);

  const startMeter = (stream: MediaStream) => {
    try {
      const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser); const values = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => { analyser.getByteFrequencyData(values); const avg = values.reduce((a, b) => a + b, 0) / values.length; setSpeaking(avg > 22); analyserRef.current = requestAnimationFrame(sample); };
      sample();
    } catch { /* Medidor visual é opcional. */ }
  };

  const toggleMic = useCallback(() => {
    const track = localStream.current?.getAudioTracks()[0]; if (!track) return false;
    track.enabled = !track.enabled; socketRef.current?.emit('member-state', { micMuted: !track.enabled }); return !track.enabled;
  }, []);

  const shareScreen = useCallback(async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      screenStream.current = display;
      const video = display.getVideoTracks()[0];
      peers.current.forEach((pc) => display.getTracks().forEach((track) => pc.addTrack(track, display)));
      setMedia((current) => ({ ...current, self: display }));
      socketRef.current?.emit('member-state', { sharing: true, screenStreamId: display.id });
      const endScreen = () => { if (screenStream.current !== display) return; peers.current.forEach((pc) => pc.getSenders().filter((sender) => display.getTracks().some((track) => track.id === sender.track?.id)).forEach((sender) => pc.removeTrack(sender))); display.getTracks().forEach((track) => { if (track.readyState === 'live') track.stop(); }); screenStream.current = null; endScreenRef.current = null; setMedia((current) => { const next = { ...current }; delete next.self; return next; }); socketRef.current?.emit('member-state', { sharing: false, screenStreamId: undefined }); };
      endScreenRef.current = endScreen; video.onended = endScreen;
      return true;
    } catch (e) { setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Compartilhamento cancelado ou não permitido.' : 'Não foi possível iniciar o compartilhamento de tela.'); return false; }
  }, []);
  const stopScreen = useCallback(() => { endScreenRef.current?.(); }, []);

  const toggleCamera = useCallback(async () => {
    if (cameraStream.current) {
      const old = cameraStream.current;
      peers.current.forEach((pc) => pc.getSenders().filter((sender) => old.getTracks().some((track) => track.id === sender.track?.id)).forEach((sender) => pc.removeTrack(sender)));
      old.getTracks().forEach((track) => track.stop()); cameraStream.current = null;
      setMedia((current) => { const next = { ...current }; delete next['camera:self']; return next; }); setCameraEnabled(false);
      socketRef.current?.emit('member-state', { camera: false, cameraStreamId: undefined }); return false;
    }
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
      cameraStream.current = camera; const track = camera.getVideoTracks()[0];
      peers.current.forEach((pc) => pc.addTrack(track, camera));
      setMedia((current) => ({ ...current, 'camera:self': camera })); setCameraEnabled(true);
      socketRef.current?.emit('member-state', { camera: true, cameraStreamId: camera.id });
      track.onended = () => { if (cameraStream.current !== camera) return; cameraStream.current = null; setMedia((current) => { const next = { ...current }; delete next['camera:self']; return next; }); setCameraEnabled(false); socketRef.current?.emit('member-state', { camera: false, cameraStreamId: undefined }); };
      return true;
    } catch (e) { const err = e as DOMException; setError(err.name === 'NotAllowedError' ? 'Câmera bloqueada. Autorize o acesso à câmera no navegador.' : 'Não foi possível abrir a câmera. Verifique se ela está conectada e disponível.'); return false; }
  }, []);

  const disconnect = useCallback(() => {
    if (analyserRef.current !== null) cancelAnimationFrame(analyserRef.current);
    peers.current.forEach((pc) => pc.close()); peers.current.clear(); pendingIce.current.clear(); streams.current.clear();
    [localStream.current, screenStream.current, cameraStream.current].forEach((stream) => stream?.getTracks().forEach((track) => track.stop()));
    localStream.current = null; screenStream.current = null; cameraStream.current = null; endScreenRef.current = null;
    socketRef.current?.disconnect(); socketRef.current = null;
    setParticipants([]); setMedia({}); setConnected(false); setSpeaking(false); setCameraEnabled(false);
  }, []);

  useEffect(() => () => { socketRef.current?.disconnect(); peers.current.forEach((pc) => pc.close()); [localStream.current, screenStream.current, cameraStream.current].forEach((stream) => stream?.getTracks().forEach((track) => track.stop())); if (analyserRef.current !== null) cancelAnimationFrame(analyserRef.current); }, []);
  return { participants, media, speaking, connected, cameraEnabled, error, setError, connect, toggleMic, toggleCamera, shareScreen, stopScreen, disconnect };
}
