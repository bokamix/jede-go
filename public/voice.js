// Czat głosowy: WebRTC peer-to-peer (siatka), push-to-talk, wszyscy słyszą wszystkich.
// Sygnalizacja leci przez istniejący WebSocket gry (wiadomości 'rtc').

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

export function createVoice({ send, myId, onError }) {
  const peers = new Map();     // id -> { pc, audio, pending: [] }
  const talking = new Set();   // id graczy, którzy właśnie mówią
  let mic = null;              // MediaStreamTrack
  let volume = 1;
  let pushing = false;
  const retryAt = new Map();   // id -> czas, po którym można ponowić nieudane połączenie

  async function initMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mic = stream.getAudioTracks()[0];
      mic.enabled = pushing;
      for (const peer of peers.values()) attachMic(peer);
    } catch (e) {
      onError?.(window.isSecureContext ? 'Brak dostępu do mikrofonu – możesz tylko słuchać' : 'Mikrofon wymaga HTTPS lub localhost – możesz tylko słuchać');
    }
  }

  function attachMic(peer) {
    if (!mic) return;
    const tr = peer.pc.getTransceivers()[0];
    if (!tr) return;
    tr.direction = 'sendrecv';
    tr.sender.replaceTrack(mic).catch(() => {});
  }

  function createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, audio: new Audio(), pending: [] };
    peer.audio.autoplay = true;
    peer.audio.volume = volume;
    pc.onicecandidate = e => { if (e.candidate) send({ t: 'rtc', to: id, data: { cand: e.candidate } }); };
    pc.ontrack = e => {
      peer.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      peer.audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { retryAt.set(id, Date.now() + 10000); close(id); }
    };
    peers.set(id, peer);
    return peer;
  }

  async function makeOffer(id) {
    const peer = createPeer(id);
    peer.pc.addTransceiver('audio', { direction: mic ? 'sendrecv' : 'recvonly' });
    attachMic(peer);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    send({ t: 'rtc', to: id, data: { sdp: peer.pc.localDescription } });
  }

  async function onSignal(from, data) {
    let peer = peers.get(from);
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (peer) close(from);
        peer = createPeer(from);
        await peer.pc.setRemoteDescription(data.sdp);
        attachMic(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        send({ t: 'rtc', to: from, data: { sdp: peer.pc.localDescription } });
      } else if (peer) {
        await peer.pc.setRemoteDescription(data.sdp);
      }
      if (peer) { for (const c of peer.pending) peer.pc.addIceCandidate(c).catch(() => {}); peer.pending = []; }
    } else if (data.cand && peer) {
      if (peer.pc.remoteDescription) peer.pc.addIceCandidate(data.cand).catch(() => {});
      else peer.pending.push(data.cand);
    }
  }

  function close(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    peers.delete(id);
    talking.delete(id);
  }

  return {
    talking,
    initMic,
    // wołane przy każdym snapshocie z listą id obecnych graczy
    sync(ids) {
      const me = myId();
      for (const id of ids) {
        // połączenie inicjuje gracz o mniejszym id, żeby nie było kolizji ofert
        if (id !== me && !peers.has(id) && me < id && Date.now() >= (retryAt.get(id) || 0)) makeOffer(id).catch(() => close(id));
      }
      for (const id of [...peers.keys()]) if (!ids.includes(id)) close(id);
    },
    signal(from, data) { onSignal(from, data).catch(() => {}); },
    setTalking(id, on) { if (on) talking.add(id); else talking.delete(id); },
    push(on) {
      if (pushing === on) return;
      pushing = on;
      if (mic) mic.enabled = on;
      send({ t: 'talk', on });
    },
    get hasMic() { return !!mic; },
    setVolume(v) { volume = v; for (const p of peers.values()) p.audio.volume = v; },
  };
}
