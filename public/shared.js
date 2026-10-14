// Wspólny kod dla serwera i klienta: mapa, bronie, stałe, raycasting.

export const PLAYER = { r: 0.35, h: 1.8, ch: 1.3, eye: 1.62, ceye: 1.12 };

export const ROUND = {
  freeze: 5, live: 115, end: 5, bomb: 40, plant: 3.2, defuse: 5, defuseKit: 2.5,
  buyTime: 25, winScore: 8,
  startMoney: 800, maxMoney: 16000, winMoney: 3250, lossMoney: 1900,
  killMoney: 300, plantMoney: 300,
};

// slot: 1 = główna, 2 = pistolet, 3 = nóż, 4 = granaty
// cls: klasa broni (dźwięk, nagroda za fraga), kill: nagroda za fraga (domyślnie ROUND.killMoney)
// scope: luneta, zoom: FOV kolejnych przybliżeń, bolt: luneta zdejmowana po strzale
// pellets: śrut (liczba pocisków na strzał), silenced: tłumik, tone: barwa wystrzału (Hz)
export const WEAPONS = {
  knife:  { name: 'Nóż',      slot: 3, dmg: 55,  rate: 0.45, range: 2.2, speed: 6.6, knife: true, kill: 1500 },
  // pistolety
  glock:  { name: 'Glock-18', slot: 2, cls: 'pistol', dmg: 28, rate: 0.15, mag: 20, res: 120, reload: 2.2, spread: 0.010, moveSpread: 0.035, recoil: 0.010, price: 200, team: 'T',  speed: 6.3 },
  usp:    { name: 'USP-S',    slot: 2, cls: 'pistol', dmg: 35, rate: 0.17, mag: 12, res: 24,  reload: 2.2, spread: 0.007, moveSpread: 0.035, recoil: 0.014, price: 200, team: 'CT', speed: 6.3, silenced: true },
  p250:   { name: 'P250',     slot: 2, cls: 'pistol', dmg: 38, rate: 0.15, mag: 13, res: 26,  reload: 2.2, spread: 0.009, moveSpread: 0.04,  recoil: 0.018, price: 300, speed: 6.3 },
  dualies:{ name: 'Dual Berettas', slot: 2, cls: 'pistol', dmg: 38, rate: 0.12, mag: 30, res: 120, reload: 3.8, spread: 0.012, moveSpread: 0.04, recoil: 0.012, price: 300, speed: 6.3 },
  tec9:   { name: 'Tec-9',    slot: 2, cls: 'pistol', dmg: 33, rate: 0.12, mag: 18, res: 90,  reload: 2.5, spread: 0.011, moveSpread: 0.03,  recoil: 0.014, price: 500, team: 'T',  speed: 6.3 },
  fiveseven: { name: 'Five-SeveN', slot: 2, cls: 'pistol', dmg: 32, rate: 0.15, mag: 20, res: 100, reload: 2.2, spread: 0.008, moveSpread: 0.03, recoil: 0.014, price: 500, team: 'CT', speed: 6.3 },
  deagle: { name: 'Desert Eagle', slot: 2, cls: 'pistol', dmg: 63, rate: 0.45, mag: 7, res: 35, reload: 2.2, spread: 0.006, moveSpread: 0.08, recoil: 0.05, price: 700, speed: 6.1, tone: 2000 },
  // SMG
  mac10:  { name: 'MAC-10',   slot: 1, cls: 'smg', dmg: 29, rate: 0.075, mag: 30, res: 100, reload: 2.6, spread: 0.016, moveSpread: 0.025, recoil: 0.008, price: 1050, team: 'T',  speed: 6.3, auto: true, kill: 600 },
  mp9:    { name: 'MP9',      slot: 1, cls: 'smg', dmg: 26, rate: 0.07,  mag: 30, res: 120, reload: 2.1, spread: 0.014, moveSpread: 0.022, recoil: 0.007, price: 1250, team: 'CT', speed: 6.3, auto: true, kill: 600 },
  ump45:  { name: 'UMP-45',   slot: 1, cls: 'smg', dmg: 35, rate: 0.09,  mag: 25, res: 100, reload: 3.5, spread: 0.012, moveSpread: 0.03,  recoil: 0.010, price: 1200, speed: 6.1, auto: true, kill: 600, tone: 2400 },
  mp7:    { name: 'MP7',      slot: 1, cls: 'smg', dmg: 29, rate: 0.08,  mag: 30, res: 120, reload: 3.1, spread: 0.010, moveSpread: 0.025, recoil: 0.008, price: 1500, speed: 5.8, auto: true, kill: 600 },
  p90:    { name: 'P90',      slot: 1, cls: 'smg', dmg: 26, rate: 0.07,  mag: 50, res: 100, reload: 3.3, spread: 0.013, moveSpread: 0.025, recoil: 0.006, price: 2350, speed: 6.1, auto: true, tone: 3200 },
  // ciężkie
  nova:   { name: 'Nova',     slot: 1, cls: 'heavy', dmg: 26, pellets: 9, rate: 0.88, mag: 8, res: 32, reload: 4.0, spread: 0.05,  moveSpread: 0.02, recoil: 0.06,  price: 1050, speed: 5.8, kill: 900 },
  xm1014: { name: 'XM1014',   slot: 1, cls: 'heavy', dmg: 20, pellets: 6, rate: 0.35, mag: 7, res: 32, reload: 3.5, spread: 0.045, moveSpread: 0.02, recoil: 0.035, price: 2000, speed: 5.7, auto: true, kill: 600 },
  negev:  { name: 'Negev',    slot: 1, cls: 'heavy', dmg: 35, rate: 0.075, mag: 150, res: 200, reload: 5.7, spread: 0.012, moveSpread: 0.06, recoil: 0.009, price: 1700, speed: 4.0, auto: true, tone: 2200 },
  // karabiny
  galil:  { name: 'Galil AR', slot: 1, cls: 'rifle', dmg: 30, rate: 0.09, mag: 35, res: 90, reload: 3.0, spread: 0.005,  moveSpread: 0.07, recoil: 0.014, price: 1800, team: 'T',  speed: 5.7, auto: true, tone: 2500 },
  famas:  { name: 'FAMAS',    slot: 1, cls: 'rifle', dmg: 30, rate: 0.09, mag: 25, res: 90, reload: 3.3, spread: 0.005,  moveSpread: 0.07, recoil: 0.012, price: 2050, team: 'CT', speed: 5.8, auto: true },
  ak47:   { name: 'AK-47',    slot: 1, cls: 'rifle', dmg: 36, rate: 0.1,  mag: 30, res: 90, reload: 2.5, spread: 0.004,  moveSpread: 0.07, recoil: 0.016, price: 2700, team: 'T',  speed: 5.9, auto: true, tone: 2300 },
  m4a4:   { name: 'M4A4',     slot: 1, cls: 'rifle', dmg: 33, rate: 0.09, mag: 30, res: 90, reload: 3.1, spread: 0.003,  moveSpread: 0.06, recoil: 0.013, price: 3100, team: 'CT', speed: 6.0, auto: true },
  m4a1s:  { name: 'M4A1-S',   slot: 1, cls: 'rifle', dmg: 38, rate: 0.1,  mag: 20, res: 80, reload: 3.1, spread: 0.0025, moveSpread: 0.06, recoil: 0.011, price: 2900, team: 'CT', speed: 5.9, auto: true, silenced: true },
  sg553:  { name: 'SG 553',   slot: 1, cls: 'rifle', dmg: 30, rate: 0.09, mag: 30, res: 90, reload: 2.8, spread: 0.0015, unscoped: 0.005, moveSpread: 0.07, recoil: 0.013, price: 3000, team: 'T',  speed: 5.5, auto: true, scope: true, zoom: [52], tone: 2600 },
  aug:    { name: 'AUG',      slot: 1, cls: 'rifle', dmg: 28, rate: 0.09, mag: 30, res: 90, reload: 3.8, spread: 0.0015, unscoped: 0.005, moveSpread: 0.07, recoil: 0.012, price: 3300, team: 'CT', speed: 5.8, auto: true, scope: true, zoom: [52] },
  ssg08:  { name: 'SSG 08',   slot: 1, cls: 'sniper', dmg: 88, rate: 1.25, mag: 10, res: 90, reload: 3.7, spread: 0.0006, unscoped: 0.05, moveSpread: 0.06, recoil: 0.04, price: 1700, speed: 6.1, scope: true, zoom: [40, 15], bolt: true },
  awp:    { name: 'AWP',      slot: 1, cls: 'sniper', dmg: 115, rate: 1.45, mag: 5, res: 30, reload: 3.6, spread: 0.0004, unscoped: 0.09, moveSpread: 0.15, recoil: 0.06, price: 4750, speed: 5.2, scope: true, zoom: [40, 15], bolt: true, kill: 100 },
  // granaty (nade: rodzaj działania, max: limit sztuk)
  he:      { name: 'Granat HE',    slot: 4, nade: 'he',    price: 300, max: 1, speed: 6.3 },
  flash:   { name: 'Flashbang',    slot: 4, nade: 'flash', price: 200, max: 2, speed: 6.3 },
  smoke:   { name: 'Granat dymny', slot: 4, nade: 'smoke', price: 300, max: 1, speed: 6.3 },
  molotov: { name: 'Mołotow',      slot: 4, nade: 'fire',  price: 400, max: 1, speed: 6.3, team: 'T' },
  incgren: { name: 'Granat zapalający', slot: 4, nade: 'fire', price: 600, max: 1, speed: 6.3, team: 'CT' },
};

export const NADES = Object.keys(WEAPONS).filter(k => WEAPONS[k].nade);

export const ITEMS = {
  vest:   { name: 'Kamizelka', price: 650 },
  vesthelm: { name: 'Kamizelka + hełm', price: 1000 },
  kit:    { name: 'Zestaw do rozbrajania', price: 400, team: 'CT' },
};

export const BUY = [
  { cat: 'Pistolety', items: ['glock', 'usp', 'p250', 'dualies', 'tec9', 'fiveseven', 'deagle'] },
  { cat: 'SMG', items: ['mac10', 'mp9', 'ump45', 'mp7', 'p90'] },
  { cat: 'Ciężkie', items: ['nova', 'xm1014', 'negev'] },
  { cat: 'Karabiny', items: ['galil', 'famas', 'ak47', 'm4a4', 'm4a1s', 'sg553', 'aug', 'ssg08', 'awp'] },
  { cat: 'Granaty', items: ['he', 'flash', 'smoke', 'molotov', 'incgren'] },
  { cat: 'Wyposażenie', items: ['vest', 'vesthelm', 'kit'] },
];

export const DEFAULT_PISTOL = { T: 'glock', CT: 'usp' };

// ---------------------------------------------------------------- mapa
const boxes = [];
function B(x1, z1, x2, z2, h, type = 'wall', y0 = 0) {
  boxes.push({
    min: [Math.min(x1, x2), y0, Math.min(z1, z2)],
    max: [Math.max(x1, x2), y0 + h, Math.max(z1, z2)],
    type,
  });
}
function crate(x, z, s = 1.2, y0 = 0) { B(x - s / 2, z - s / 2, x + s / 2, z + s / 2, s, 'crate', y0); }

const S = 48;
// ściany zewnętrzne
B(-S - 2, -S - 2, S + 2, -S, 9); B(-S - 2, S, S + 2, S + 2, 9);
B(-S - 2, -S, -S, S, 9); B(S, -S, S + 2, S, 9);
// przegrody między alejkami (B | mid | A) z przejściami
B(-16, -14, -10, 0, 6); B(-16, 5, -10, 30, 6);
B(10, -14, 16, 8, 6); B(10, 13, 16, 30, 6);
// drzwi na midzie
B(-10, -16, -3, -14, 6); B(3, -16, 10, -14, 6);
// okolice T spawnu
B(-30, 30, -22, 32, 4); B(22, 30, 30, 32, 4);
// ściany przy bombsite'ach
B(-16, -34, -12, -22, 5); B(12, -34, 16, -22, 5);
B(-48, -48, -38, -42, 3, 'stone');
B(34, -48, 48, -40, 1, 'stone');
// filary w alejkach
B(28, -8, 34, 2, 4, 'stone'); B(-34, -6, -28, 0, 4, 'stone');
B(-2, 4, 2, 7, 1.1, 'stone');
B(-48, 18, -40, 22, 2.5, 'stone'); B(40, 30, 48, 34, 2.5, 'stone');
// skrzynie – A
crate(26, -30, 1.6); crate(26, -30, 1.2, 1.6); crate(36, -26, 1.2); crate(37.2, -26, 1.2); crate(30, -37, 2);
// skrzynie – B
crate(-26, -30, 1.6); crate(-26, -30, 1.2, 1.6); crate(-34, -26, 1.2); crate(-36, -34, 2); crate(-20, -38, 1.2);
// mid
crate(-5, 10, 1.2); crate(6, 22, 1.6); crate(0, -8, 1.2);
// alejka B
crate(-24, 15, 1.6); crate(-40, 8, 1.2); crate(-40, 9.2, 1.2); crate(-20, -8, 1.4);
// alejka A
crate(24, 18, 1.6); crate(40, -10, 1.2); crate(22, -4, 1.2); crate(40, 10, 2); crate(40, 10, 1.2, 2);
// spawny
crate(-8, 38, 1.4); crate(10, 42, 1.4); crate(10, 42, 1.0, 1.4);
crate(-12, -42, 1.4); crate(12, -44, 1.4);

const spawns = { T: [], CT: [] };
for (const x of [-6, -3, 0, 3, 6]) for (const dz of [0, 3]) {
  spawns.T.push({ x, z: 40 + dz, yaw: 0 });
  spawns.CT.push({ x, z: -41 - dz, yaw: Math.PI });
}

export const MAP = {
  size: S,
  boxes,
  sites: {
    A: { x1: 20, x2: 44, z1: -40, z2: -18 },
    B: { x1: -44, x2: -20, z1: -40, z2: -18 },
  },
  spawns,
};

export function siteAt(x, z) {
  for (const [k, s] of Object.entries(MAP.sites)) {
    if (x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2) return k;
  }
  return null;
}

// ---------------------------------------------------------------- raycasting
export function rayAABB(o, d, min, max) {
  let tmin = 0, tmax = Infinity, axis = -1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv, t2 = (max[i] - o[i]) * inv;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) { tmin = t1; axis = i; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, axis };
}

// Najbliższe trafienie w geometrię mapy (z podłogą y=0).
export function traceMap(o, d, range) {
  let best = range, axis = -1;
  for (const b of MAP.boxes) {
    const r = rayAABB(o, d, b.min, b.max);
    if (r && r.t < best) { best = r.t; axis = r.axis; }
  }
  if (d[1] < 0) {
    const t = -o[1] / d[1];
    if (t < best) { best = t; axis = 1; }
  }
  return { t: best, axis };
}

export function playerHitboxes(p) {
  const h = p.crouch ? PLAYER.ch : PLAYER.h;
  const r = PLAYER.r;
  return [
    { min: [p.x - 0.22, p.y + h - 0.42, p.z - 0.22], max: [p.x + 0.22, p.y + h, p.z + 0.22], head: true },
    { min: [p.x - r, p.y, p.z - r], max: [p.x + r, p.y + h - 0.42, p.z + r], head: false },
  ];
}

// Trafienie w graczy (najbliższe przed ścianą).
export function traceShot(o, d, range, players, ignoreId) {
  const wall = traceMap(o, d, range);
  let best = wall.t, hit = null, head = false;
  for (const p of players) {
    if (p.id === ignoreId || !p.alive) continue;
    for (const hb of playerHitboxes(p)) {
      const r = rayAABB(o, d, hb.min, hb.max);
      if (r && r.t < best) { best = r.t; hit = p; head = hb.head; }
    }
  }
  return { t: best, hit, head, axis: hit ? -1 : wall.axis };
}

// ---------------------------------------------------------------- granaty
// Fizyka lotu jest deterministyczna i wspólna: serwer liczy z niej miejsce wybuchu,
// klient – animację lotu (ten sam krok czasowy daje ten sam tor).
export const NADE = {
  grav: 20, step: 1 / 64, r: 0.07, fuse: 1.6, maxSpeed: 26, total: 4,
  heDmg: 100, heRadius: 9,
  smokeTime: 18, smokeRadius: 3.2,
  fireTime: 7, fireRadius: 3.2, fireDps: 32,
};

function nadeHit(x, y, z) {
  const r = NADE.r;
  if (y < r) return true;
  for (const b of MAP.boxes) {
    if (x > b.min[0] - r && x < b.max[0] + r && y > b.min[1] - r && y < b.max[1] + r && z > b.min[2] - r && z < b.max[2] + r) return true;
  }
  return false;
}

export function nadeState(o, v) {
  return { x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], t: 0, ground: false };
}

// Jeden krok symulacji; zwraca prędkość uderzenia (0 = bez kolizji).
export function nadeStep(s) {
  const dt = NADE.step;
  s.t += dt; s.vy -= NADE.grav * dt; s.ground = false;
  let impact = 0;
  for (const k of ['x', 'y', 'z']) {
    const vk = 'v' + k, prev = s[k];
    s[k] += s[vk] * dt;
    if (!nadeHit(s.x, s.y, s.z)) continue;
    s[k] = prev;
    const sp = Math.abs(s[vk]);
    if (k === 'y' && s[vk] < 0) {
      s.ground = true;
      const f = sp > 2 ? 0.7 : Math.max(0, 1 - 5 * dt);
      s.vx *= f; s.vz *= f;
      s.vy = sp > 2 ? sp * 0.4 : 0;
      if (sp > 2) impact = Math.max(impact, sp);
    } else {
      s[vk] = -s[vk] * 0.45;
      impact = Math.max(impact, sp);
    }
  }
  return impact;
}

export function nadeDone(s, g) {
  const kind = WEAPONS[g].nade;
  if (kind === 'smoke') return (s.t > 0.6 && Math.hypot(s.vx, s.vy, s.vz) < 0.2) || s.t > 6;
  if (kind === 'fire') return (s.ground && s.t > 0.05) || s.t > 2.2;
  return s.t >= NADE.fuse;
}

export function simNade(o, v, g) {
  const s = nadeState(o, v);
  while (!nadeDone(s, g)) nadeStep(s);
  return s;
}

