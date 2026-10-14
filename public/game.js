import * as THREE from 'three';
import {
  MAP, WEAPONS, ITEMS, BUY, PLAYER, ROUND, traceMap, traceShot, siteAt,
} from './shared.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ================================================================ renderer / scena
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e4);
scene.fog = new THREE.Fog(0x9cc4e4, 70, 190);
const BASE_FOV = 80;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 400);
camera.rotation.order = 'YXZ';

const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
vmScene.add(new THREE.AmbientLight(0xffffff, 1.2));
const vmSun = new THREE.DirectionalLight(0xfff0d0, 2.2); vmSun.position.set(1, 2, 1); vmScene.add(vmSun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = vmCam.aspect = w / h;
  camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x8a6a40, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
sun.position.set(35, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 180 });
sun.shadow.bias = -0.0006;
scene.add(sun);
const flashLight = new THREE.PointLight(0xffc070, 0, 9, 2);
scene.add(flashLight);

// ---------------------------------------------------------------- tekstury
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function speckle(g, s, base, amt, n) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const v = Math.random() - 0.5;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v * amt})` : `rgba(0,0,0,${-v * amt})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function bricks(g, s, color, bh, bw) {
  g.strokeStyle = color; g.lineWidth = 2;
  for (let y = 0; y < s; y += bh) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
    const off = (y / bh) % 2 ? bw / 2 : 0;
    for (let x = off; x < s; x += bw) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + bh); g.stroke(); }
  }
}
const texSand = canvasTex(256, (g, s) => { speckle(g, s, '#c8a66a', 0.22, 12000); g.strokeStyle = 'rgba(90,60,20,.10)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s); });
const texWall = canvasTex(256, (g, s) => { speckle(g, s, '#dcc697', 0.16, 7000); bricks(g, s, 'rgba(110,80,40,.28)', 64, 128); });
const texStone = canvasTex(256, (g, s) => { speckle(g, s, '#a59882', 0.2, 7000); bricks(g, s, 'rgba(50,40,30,.35)', 32, 64); });
const texCrate = canvasTex(128, (g, s) => {
  g.fillStyle = '#a06c36'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(60,30,0,${Math.random() * 0.15})`; g.fillRect(Math.random() * s, Math.random() * s, 8, 1); }
  g.strokeStyle = 'rgba(60,35,10,.5)'; g.lineWidth = 1;
  for (let y = 16; y < s; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  g.strokeStyle = '#6a4219'; g.lineWidth = 12; g.strokeRect(6, 6, s - 12, s - 12);
  g.lineWidth = 10; g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
}, false);

// ---------------------------------------------------------------- mapa
const MATS = {
  wall: new THREE.MeshLambertMaterial({ map: texWall }),
  stone: new THREE.MeshLambertMaterial({ map: texStone }),
  crate: new THREE.MeshLambertMaterial({ map: texCrate }),
};
function boxGeo(b, worldUV, scale) {
  const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(b.min[0] + sx / 2, b.min[1] + sy / 2, b.min[2] + sz / 2);
  if (worldUV) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let u, v;
      if (Math.abs(n.getY(i)) > 0.5) { u = x; v = z; }
      else if (Math.abs(n.getX(i)) > 0.5) { u = z; v = y; }
      else { u = x; v = y; }
      uv.setXY(i, u / scale, v / scale);
    }
  }
  return g;
}
for (const b of MAP.boxes) {
  const m = new THREE.Mesh(boxGeo(b, b.type !== 'crate', b.type === 'stone' ? 3 : 4), MATS[b.type]);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
{
  const size = (MAP.size + 2) * 2;
  texSand.repeat.set(size / 4, size / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: texSand }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  for (const [k, s] of Object.entries(MAP.sites)) {
    const tex = canvasTex(256, (g, n) => {
      g.clearRect(0, 0, n, n);
      g.strokeStyle = 'rgba(200,30,20,.75)'; g.lineWidth = 10; g.strokeRect(10, 10, n - 20, n - 20);
      g.fillStyle = 'rgba(200,30,20,.8)'; g.font = 'bold 170px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(k, n / 2, n / 2 + 8);
    }, false);
    const sz = 7;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((s.x1 + s.x2) / 2, 0.02, (s.z1 + s.z2) / 2 + 4);
    m.receiveShadow = true;
    scene.add(m);
  }
}

// ================================================================ audio
let actx = null, master = null, noiseBuf = null, volume = Number(store.get('vol', 0.5));
function audio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = volume; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function out(pos) {
  if (!pos) return master;
  const p = actx.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 200;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
  else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(master);
  return p;
}
function noise(dst, t, dur, vol, type, freq, q = 0.8) {
  const a = actx, src = a.createBufferSource(); src.buffer = noiseBuf;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(dst);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}
function tone(dst, t, dur, vol, type, f0, f1) {
  const a = actx, o = a.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dst); o.start(t); o.stop(t + dur + 0.05);
}
const SND = {
  shot(w, pos) {
    audio(); const t = actx.currentTime, d = out(pos);
    if (w === 'knife') return noise(d, t, 0.15, 0.4, 'highpass', 2500);
    const def = WEAPONS[w];
    if (w === 'awp') { noise(d, t, 0.9, 1.4, 'lowpass', 1600); tone(d, t, 0.3, 1, 'sine', 120, 35); return; }
    const pistol = def.slot === 2;
    noise(d, t, pistol ? 0.18 : 0.26, 1.0, 'lowpass', w === 'deagle' ? 2000 : pistol ? 3800 : w === 'ak47' ? 2300 : 2900);
    noise(d, t, 0.05, 0.6, 'highpass', 4000);
    tone(d, t, 0.14, 0.7, 'sine', w === 'deagle' ? 110 : 160, 40);
  },
  step(pos, vol = 0.35) { audio(); noise(out(pos), actx.currentTime, 0.09, vol, 'lowpass', 380 + Math.random() * 200); },
  land() { audio(); noise(master, actx.currentTime, 0.12, 0.4, 'lowpass', 300); },
  hit(hs) { audio(); const t = actx.currentTime; if (hs) { tone(master, t, 0.25, 0.35, 'sine', 2100); tone(master, t, 0.06, 0.2, 'square', 3000); } else tone(master, t, 0.06, 0.25, 'triangle', 1300); },
  hurt() { audio(); noise(master, actx.currentTime, 0.15, 0.6, 'bandpass', 900, 2); },
  click() { audio(); tone(master, actx.currentTime, 0.03, 0.25, 'square', 2200); },
  reload() { audio(); const t = actx.currentTime; noise(master, t, 0.06, 0.5, 'bandpass', 1800, 3); noise(master, t + 0.5, 0.06, 0.5, 'bandpass', 1400, 3); },
  draw() { audio(); noise(master, actx.currentTime, 0.08, 0.3, 'bandpass', 2600, 4); },
  beep(pos) { audio(); tone(out(pos), actx.currentTime, 0.1, 0.5, 'sine', 1650); },
  buy() { audio(); tone(master, actx.currentTime, 0.08, 0.25, 'sine', 900); },
  explode(pos) { audio(); const t = actx.currentTime, d = out(pos); noise(d, t, 2.8, 3, 'lowpass', 500); tone(d, t, 1.2, 2, 'sine', 80, 25); },
};
function say(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.05; u.pitch = 0.8; u.volume = Math.min(1, volume * 1.6);
    speechSynthesis.speak(u);
  } catch {}
}

// ================================================================ modele
const lam = c => new THREE.MeshLambertMaterial({ color: c });
function bx(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function rot(m, x = 0, y = 0, z = 0) { m.rotation.set(x, y, z); return m; }
function cyl(r, len, mat, x, y, z) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m; }

const M = {
  metal: lam(0x2b2b2e), dark: lam(0x18181a), wood: lam(0x7a4a22), olive: lam(0x4a5a3a), blade: lam(0xc9cfd6),
  skin: lam(0xd9a98a), gloveT: lam(0x5b4630), gloveCT: lam(0x1f2a3b), tan: lam(0x9b8a6a),
};

// model broni (lokalnie oś -Z to przód lufy); zwraca grupę z userData.muzzle
function gunModel(key, hands, team) {
  const g = new THREE.Group();
  let muzzle = -0.4;
  switch (key) {
    case 'knife':
      g.add(bx(0.035, 0.04, 0.12, M.dark, 0, 0, 0.02));
      g.add(bx(0.012, 0.05, 0.2, M.blade, 0, 0.01, -0.14));
      muzzle = -0.25; break;
    case 'glock': case 'usp': case 'deagle': {
      const big = key === 'deagle', len = big ? 0.26 : key === 'usp' ? 0.24 : 0.2;
      g.add(bx(0.045, 0.05, len, big ? M.blade : M.metal, 0, 0.03, -len / 2 + 0.05));
      g.add(rot(bx(0.04, 0.11, 0.05, M.dark, 0, -0.04, 0.03), 0.25));
      if (key === 'usp') g.add(cyl(0.017, 0.12, M.dark, 0, 0.03, -len + 0.0));
      muzzle = key === 'usp' ? -len - 0.06 : -len + 0.05; break;
    }
    case 'mac10': case 'mp9':
      g.add(bx(0.06, 0.09, 0.26, M.metal, 0, 0.02, -0.08));
      g.add(bx(0.035, 0.16, 0.04, M.dark, 0, -0.08, 0.0));
      g.add(cyl(0.015, 0.1, M.dark, 0, 0.04, -0.26));
      if (key === 'mp9') g.add(bx(0.03, 0.03, 0.18, M.dark, 0, 0.0, 0.12));
      muzzle = -0.32; break;
    case 'ak47':
      g.add(bx(0.06, 0.08, 0.42, M.metal, 0, 0.02, -0.12));
      g.add(bx(0.055, 0.06, 0.2, M.wood, 0, 0.0, -0.33));
      g.add(cyl(0.013, 0.32, M.dark, 0, 0.035, -0.5));
      g.add(bx(0.05, 0.08, 0.25, M.wood, 0, -0.02, 0.2));
      g.add(rot(bx(0.04, 0.17, 0.06, M.metal, 0, -0.1, -0.12), -0.35));
      g.add(rot(bx(0.04, 0.1, 0.04, M.wood, 0, -0.06, 0.03), 0.3));
      muzzle = -0.66; break;
    case 'm4a4':
      g.add(bx(0.06, 0.09, 0.42, M.metal, 0, 0.02, -0.1));
      g.add(bx(0.06, 0.07, 0.24, M.dark, 0, 0.01, -0.4));
      g.add(cyl(0.013, 0.3, M.dark, 0, 0.03, -0.62));
      g.add(bx(0.05, 0.08, 0.24, M.dark, 0, -0.01, 0.22));
      g.add(bx(0.02, 0.04, 0.16, M.dark, 0, 0.09, -0.1));
      g.add(bx(0.04, 0.15, 0.06, M.metal, 0, -0.1, -0.1));
      g.add(rot(bx(0.04, 0.1, 0.04, M.dark, 0, -0.06, 0.04), 0.3));
      muzzle = -0.78; break;
    case 'awp':
      g.add(bx(0.07, 0.1, 0.6, M.olive, 0, 0.01, -0.05));
      g.add(cyl(0.016, 0.5, M.dark, 0, 0.03, -0.6));
      g.add(cyl(0.035, 0.3, M.dark, 0, 0.11, -0.1));
      g.add(bx(0.06, 0.12, 0.22, M.olive, 0, -0.03, 0.33));
      g.add(bx(0.04, 0.08, 0.08, M.dark, 0, -0.08, -0.08));
      muzzle = -0.86; break;
  }
  if (hands) {
    const glove = team === 'CT' ? M.gloveCT : M.gloveT;
    g.add(bx(0.07, 0.07, 0.1, glove, 0.005, -0.06, 0.06));
    g.add(bx(0.08, 0.08, 0.35, glove, 0.03, -0.09, 0.28));
    if (WEAPONS[key].slot === 1) {
      g.add(bx(0.07, 0.06, 0.09, glove, -0.02, -0.04, -0.3));
      g.add(rot(bx(0.08, 0.08, 0.4, glove, -0.12, -0.12, -0.08), 0, -0.6));
    }
  }
  g.userData.muzzle = muzzle;
  return g;
}

function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 24);
  g.fillStyle = color; g.fillText(text, 128, 24);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1); s.renderOrder = 10;
  return s;
}

function playerModel(team) {
  const T = team === 'T';
  const cloth = lam(T ? 0xa07a42 : 0x3b5b88), pants = lam(T ? 0x5f4a30 : 0x253650), vest = lam(T ? 0x6e5a3a : 0x2a3a52);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, 0.8, 0); legR.position.set(0.13, 0.8, 0);
  legL.add(bx(0.22, 0.8, 0.24, pants, 0, -0.4, 0)); legR.add(bx(0.22, 0.8, 0.24, pants, 0, -0.4, 0));
  legL.add(bx(0.23, 0.12, 0.3, M.dark, 0, -0.75, -0.04)); legR.add(bx(0.23, 0.12, 0.3, M.dark, 0, -0.75, -0.04));
  body.add(legL, legR);
  body.add(bx(0.6, 0.62, 0.34, cloth, 0, 1.09, 0));
  body.add(bx(0.62, 0.4, 0.38, vest, 0, 1.15, 0));
  const head = new THREE.Group(); head.position.set(0, 1.4, 0); body.add(head);
  head.add(bx(0.36, 0.38, 0.36, M.skin, 0, 0.19, 0));
  if (T) head.add(bx(0.38, 0.22, 0.38, lam(0x2a2a2a), 0, 0.22, 0)), head.add(bx(0.38, 0.06, 0.39, lam(0x111111), 0, 0.26, -0.005));
  else head.add(bx(0.4, 0.16, 0.4, lam(0x283548), 0, 0.33, 0)), head.add(bx(0.3, 0.08, 0.05, lam(0x111111), 0, 0.22, -0.19));
  const arms = new THREE.Group(); arms.position.set(0, 1.32, 0); body.add(arms);
  arms.add(rot(bx(0.13, 0.13, 0.5, cloth, -0.3, -0.05, -0.18), 0, 0.35));
  arms.add(rot(bx(0.13, 0.13, 0.5, cloth, 0.3, -0.05, -0.18), 0, -0.35));
  const gunHolder = new THREE.Group(); gunHolder.position.set(0.05, -0.05, -0.45); arms.add(gunHolder);
  const bomb = bx(0.3, 0.22, 0.14, lam(0x4a3a2a), 0, 1.15, 0.24); bomb.visible = false; body.add(bomb);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, body, legL, legR, head, arms, gunHolder, bomb };
}

// ================================================================ efekty
const fx = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 });
function addTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(geo, tracerMat.clone()); scene.add(l);
  fx.push({ obj: l, life: 0.07, max: 0.07, fade: true });
}
const decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
const decals = [];
const partGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
const bloodMat = new THREE.MeshBasicMaterial({ color: 0xa01010 }), dustMat = new THREE.MeshBasicMaterial({ color: 0xd8c8a0 });
function addImpact(p, axis, dir, blood) {
  const partMat = blood ? bloodMat : dustMat;
  for (let i = 0; i < (blood ? 10 : 6); i++) {
    const m = new THREE.Mesh(partGeo, partMat);
    m.position.copy(p); scene.add(m);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(blood ? 3 : 4);
    if (!blood) v.addScaledVector(dir, -2);
    fx.push({ obj: m, life: 0.35, max: 0.35, vel: v });
  }
  if (!blood && axis >= 0) {
    const n = new THREE.Vector3(); n.setComponent(axis, -Math.sign(dir.getComponent(axis)) || 1);
    const d = new THREE.Mesh(decalGeo, decalMat);
    d.position.copy(p).addScaledVector(n, 0.005);
    d.lookAt(d.position.clone().add(n));
    scene.add(d); decals.push(d);
    if (decals.length > 150) scene.remove(decals.shift());
  }
}
const flashTex = canvasTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,80,.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, false);
function addFlashSprite(parentScene, pos, size, life = 0.05) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.copy(pos); s.scale.setScalar(size); s.material.rotation = Math.random() * 6;
  parentScene.add(s);
  fx.push({ obj: s, life, max: life, scene: parentScene });
}
let lightTimer = 0;
function worldFlash(pos) { flashLight.position.copy(pos); flashLight.intensity = 6; lightTimer = 0.05; }
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    if (f.vel) { f.vel.y -= 12 * dt; f.obj.position.addScaledVector(f.vel, dt); }
    if (f.grow) { f.obj.scale.addScalar(f.grow * dt); f.obj.material.opacity = Math.max(0, f.life / f.max); }
    if (f.fade) f.obj.material.opacity = 0.8 * f.life / f.max;
    if (f.life <= 0) {
      (f.scene || scene).remove(f.obj);
      if (f.obj.isLine) f.obj.geometry.dispose();
      fx.splice(i, 1);
    }
  }
  if (lightTimer > 0) { lightTimer -= dt; if (lightTimer <= 0) flashLight.intensity = 0; }
}

// ================================================================ stan
const me = {
  id: 0, team: null, joined: false, alive: false,
  pos: new THREE.Vector3(0, 0, 40), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  onGround: true, crouch: false, crouchAmt: 0,
  weapon: 'knife', lastWeapon: 'knife', inv: { 1: null, 2: null, 3: 'knife' },
  ammo: {}, nextShot: 0, reloadEnd: 0, recoil: 0, recoilYaw: 0, shotsFired: 0, lastShotT: 0,
  scope: 0, stepAcc: 0, money: 0, hp: 100, armor: 0, kit: false,
  specId: 0, punch: 0,
};
const remotes = new Map();   // id -> {data, model, ...}
let game = { ph: 'warmup', tl: -1, sc: { T: 0, CT: 0 }, rn: 0, b: null, bt: 0, p: [] };
let snapTime = 0;
let mouseDown = false, rightDown = false;
const keys = {};
let sens = Number(store.get('sens', 1));
const ui = { buy: false, chat: false, tab: false };

const fullAmmo = w => ({ mag: WEAPONS[w].mag ?? 0, res: WEAPONS[w].res ?? 0 });
function playerName(id) { const p = game.p.find(q => q.i === id); return p ? p.n : '?'; }
function playerData(id) { return game.p.find(q => q.i === id); }

// ================================================================ viewmodel
let vm = null, vmKey = null;
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);
const vmState = { kick: 0, drawT: 0, bobT: 0, swing: 0 };
function setViewModel(key) {
  if (vmKey === key && vm) return;
  if (vm) vmRoot.remove(vm);
  vm = gunModel(key, true, me.team); vmKey = key;
  vm.scale.setScalar(0.75);
  vmRoot.add(vm);
  vmState.drawT = 1;
}

function switchWeapon(w) {
  if (!w || w === me.weapon || !me.inv[WEAPONS[w].slot] || me.inv[WEAPONS[w].slot] !== w) return;
  me.lastWeapon = me.weapon;
  me.weapon = w;
  me.reloadEnd = 0; me.scope = 0;
  me.nextShot = Math.max(me.nextShot, performance.now() / 1000 + (w === 'knife' ? 0.25 : 0.5));
  setViewModel(w);
  SND.draw();
}
function bestWeapon() { return me.inv[1] || me.inv[2] || 'knife'; }

// ================================================================ sieć
let ws = null;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => { $('status').textContent = 'Połączono. Wybierz drużynę.'; };
  ws.onclose = () => {
    $('status').textContent = 'Rozłączono z serwerem – odśwież stronę.';
    showCenter('Rozłączono z serwerem', 'Odśwież stronę (F5)', 999);
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
}
function net(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function handle(m) {
  switch (m.t) {
    case 'hello':
      $('status').textContent = `Połączono. Graczy na serwerze: ${m.players}. Wybierz drużynę.`;
      if (m.urls.length) {
        const html = 'Znajomi w tej samej sieci wchodzą na: ' + m.urls.map(u => `<b>${u}</b>`).join(', ');
        $('urls').innerHTML = html; $('urls2').innerHTML = html;
      }
      break;
    case 'joined':
      me.id = m.id; me.team = m.team; me.joined = true;
      $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
      lock();
      break;
    case 'snap': onSnap(m); break;
    case 'spawn': {
      me.alive = true;
      me.pos.set(m.x, m.y, m.z); me.vel.set(0, 0, 0); me.yaw = m.yaw; me.pitch = 0;
      me.crouch = false; me.recoil = 0; me.scope = 0; me.reloadEnd = 0;
      const mine = playerData(me.id);
      // stan broni nadpisze najbliższy snapshot – ustawiamy domyślne
      for (const w of Object.keys(WEAPONS)) me.ammo[w] = fullAmmo(w);
      vmKey = null;
      me.pendingSpawn = true;
      if (mine) syncInventory(mine, true);
      break;
    }
    case 'give':
      me.ammo[m.w] = fullAmmo(m.w);
      me.inv[WEAPONS[m.w].slot] = m.w;
      switchWeapon(m.w);
      SND.buy();
      break;
    case 'shot': onRemoteShot(m); break;
    case 'hitmark': {
      const h = $('hitmarker'); h.classList.toggle('hs', m.hs); h.style.opacity = 1;
      clearTimeout(h._t); h._t = setTimeout(() => h.style.opacity = 0, 120);
      SND.hit(m.hs);
      break;
    }
    case 'dmg': {
      me.hp = m.hp;
      const f = $('dmgflash'); f.style.transition = 'none'; f.style.opacity = 1;
      requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; });
      me.punch = 0.04;
      SND.hurt();
      break;
    }
    case 'kill': onKill(m); break;
    case 'roundStart':
      showCenter(`Runda ${m.round}`, 'Czas na zakupy – B', 2.5);
      break;
    case 'go':
      showCenter('', '', 0); SND.click(); say("Let's go!");
      break;
    case 'roundEnd': {
      const txt = m.winner === 'T' ? 'Terroryści wygrywają' : 'Antyterroryści wygrywają';
      const why = { elim: 'Eliminacja przeciwników', time: 'Skończył się czas', bomb: 'Bomba wybuchła', defuse: 'Bomba rozbrojona' }[m.reason];
      showCenter(txt, why, 4.5, m.winner);
      if (m.reason !== 'defuse') say(m.winner === 'T' ? 'Terrorists win' : 'Counter-terrorists win');
      else setTimeout(() => say('Counter-terrorists win'), 1600);
      break;
    }
    case 'matchEnd':
      setTimeout(() => showCenter(`KONIEC MECZU – ${m.winner === 'T' ? 'Terroryści' : 'Antyterroryści'} wygrywają!`, `${m.score.T} : ${m.score.CT}`, 9, m.winner), 1200);
      break;
    case 'planted':
      showCenter('Bomba podłożona!', `Bombsite ${m.site} – ${m.name}`, 3);
      say('Bomb has been planted');
      bombBeep = 0;
      break;
    case 'defused':
      say('Bomb has been defused');
      break;
    case 'explode': {
      const p = new THREE.Vector3(m.x, m.y + 1, m.z);
      SND.explode(p);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.position.copy(p); s.scale.setScalar(4); scene.add(s);
      fx.push({ obj: s, life: 1.2, max: 1.2, grow: 30 });
      flashLight.position.copy(p); flashLight.intensity = 400; flashLight.distance = 80; lightTimer = 0.4;
      setTimeout(() => { flashLight.distance = 9; }, 450);
      const d = camera.position.distanceTo(p);
      shake = Math.max(shake, clamp(1.5 - d / 40, 0.1, 1.5));
      if (d < 30) { const w = $('flashwhite'); w.style.transition = 'none'; w.style.opacity = clamp(1 - d / 30, 0, 0.9); requestAnimationFrame(() => { w.style.transition = 'opacity 1.4s'; w.style.opacity = 0; }); }
      break;
    }
    case 'msg': if (m.big) showCenter(m.text, '', 3); else addChat(null, m.text); break;
    case 'chat': addChat(m, m.text); break;
    case 'left': {
      addChat(null, m.text);
      const r = remotes.get(m.id); if (r) { scene.remove(r.model.root); remotes.delete(m.id); }
      break;
    }
  }
}

function syncInventory(mine, force) {
  const prevPrim = me.inv[1], prevSec = me.inv[2];
  me.inv[1] = mine.pr; me.inv[2] = mine.se;
  if (mine.pr && mine.pr !== prevPrim && !me.ammo[mine.pr]) me.ammo[mine.pr] = fullAmmo(mine.pr);
  if (mine.se && mine.se !== prevSec && !me.ammo[mine.se]) me.ammo[mine.se] = fullAmmo(mine.se);
  if (force || (me.weapon !== 'knife' && me.inv[WEAPONS[me.weapon].slot] !== me.weapon)) {
    me.weapon = bestWeapon(); me.scope = 0;
    setViewModel(me.weapon);
  }
}

function onSnap(m) {
  game = m; snapTime = performance.now();
  const seen = new Set();
  for (const p of m.p) {
    if (p.i === me.id) {
      if (me.team !== p.t) { me.team = p.t; vmKey = null; setViewModel(me.weapon); }
      me.money = p.m; me.hp = p.hp; me.armor = p.ar; me.kit = p.kit;
      if (!p.a && me.alive) me.alive = false;
      if (me.pendingSpawn) { me.pendingSpawn = false; syncInventory(p, true); }
      else syncInventory(p, false);
      continue;
    }
    seen.add(p.i);
    let r = remotes.get(p.i);
    if (!r || r.team !== p.t) {
      if (r) scene.remove(r.model.root);
      const model = playerModel(p.t);
      scene.add(model.root);
      r = { team: p.t, model, pos: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yw, pitch: p.pt, alive: p.a, deadT: p.a ? 0 : 1, gunKey: null, tag: null, name: null, speed: 0, step: 0, crouch: 0 };
      remotes.set(p.i, r);
    }
    const dx = p.x - r.target.x, dz = p.z - r.target.z;
    r.speed = r.speed * 0.5 + Math.hypot(dx, dz) / 0.05 * 0.5;
    if (p.a && !r.alive) { r.pos.set(p.x, p.y, p.z); r.deadT = 0; r.yaw = p.yw; r.speed = 0; }
    r.target.set(p.x, p.y, p.z);
    r.tyaw = p.yw; r.tpitch = p.pt; r.alive = p.a; r.crouchT = p.c ? 1 : 0;
    r.data = p;
    if (r.gunKey !== p.w) {
      r.model.gunHolder.clear();
      const g = gunModel(p.w, false); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      r.model.gunHolder.add(g); r.gunKey = p.w; r.muzzle = g.userData.muzzle;
    }
    if (r.name !== p.n || r.tagTeam !== me.team) {
      if (r.tag) r.model.root.remove(r.tag);
      r.tag = nameSprite(p.n, p.t === 'T' ? '#ffcf80' : '#a8ccff');
      r.tag.position.y = 2.15; r.model.root.add(r.tag);
      r.name = p.n; r.tagTeam = me.team;
    }
    r.tag.visible = p.t === me.team && p.a;
    r.model.bomb.visible = !!(m.b && m.b.s === 'carried' && m.b.c === p.i && me.team === 'T');
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { scene.remove(r.model.root); remotes.delete(id); }
  updateBombModel();
}

// ---------------------------------------------------------------- bomba w świecie
const bombModel = new THREE.Group();
bombModel.add(bx(0.4, 0.14, 0.26, lam(0x4a3a2a), 0, 0.07, 0));
bombModel.add(bx(0.18, 0.02, 0.12, lam(0x1a1a1a), 0.05, 0.15, 0));
const bombLed = bx(0.04, 0.03, 0.04, new THREE.MeshBasicMaterial({ color: 0xff2020 }), -0.12, 0.16, 0);
bombModel.add(bombLed);
bombModel.visible = false; scene.add(bombModel);
let bombBeep = 0;
function updateBombModel() {
  const b = game.b;
  bombModel.visible = !!(b && (b.s === 'dropped' || b.s === 'planted' || b.s === 'defused'));
  if (bombModel.visible) bombModel.position.set(b.x, b.y, b.z);
}

// ---------------------------------------------------------------- zdarzenia
function remoteMuzzle(r) {
  const p = r.pos.clone(); p.y += (r.data?.c ? PLAYER.ceye : PLAYER.eye) - 0.3;
  const fwd = new THREE.Vector3(-Math.sin(r.yaw), 0, -Math.cos(r.yaw));
  const right = new THREE.Vector3(Math.cos(r.yaw), 0, -Math.sin(r.yaw));
  return p.addScaledVector(fwd, 0.5 - (r.muzzle || -0.4)).addScaledVector(right, 0.05);
}
function onRemoteShot(m) {
  const r = remotes.get(m.id);
  const end = new THREE.Vector3(...m.e);
  const start = r ? remoteMuzzle(r) : new THREE.Vector3(...m.o);
  SND.shot(m.w, start);
  if (m.w === 'knife') return;
  addFlashSprite(scene, start, 0.6);
  worldFlash(start);
  addTracer(start, end);
  const dir = end.clone().sub(new THREE.Vector3(...m.o)).normalize();
  if (m.h) addImpact(end, -1, dir, true);
  else addImpact(end, m.ax, dir, false);
}

function onKill(m) {
  const feed = $('killfeed');
  const k = m.k ? playerData(m.k) : null, v = playerData(m.v);
  const div = document.createElement('div');
  if (m.k === me.id || m.v === me.id) div.className = 'mine';
  const wn = m.w === 'bomb' ? '💣 bomba' : (WEAPONS[m.w]?.name || m.w);
  div.innerHTML = (k ? `<span class="${k.t}">${k.n}</span>` : '') + `<span class="w">[${wn}${m.hs ? ' ⊕HS' : ''}]</span>` + (v ? `<span class="${v.t}">${v.n}</span>` : '');
  feed.appendChild(div);
  setTimeout(() => div.remove(), 6000);
  while (feed.children.length > 6) feed.firstChild.remove();
  if (m.v === me.id) {
    me.alive = false; me.scope = 0; mouseDown = false;
    me.specId = m.k && m.k !== me.id ? m.k : 0;
    showCenter('Nie żyjesz', k && m.k !== me.id ? `Zabity przez ${k.n}` : '', 2.5);
  }
  if (m.k === me.id && m.v !== me.id && m.hs) say('Headshot');
}

// ================================================================ UI
let centerTimer = 0;
function showCenter(text, sub, secs, team) {
  const c = $('center-msg');
  c.textContent = text; c.className = team || '';
  $('sub-msg').textContent = sub || '';
  centerTimer = secs;
}
function addChat(m, text) {
  const div = document.createElement('div');
  if (m) {
    const name = document.createElement('span'); name.className = m.team; name.textContent = (m.dead ? '*NIE ŻYJE* ' : '') + m.name;
    div.append(name, document.createTextNode(': ' + text));
  } else { div.style.color = '#ccc'; div.textContent = text; }
  const log = $('chatlog'); log.appendChild(div);
  while (log.children.length > 8) log.firstChild.remove();
  setTimeout(() => { div.style.opacity = 0; setTimeout(() => div.remove(), 1000); }, 9000);
}

function buildBuyMenu() {
  const wrap = $('buycats'); wrap.innerHTML = '';
  for (const cat of BUY) {
    const col = document.createElement('div');
    col.innerHTML = `<h3>${cat.cat}</h3>`;
    for (const key of cat.items) {
      const def = WEAPONS[key] || ITEMS[key];
      const b = document.createElement('button');
      b.innerHTML = `${def.name}<small>$${def.price}</small>`;
      const bad = (def.team && def.team !== me.team) || me.money < def.price || !game.bt || !me.alive;
      b.disabled = bad;
      if (def.team && def.team !== me.team) b.classList.add('hidden');
      b.onclick = () => { net({ t: 'buy', item: key }); setTimeout(buildBuyMenu, 150); };
      col.appendChild(b);
    }
    wrap.appendChild(col);
  }
  $('buymoney').textContent = `$${me.money}` + (game.bt ? '' : ' – czas zakupów minął');
}
function toggleBuy(open = !ui.buy) {
  if (open && (!me.alive || !game.bt)) { showCenter('', game.bt ? '' : 'Czas na zakupy minął', 1.2); return; }
  ui.buy = open;
  $('buymenu').classList.toggle('hidden', !open);
  if (open) { buildBuyMenu(); document.exitPointerLock(); }
  else lock();
}
function renderScoreboard() {
  const rows = team => game.p.filter(p => p.t === team).sort((a, b) => b.k - a.k).map(p =>
    `<tr class="${p.a ? '' : 'dead'} ${p.i === me.id ? 'me' : ''}"><td class="${team}">${p.n}${game.b && game.b.c === p.i && me.team === 'T' ? ' 💣' : ''}</td><td>${p.t === me.team ? '$' + p.m : ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
  const tbl = team => `<table><tr><th class="${team}">${team === 'T' ? 'TERRORYŚCI' : 'ANTYTERRORYŚCI'} – ${game.sc[team]}</th><th>Kasa</th><th>K</th><th>D</th></tr>${rows(team)}</table>`;
  $('sbbox').innerHTML = tbl('CT') + tbl('T') + `<div class="muted">Runda ${game.rn || '–'} · do ${ROUND.winScore} wygranych</div>`;
}

// ---------------------------------------------------------------- radar
const radar = $('radar').getContext('2d');
const RS = 200 / ((MAP.size + 2) * 2);
const rx = x => (x + MAP.size + 2) * RS, rz = z => (z + MAP.size + 2) * RS;
function drawRadar() {
  const g = radar;
  g.clearRect(0, 0, 200, 200);
  g.fillStyle = 'rgba(200,170,110,.25)'; g.fillRect(rx(-MAP.size), rz(-MAP.size), MAP.size * 2 * RS, MAP.size * 2 * RS);
  for (const [k, s] of Object.entries(MAP.sites)) {
    g.fillStyle = 'rgba(220,40,30,.18)'; g.fillRect(rx(s.x1), rz(s.z1), (s.x2 - s.x1) * RS, (s.z2 - s.z1) * RS);
    g.fillStyle = 'rgba(255,90,80,.9)'; g.font = 'bold 16px sans-serif'; g.fillText(k, rx((s.x1 + s.x2) / 2) - 5, rz((s.z1 + s.z2) / 2) + 6);
  }
  for (const b of MAP.boxes) {
    g.fillStyle = b.type === 'crate' ? 'rgba(160,110,60,.9)' : 'rgba(30,30,30,.85)';
    g.fillRect(rx(b.min[0]), rz(b.min[2]), (b.max[0] - b.min[0]) * RS, (b.max[2] - b.min[2]) * RS);
  }
  const b = game.b;
  if (b && (b.s === 'planted' || ((b.s === 'dropped') && me.team === 'T'))) {
    g.fillStyle = (b.s === 'planted' && Math.floor(performance.now() / 300) % 2) ? '#f22' : '#f88';
    g.fillRect(rx(b.x) - 4, rz(b.z) - 4, 8, 8);
  }
  for (const [id, r] of remotes) {
    if (!r.alive) continue;
    const enemy = r.team !== me.team;
    if (enemy && !r.spotted) continue;
    g.fillStyle = enemy ? '#f33' : (r.team === 'T' ? '#ffb040' : '#69f');
    g.beginPath(); g.arc(rx(r.pos.x), rz(r.pos.z), 3.5, 0, 7); g.fill();
    if (!enemy && b && b.s === 'carried' && b.c === id) { g.strokeStyle = '#f44'; g.lineWidth = 2; g.stroke(); }
  }
  if (me.alive) {
    g.save(); g.translate(rx(me.pos.x), rz(me.pos.z)); g.rotate(-me.yaw);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
    g.restore();
  }
}

// ================================================================ wejście
function lock() {
  if (!me.joined) return;
  try {
    const r = canvas.requestPointerLock?.();
    r?.catch?.(() => { if (!locked() && !ui.buy) $('pause').classList.remove('hidden'); });
  } catch {}
}
const locked = () => document.pointerLockElement === canvas;

document.querySelectorAll('#menu [data-team]').forEach(b => b.onclick = () => {
  const name = $('name').value.trim() || 'Gracz' + Math.floor(Math.random() * 1000);
  store.set('name', name);
  audio();
  net({ t: 'join', name, team: b.dataset.team });
  setTimeout(lock, 50);
});
$('name').value = store.get('name', '');
$('resume').onclick = () => { $('pause').classList.add('hidden'); lock(); };
document.querySelectorAll('#pause [data-switch]').forEach(b => b.onclick = () => {
  net({ t: 'team', team: b.dataset.switch }); $('pause').classList.add('hidden'); lock();
});
$('sens').value = sens; $('sensval').textContent = sens.toFixed(2);
$('sens').oninput = e => { sens = Number(e.target.value); $('sensval').textContent = sens.toFixed(2); store.set('sens', sens); };
$('vol').value = volume;
$('vol').oninput = e => { volume = Number(e.target.value); if (master) master.gain.value = volume; store.set('vol', volume); };

document.addEventListener('pointerlockchange', () => {
  if (locked()) { $('pause').classList.add('hidden'); return; }
  mouseDown = false;
  if (me.joined && !ui.buy) {
    if (ui.chat) closeChat();
    $('pause').classList.remove('hidden');
  }
});
canvas.addEventListener('click', () => { if (me.joined && !locked() && !ui.buy) lock(); });

document.addEventListener('mousemove', e => {
  if (!locked()) return;
  const zoom = camera.fov / BASE_FOV;
  me.yaw -= e.movementX * 0.0022 * sens * zoom;
  me.pitch = clamp(me.pitch - e.movementY * 0.0022 * sens * zoom, -1.55, 1.55);
});
document.addEventListener('mousedown', e => {
  if (!locked()) return;
  if (e.button === 0) {
    mouseDown = true;
    if (!me.alive) cycleSpec(); else tryShoot(false);
  }
  if (e.button === 2) {
    rightDown = true;
    if (!me.alive) cycleSpec(-1);
    else if (WEAPONS[me.weapon].scope && performance.now() / 1000 >= me.reloadEnd) { me.scope = (me.scope + 1) % 3; SND.click(); }
    else if (me.weapon === 'knife') tryShoot(true);
  }
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) rightDown = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (!locked() || !me.alive) return;
  const order = [me.inv[1], me.inv[2], 'knife'].filter(Boolean);
  const i = order.indexOf(me.weapon);
  switchWeapon(order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]);
});

function openChat() {
  ui.chat = true; const c = $('chatin'); c.classList.remove('hidden'); c.value = '';
  setTimeout(() => c.focus(), 0);
}
function closeChat() { ui.chat = false; const c = $('chatin'); c.blur(); c.classList.add('hidden'); }
$('chatin').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) net({ t: 'chat', text: t }); closeChat(); }
  if (e.key === 'Escape') closeChat();
});

addEventListener('keydown', e => {
  if (!me.joined || ui.chat) return;
  if (e.code === 'Tab') { e.preventDefault(); ui.tab = true; renderScoreboard(); $('scoreboard').classList.remove('hidden'); return; }
  if (e.repeat) return;
  keys[e.code] = true;
  switch (e.code) {
    case 'Digit1': switchWeapon(me.inv[1]); break;
    case 'Digit2': switchWeapon(me.inv[2]); break;
    case 'Digit3': switchWeapon('knife'); break;
    case 'KeyQ': switchWeapon(me.inv[WEAPONS[me.lastWeapon].slot] === me.lastWeapon ? me.lastWeapon : bestWeapon()); break;
    case 'KeyR': startReload(); break;
    case 'KeyB': toggleBuy(); break;
    case 'KeyY': case 'Enter': if (!ui.buy) { e.preventDefault(); openChat(); } break;
    case 'KeyE': if (me.alive) net({ t: 'useStart' }); break;
    case 'Space': if (!me.alive) cycleSpec(); break;
    case 'Escape': if (ui.buy) toggleBuy(false); break;
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') { ui.tab = false; $('scoreboard').classList.add('hidden'); }
  if (e.code === 'KeyE') net({ t: 'useEnd' });
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; net({ t: 'useEnd' }); });

function cycleSpec(dir = 1) {
  const alive = game.p.filter(p => p.a && p.i !== me.id && (p.t === me.team || !game.p.some(q => q.a && q.t === me.team && q.i !== me.id)));
  if (!alive.length) { me.specId = 0; return; }
  const i = alive.findIndex(p => p.i === me.specId);
  me.specId = alive[(i + dir + alive.length) % alive.length].i;
}

// ================================================================ ruch
const GRAV = 20, JUMP = 7.0;
function collides(x, y, z, h) {
  const r = PLAYER.r;
  for (const b of MAP.boxes) {
    if (x + r > b.min[0] && x - r < b.max[0] && y + h > b.min[1] && y < b.max[1] && z + r > b.min[2] && z - r < b.max[2]) return b;
  }
  return null;
}
function moveAxis(axis, delta, h, grounded) {
  const p = me.pos;
  const prev = p.getComponent(axis);
  p.setComponent(axis, prev + delta);
  const b = collides(p.x, p.y, p.z, h);
  if (!b) return false;
  const step = grounded ? 0.45 : 0.3;
  if (axis !== 1 && b.max[1] - p.y <= step && b.max[1] - p.y > 0 && !collides(p.x, b.max[1] + 0.001, p.z, h)) {
    p.y = b.max[1] + 0.001; // wejście na stopień / krawędź
    return false;
  }
  if (axis === 1) {
    if (delta < 0) { p.y = b.max[1]; me.onGround = true; }
    else p.y = b.min[1] - h - 0.001;
    me.vel.y = 0;
  } else {
    p.setComponent(axis, prev);
    me.vel.setComponent(axis, 0);
  }
  return true;
}

let lastStepPos = new THREE.Vector3();
function usingBomb() {
  if (!keys.KeyE || !game.b || game.ph !== 'live') return false;
  const b = game.b;
  if (me.team === 'T') return b.s === 'carried' && b.c === me.id && !!siteAt(me.pos.x, me.pos.z);
  return b.s === 'planted' && Math.hypot(me.pos.x - b.x, me.pos.z - b.z) < 2;
}
function updateMovement(dt) {
  const frozen = game.ph === 'freeze' || usingBomb();
  const typing = ui.chat;
  let fw = 0, st = 0;
  if (!frozen && !typing) {
    fw = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    st = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  }
  // kucanie (w powietrzu podciąga nogi – crouch-jump)
  const p = me.pos, dh = PLAYER.h - PLAYER.ch;
  const wantCrouch = !typing && !!keys.KeyC;
  if (wantCrouch && !me.crouch) {
    if (!me.onGround && !collides(p.x, p.y + dh, p.z, PLAYER.ch)) p.y += dh;
    me.crouch = true;
  } else if (!wantCrouch && me.crouch) {
    if (me.onGround) { if (!collides(p.x, p.y, p.z, PLAYER.h)) me.crouch = false; }
    else if (p.y - dh >= 0 && !collides(p.x, p.y - dh, p.z, PLAYER.h)) { p.y -= dh; me.crouch = false; }
    else if (!collides(p.x, p.y, p.z, PLAYER.h)) me.crouch = false;
  }
  me.crouchAmt += ((me.crouch ? 1 : 0) - me.crouchAmt) * Math.min(1, dt * 14);
  const h = me.crouch ? PLAYER.ch : PLAYER.h;

  const w = WEAPONS[me.weapon];
  const max = w.speed * (me.crouch ? 0.34 : keys.ShiftLeft || keys.ShiftRight ? 0.52 : 1) * (me.scope ? 0.6 : 1);
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let wx = -sin * fw + cos * st, wz = -cos * fw - sin * st;
  const len = Math.hypot(wx, wz); if (len > 0) { wx /= len; wz /= len; }
  if (me.onGround) {
    const k = Math.min(1, dt * 11);
    me.vel.x += (wx * max - me.vel.x) * k;
    me.vel.z += (wz * max - me.vel.z) * k;
    if (keys.Space && !frozen && !typing) { me.vel.y = JUMP; me.onGround = false; }
  } else {
    me.vel.x += wx * 8 * dt; me.vel.z += wz * 8 * dt;
    const hs = Math.hypot(me.vel.x, me.vel.z), cap = Math.max(max, 6.8);
    if (hs > cap) { me.vel.x *= cap / hs; me.vel.z *= cap / hs; }
  }
  me.vel.y -= GRAV * dt;
  const wasGround = me.onGround, fallV = me.vel.y;
  moveAxis(0, me.vel.x * dt, h, wasGround);
  moveAxis(2, me.vel.z * dt, h, wasGround);
  me.onGround = false;
  moveAxis(1, me.vel.y * dt, h, wasGround);
  if (me.pos.y <= 0) { me.pos.y = 0; me.vel.y = 0; me.onGround = true; }
  if (me.onGround && !wasGround && fallV < -6) SND.land();
  // kroki
  const sp = Math.hypot(me.vel.x, me.vel.z);
  if (me.onGround && sp > 4.2) {
    me.stepAcc += sp * dt;
    if (me.stepAcc > 2.4) { me.stepAcc = 0; SND.step(null, 0.18); }
  }
  return sp;
}

// ================================================================ strzelanie
const tmpV = new THREE.Vector3();
function currentSpread(speed) {
  const w = WEAPONS[me.weapon];
  if (w.knife) return 0;
  let s = w.scope && !me.scope ? w.unscoped : w.spread;
  s += w.moveSpread * clamp((speed - 1.5) / 4, 0, 1);
  if (!me.onGround) s += 0.12;
  if (me.crouch) s *= 0.7;
  return s;
}
let curSpeed = 0;
function eyePos() { return me.pos.clone().setY(me.pos.y + PLAYER.eye - (PLAYER.eye - PLAYER.ceye) * me.crouchAmt); }

function tryShoot(alt) {
  const t = performance.now() / 1000;
  if (!me.alive || game.ph === 'freeze' || ui.buy || ui.chat) return;
  if (t < me.nextShot || (me.reloadEnd && t < me.reloadEnd)) return;
  const w = WEAPONS[me.weapon];
  const ammo = me.ammo[me.weapon];
  if (!w.knife) {
    if (!ammo || ammo.mag <= 0) { SND.click(); me.nextShot = t + 0.25; if (ammo && ammo.res > 0) startReload(); return; }
    ammo.mag--;
  }
  me.nextShot = t + w.rate * (alt ? 2 : 1);
  if (t - me.lastShotT > w.rate + 0.25) me.shotsFired = 0;
  me.shotsFired++; me.lastShotT = t;

  const o = eyePos();
  const spread = currentSpread(curSpeed);
  const pitch = me.pitch + me.recoil, yaw = me.yaw + me.recoilYaw;
  const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  if (spread > 0) {
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }
  net({ t: 'shoot', o: o.toArray().map(v => +v.toFixed(3)), d: dir.toArray().map(v => +v.toFixed(4)), w: me.weapon, alt: alt || undefined });

  // odrzut
  if (!w.knife) {
    me.recoil = Math.min(me.recoil + w.recoil, 0.22);
    me.recoilYaw += (me.shotsFired > 4 ? Math.sin(me.shotsFired * 0.7) : (Math.random() - 0.5) * 0.3) * w.recoil * 0.6;
    me.recoilYaw = clamp(me.recoilYaw, -0.08, 0.08);
  }
  vmState.kick = w.knife ? 0 : Math.min(1, 0.6 + w.recoil * 15);
  if (w.knife) vmState.swing = 1;
  SND.shot(me.weapon, null);

  if (w.knife) return;
  // lokalny efekt trafienia
  const others = [...remotes.entries()].map(([id, r]) => ({ id, alive: r.alive, x: r.pos.x, y: r.pos.y, z: r.pos.z, crouch: r.data?.c }));
  const res = traceShot(o.toArray(), dir.toArray(), 300, others, me.id);
  const end = o.clone().addScaledVector(dir, res.t);
  const muzzleW = camera.localToWorld(tmpV.set(0.14, -0.13, -0.6).clone());
  addTracer(muzzleW, end);
  addImpact(end, res.axis, dir, !!res.hit);
  if (vm) addFlashSprite(vmRoot, new THREE.Vector3(0, 0.03, vm.userData.muzzle).applyMatrix4(vm.matrix), 0.16 + (me.weapon === 'awp' ? 0.1 : 0), 0.04);
  worldFlash(muzzleW);
  if (w.scope) me.scope = 0;
  if (ammo.mag === 0 && ammo.res > 0) setTimeout(startReload, 250);
}

function startReload() {
  const w = WEAPONS[me.weapon], a = me.ammo[me.weapon];
  const t = performance.now() / 1000;
  if (!me.alive || w.knife || !a || a.mag >= w.mag || a.res <= 0 || (me.reloadEnd && t < me.reloadEnd)) return;
  me.reloadEnd = t + w.reload; me.scope = 0;
  me.reloadWeapon = me.weapon;
  SND.reload();
}
function updateReload(t) {
  if (me.reloadEnd && t >= me.reloadEnd) {
    me.reloadEnd = 0;
    const w = WEAPONS[me.reloadWeapon], a = me.ammo[me.reloadWeapon];
    if (a && me.reloadWeapon === me.weapon) { const n = Math.min(w.mag - a.mag, a.res); a.mag += n; a.res -= n; }
  }
}

// ================================================================ pętla gry
let last = performance.now(), sendAcc = 0, hudAcc = 0, shake = 0, radarAcc = 0;
const losRay = new THREE.Vector3();

function update(dt) {
  const t = performance.now() / 1000;
  if (me.alive) {
    curSpeed = updateMovement(dt);
    if (mouseDown && WEAPONS[me.weapon].auto) tryShoot(false);
    updateReload(t);
  }
  // odrzut wraca
  const w = WEAPONS[me.weapon];
  if (t - me.lastShotT > (w.rate || 0.1) + 0.05) {
    me.recoil = Math.max(0, me.recoil - dt * (0.35 + me.recoil * 3));
    me.recoilYaw *= Math.exp(-dt * 6);
  }
  me.punch *= Math.exp(-dt * 10);

  // wysyłanie stanu
  sendAcc += dt;
  if (sendAcc > 1 / 30 && me.joined && me.alive) {
    sendAcc = 0;
    net({ t: 's', x: +me.pos.x.toFixed(3), y: +me.pos.y.toFixed(3), z: +me.pos.z.toFixed(3), yw: +me.yaw.toFixed(3), pt: +me.pitch.toFixed(3), c: me.crouch, w: me.weapon });
  }

  // gracze zdalni
  const k = 1 - Math.exp(-dt * 14);
  const eye = eyePos();
  for (const [id, r] of remotes) {
    r.pos.lerp(r.target, k);
    r.yaw = lerpAngle(r.yaw, r.tyaw ?? r.yaw, k);
    r.pitch += ((r.tpitch ?? 0) - r.pitch) * k;
    r.crouch += ((r.crouchT || 0) - r.crouch) * k;
    const m = r.model;
    m.root.position.copy(r.pos);
    m.root.rotation.y = r.yaw;
    m.body.scale.y = 1 - 0.28 * r.crouch;
    m.head.rotation.x = r.pitch * 0.6;
    m.arms.rotation.x = r.pitch;
    if (!r.alive) {
      r.deadT = Math.min(1, r.deadT + dt * 3);
      m.body.rotation.x = r.deadT * Math.PI / 2;
      m.body.position.y = 0.1 * r.deadT;
      m.gunHolder.visible = false;
    } else {
      m.body.rotation.x = 0; m.body.position.y = 0; m.gunHolder.visible = true;
      const sp = Math.min(r.speed, 7);
      r.step += dt * sp * 1.6;
      const swing = Math.sin(r.step) * Math.min(1, sp / 3) * 0.6;
      m.legL.rotation.x = swing; m.legR.rotation.x = -swing;
      if (sp > 4.3 && Math.abs(r.pos.y - r.target.y) < 0.05) {
        r.stepAcc = (r.stepAcc || 0) + sp * dt;
        if (r.stepAcc > 2.4) { r.stepAcc = 0; SND.step(r.pos, 0.6); }
      }
      // widoczność wroga na radarze
      if (r.team !== me.team && me.alive) {
        losRay.set(r.pos.x - eye.x, r.pos.y + 1.4 - eye.y, r.pos.z - eye.z);
        const dist = losRay.length(); losRay.normalize();
        const fwd = new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
        r.spotted = traceMap(eye.toArray(), losRay.toArray(), dist).t >= dist - 0.01 && fwd.dot(losRay) > 0.3;
      } else r.spotted = r.team !== me.team && r.spotted;
    }
  }

  // bomba – pikanie
  const b = game.b;
  if (b && b.s === 'planted') {
    const left = b.tl / 1000 - (performance.now() - snapTime) / 1000;
    bombBeep -= dt;
    const interval = clamp(left / ROUND.bomb, 0.08, 1) * 1.0;
    if (bombBeep <= 0) { bombBeep = interval; SND.beep(new THREE.Vector3(b.x, b.y + 0.2, b.z)); bombLed.visible = true; setTimeout(() => bombLed.visible = false, 90); }
  } else bombLed.visible = !!(b && b.s === 'dropped');

  updateFx(dt);
  updateCamera(dt);
  updateViewModel(dt, t);

  hudAcc += dt; radarAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }
  if (radarAcc > 0.06) { radarAcc = 0; drawRadar(); }
  if (centerTimer > 0) { centerTimer -= dt; if (centerTimer <= 0) { $('center-msg').textContent = ''; $('sub-msg').textContent = ''; } }
}

function updateCamera(dt) {
  shake *= Math.exp(-dt * 3);
  if (me.alive || !me.joined) {
    if (!me.joined) {
      const t = performance.now() / 6000;
      camera.position.set(Math.sin(t) * 40, 22, Math.cos(t) * 40);
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.copy(eyePos());
      camera.rotation.set(me.pitch + me.recoil * 0.5 + me.punch, me.yaw + me.recoilYaw * 0.5, 0);
    }
  } else {
    let r = remotes.get(me.specId);
    if (!r || !r.alive) { cycleSpec(); r = remotes.get(me.specId); }
    if (r && r.alive) {
      camera.position.copy(r.pos); camera.position.y += r.data?.c ? PLAYER.ceye : PLAYER.eye;
      camera.rotation.set(r.pitch, r.yaw, 0);
    } else {
      camera.rotation.x = lerpAngle(camera.rotation.x, -0.5, dt);
    }
  }
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.3;
    camera.position.y += (Math.random() - 0.5) * shake * 0.3;
  }
  const targetFov = me.alive && me.scope ? (me.scope === 1 ? 40 : 15) : BASE_FOV;
  if (camera.fov !== targetFov) { camera.fov = targetFov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  if (actx) {
    const l = actx.listener, p = camera.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
}

function updateViewModel(dt, t) {
  vmRoot.visible = me.alive && !me.scope && me.joined;
  if (!vm) return;
  vmState.kick *= Math.exp(-dt * 18);
  vmState.drawT = Math.max(0, vmState.drawT - dt * 3);
  vmState.swing = Math.max(0, vmState.swing - dt * 3.5);
  const sp = me.onGround ? curSpeed : 0;
  vmState.bobT += dt * sp * 1.7;
  const bob = Math.min(1, sp / 5);
  const reloading = me.reloadEnd && t < me.reloadEnd;
  let rl = 0;
  if (reloading) {
    const total = WEAPONS[me.weapon].reload, p = 1 - (me.reloadEnd - t) / total;
    rl = Math.sin(Math.min(1, p) * Math.PI);
  }
  vm.position.set(
    0.17 + Math.sin(vmState.bobT) * 0.012 * bob,
    -0.18 - Math.abs(Math.cos(vmState.bobT)) * 0.01 * bob - vmState.drawT * 0.25 - rl * 0.12 - me.crouchAmt * 0.01,
    -0.36 + vmState.kick * 0.05,
  );
  vm.rotation.set(vmState.kick * 0.12 + rl * 0.6 - vmState.drawT * 0.6, 0.04, rl * 0.4);
  if (vmState.swing > 0) { const s = Math.sin(vmState.swing * Math.PI); vm.rotation.y = 0.04 + s * 0.9; vm.position.x -= s * 0.12; vm.position.z -= s * 0.12; }
}

function fmtTime(ms) { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function updateHud() {
  if (!me.joined) return;
  $('scT').textContent = game.sc.T; $('scCT').textContent = game.sc.CT;
  const timer = $('timer');
  const b = game.b;
  const elapsed = performance.now() - snapTime;
  if (b && b.s === 'planted') { timer.textContent = '💣 ' + fmtTime(Math.max(0, b.tl - elapsed)); timer.className = 'bomb'; }
  else {
    timer.className = '';
    if (game.ph === 'warmup') timer.textContent = game.tl > 0 ? fmtTime(game.tl - elapsed) : 'ROZGRZEWKA';
    else timer.textContent = fmtTime(Math.max(0, game.tl - elapsed));
    if (game.ph === 'freeze') timer.style.color = '#ff6'; else timer.style.color = '';
  }
  const at = game.p.filter(p => p.t === 'T' && p.a).length, act = game.p.filter(p => p.t === 'CT' && p.a).length;
  $('alive').innerHTML = game.ph === 'warmup' ? '' : `<span class="T">${at} żywych</span> &nbsp;vs&nbsp; <span class="CT">${act} żywych</span>`;

  $('hp').textContent = me.alive ? me.hp : 0;
  $('hp').style.color = me.hp <= 25 ? '#f44' : '';
  $('armor').textContent = me.armor;
  $('money').textContent = `$${me.money}`;
  const w = WEAPONS[me.weapon], a = me.ammo[me.weapon];
  $('ammobox').style.visibility = me.alive && !w.knife ? 'visible' : 'hidden';
  if (a && !w.knife) { $('mag').textContent = a.mag; $('res').textContent = a.res; $('mag').style.color = a.mag <= w.mag * 0.2 ? '#f44' : ''; }
  $('wepname').textContent = me.alive ? w.name + (me.reloadEnd ? ' – przeładowanie…' : '') : '';
  $('weplist').innerHTML = me.alive ? [me.inv[1], me.inv[2], 'knife'].map((k, i) => k ? `<div class="${k === me.weapon ? 'cur' : ''}">${i + 1}. ${WEAPONS[k].name}</div>` : '').join('') + (me.kit ? '<div>🔧 Zestaw</div>' : '') : '';
  const carrying = b && b.s === 'carried' && b.c === me.id;
  $('bombicon').textContent = carrying ? '💣 Masz bombę – podłóż na A lub B (E)' : '';

  // podpowiedzi
  let hint = '';
  if (me.alive && game.ph === 'live' && b) {
    if (carrying && siteAt(me.pos.x, me.pos.z)) hint = 'Przytrzymaj E, aby podłożyć bombę';
    if (me.team === 'CT' && b.s === 'planted' && Math.hypot(me.pos.x - b.x, me.pos.z - b.z) < 2) hint = `Przytrzymaj E, aby rozbroić${me.kit ? ' (zestaw)' : ''}`;
  }
  if (me.alive && game.bt && !hint && game.ph !== 'warmup') hint = `B – sklep (${game.ph === 'live' ? Math.ceil(game.bt / 1000) + ' s' : 'freeze time'})`;
  if (game.ph === 'warmup' && me.alive && !hint) hint = 'Rozgrzewka – wszystko za darmo w sklepie (B). Mecz zacznie się, gdy będą gracze w obu drużynach.';
  $('hint').textContent = hint;
  const mine = playerData(me.id);
  const prog = $('progress');
  prog.classList.toggle('hidden', !(mine && mine.u > 0));
  if (mine && mine.u > 0) prog.firstChild.style.width = (mine.u * 100) + '%';
  // spectator
  const spec = remotes.get(me.specId);
  $('spec').textContent = !me.alive ? (spec && spec.alive ? `Obserwujesz: ${spec.data.n} (${spec.data.hp} HP) – klik/spacja: następny` : 'Nie żyjesz – czekaj na następną rundę') : '';
  // celownik
  const gap = 3 + currentSpread(curSpeed) * 500;
  const ch = $('crosshair');
  ch.style.display = me.alive && !me.scope ? '' : 'none';
  ch.querySelector('.t').style.top = (-gap - 8) + 'px';
  ch.querySelector('.b').style.top = gap + 'px';
  ch.querySelector('.l').style.left = (-gap - 8) + 'px';
  ch.querySelector('.r').style.left = gap + 'px';
  $('scope').classList.toggle('hidden', !(me.alive && me.scope));
  if (ui.buy) { if (!game.bt || !me.alive) toggleBuy(false); else $('buymoney').textContent = `$${me.money}`; }
  if (ui.tab) renderScoreboard();
}

function render() {
  renderer.clear();
  renderer.render(scene, camera);
  if (vmRoot.visible) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
connect();
requestAnimationFrame(frame);
