import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  MAP, WEAPONS, ITEMS, PLAYER, ROUND, DEFAULT_PISTOL, NADE, traceShot, traceMap, siteAt, simNade,
} from './public/shared.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------------------------------------------------------------- HTTP
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

// ---------------------------------------------------------------- stan gry
const clients = new Set();       // wszystkie połączenia
const players = new Map();       // id -> gracz (po dołączeniu)
let nextId = 1;

const game = {
  phase: 'warmup',   // warmup | freeze | live | end
  phaseEnd: 0,
  liveStart: 0,
  score: { T: 0, CT: 0 },
  round: 0,
  bomb: null,        // {state:'carried', carrier} | {state:'dropped'|'planted', x,y,z, site, explodeAt}
  matchOver: null,
  startAt: 0,        // odliczanie do startu meczu z rozgrzewki
};

// granaty w locie, aktywne dymy i pożary
let pendingNades = [], smokes = [], fires = [], nextFire = 1;

const now = () => Date.now();
const r2 = v => Math.round(v * 100) / 100;

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws !== except && ws.readyState === 1) ws.send(s);
}
const teamPlayers = team => [...players.values()].filter(p => p.team === team);
const alivePlayers = team => teamPlayers(team).filter(p => p.alive);

function sanitize(s, n) { return String(s || '').replace(/[<>&"']/g, '').trim().slice(0, n); }

function owns(p, w) { return w === 'knife' || p.prim === w || p.sec === w || p.nades[w] > 0; }
const nadeCount = p => Object.values(p.nades).reduce((a, b) => a + b, 0);

function spawnPlayer(p, idx) {
  const list = MAP.spawns[p.team];
  const s = list[idx % list.length];
  p.alive = true; p.hp = 100;
  p.x = s.x; p.y = 0; p.z = s.z; p.yaw = s.yaw; p.pitch = 0; p.crouch = false;
  p.use = null;
  if (!p.sec) p.sec = DEFAULT_PISTOL[p.team];
  p.wep = p.prim || p.sec;
  send(p.ws, { t: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw });
}

function stripPlayer(p) { p.prim = null; p.sec = null; p.armor = 0; p.helmet = false; p.kit = false; p.nades = {}; }

function warmupSpawn(p) {
  p.money = ROUND.maxMoney;
  const idx = Math.floor(Math.random() * MAP.spawns[p.team].length);
  spawnPlayer(p, idx);
}

function goWarmup() {
  game.phase = 'warmup'; game.bomb = null; game.startAt = 0; game.matchOver = null;
  game.score = { T: 0, CT: 0 }; game.round = 0;
  broadcast({ t: 'msg', text: 'Rozgrzewka – czekam na graczy w obu drużynach' });
  for (const p of players.values()) if (!p.alive) warmupSpawn(p);
}

function startMatch() {
  game.score = { T: 0, CT: 0 }; game.round = 0; game.matchOver = null;
  for (const p of players.values()) {
    stripPlayer(p); p.alive = false; p.money = ROUND.startMoney; p.kills = 0; p.deaths = 0;
  }
  broadcast({ t: 'msg', text: 'Mecz się rozpoczyna!', big: true });
  startRound();
}

function startRound() {
  game.round++;
  game.phase = 'freeze';
  game.phaseEnd = now() + ROUND.freeze * 1000;
  game.liveStart = game.phaseEnd;
  pendingNades = []; smokes = []; fires = [];
  for (const team of ['T', 'CT']) {
    teamPlayers(team).forEach((p, i) => {
      if (!p.alive) stripPlayer(p);
      spawnPlayer(p, i);
    });
  }
  const ts = teamPlayers('T');
  game.bomb = ts.length ? { state: 'carried', carrier: ts[Math.floor(Math.random() * ts.length)].id } : null;
  broadcast({ t: 'roundStart', round: game.round });
}

function endRound(winner, reason) {
  if (game.phase !== 'live') return;
  game.phase = 'end';
  game.phaseEnd = now() + ROUND.end * 1000;
  game.score[winner]++;
  for (const p of players.values()) {
    p.use = null;
    p.money = Math.min(ROUND.maxMoney, p.money + (p.team === winner ? ROUND.winMoney : ROUND.lossMoney));
  }
  broadcast({ t: 'roundEnd', winner, reason, score: game.score });
  if (game.score[winner] >= ROUND.winScore) {
    game.matchOver = winner;
    game.phaseEnd += 5000;
    broadcast({ t: 'matchEnd', winner, score: game.score });
  }
}

function checkElimination() {
  if (game.phase !== 'live') return;
  const t = alivePlayers('T').length, ct = alivePlayers('CT').length;
  const planted = game.bomb && game.bomb.state === 'planted';
  if (ct === 0) endRound('T', 'elim');
  else if (t === 0 && !planted) endRound('CT', 'elim');
}

function dropBomb(p) {
  if (game.bomb && game.bomb.state === 'carried' && game.bomb.carrier === p.id) {
    game.bomb = { state: 'dropped', x: p.x, y: p.y, z: p.z };
  }
}

function kill(victim, attacker, wep, hs) {
  victim.alive = false; victim.hp = 0; victim.deaths++; victim.use = null;
  dropBomb(victim);
  stripPlayer(victim);
  if (attacker && attacker !== victim) {
    if (attacker.team !== victim.team) {
      attacker.kills++;
      const reward = WEAPONS[wep]?.kill ?? ROUND.killMoney;
      if (game.phase !== 'warmup') attacker.money = Math.min(ROUND.maxMoney, attacker.money + reward);
    } else attacker.kills--;
  }
  broadcast({ t: 'kill', k: attacker ? attacker.id : null, v: victim.id, w: wep, hs: !!hs });
  if (game.phase === 'warmup') victim.respawnAt = now() + 3000;
  checkElimination();
}

function damage(victim, attacker, dmg, wep, hs, from) {
  if (!victim.alive) return;
  let hpDmg = dmg;
  const armored = victim.armor > 0 && (!hs || victim.helmet);
  if (armored && wep !== 'bomb' && WEAPONS[wep]?.nade !== 'fire') {
    hpDmg = Math.round(dmg * 0.55);
    victim.armor = Math.max(0, victim.armor - Math.round(dmg * 0.3));
  }
  victim.hp -= hpDmg;
  const src = from || attacker;
  send(victim.ws, { t: 'dmg', hp: Math.max(0, victim.hp), fx: src ? src.x : null, fz: src ? src.z : null });
  if (victim.hp <= 0) kill(victim, attacker, wep, hs);
}

function buyAllowed() {
  if (game.phase === 'warmup' || game.phase === 'freeze') return true;
  return game.phase === 'live' && now() < game.liveStart + ROUND.buyTime * 1000;
}

// ---------------------------------------------------------------- wiadomości
function onMessage(ws, msg) {
  const p = ws.player;
  switch (msg.t) {
    case 'join': {
      if (p) return;
      let team = msg.team;
      if (team !== 'T' && team !== 'CT') team = teamPlayers('T').length <= teamPlayers('CT').length ? 'T' : 'CT';
      const np = {
        id: nextId++, ws, name: sanitize(msg.name, 16) || `Gracz${nextId}`, team,
        alive: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, wep: 'knife',
        hp: 0, armor: 0, helmet: false, kit: false, money: ROUND.startMoney,
        prim: null, sec: null, nades: {}, kills: 0, deaths: 0, lastShot: 0, use: null, respawnAt: 0,
      };
      ws.player = np;
      players.set(np.id, np);
      send(ws, { t: 'joined', id: np.id, team });
      broadcast({ t: 'msg', text: `${np.name} dołącza do ${team === 'T' ? 'terrorystów' : 'antyterrorystów'}` });
      if (game.phase === 'warmup') warmupSpawn(np);
      else if (game.phase === 'freeze') spawnPlayer(np, teamPlayers(team).length - 1);
      break;
    }
    case 'team': {
      if (!p || (msg.team !== 'T' && msg.team !== 'CT') || msg.team === p.team) return;
      if (p.alive) { p.alive = false; dropBomb(p); }
      stripPlayer(p);
      p.team = msg.team;
      broadcast({ t: 'msg', text: `${p.name} zmienia drużynę na ${p.team}` });
      if (game.phase === 'warmup') warmupSpawn(p);
      checkElimination();
      break;
    }
    case 's': {
      if (!p || !p.alive) return;
      const lim = MAP.size + 1;
      if ([msg.x, msg.y, msg.z, msg.yw, msg.pt].some(v => typeof v !== 'number' || !isFinite(v))) return;
      p.x = Math.max(-lim, Math.min(lim, msg.x));
      p.y = Math.max(0, Math.min(20, msg.y));
      p.z = Math.max(-lim, Math.min(lim, msg.z));
      p.yaw = msg.yw; p.pitch = msg.pt; p.crouch = !!msg.c;
      if (WEAPONS[msg.w] && owns(p, msg.w)) p.wep = msg.w;
      break;
    }
    case 'shoot': {
      if (!p || !p.alive || game.phase === 'freeze') return;
      const w = WEAPONS[msg.w];
      if (!w || w.nade || !owns(p, msg.w)) return;
      const t = now();
      if (t - p.lastShot < w.rate * 1000 * 0.75) return;
      p.lastShot = t;
      const o = msg.o, dirs = w.pellets ? msg.ds : [msg.d];
      if (!Array.isArray(o) || o.length !== 3 || !Array.isArray(dirs) || !dirs.length || dirs.length > (w.pellets || 1)) return;
      if (!dirs.every(d => Array.isArray(d) && d.length === 3)) return;
      if (![...o, ...dirs.flat()].every(v => typeof v === 'number' && isFinite(v))) return;
      const eye = p.y + (p.crouch ? PLAYER.ceye : PLAYER.eye);
      if (Math.hypot(o[0] - p.x, o[1] - eye, o[2] - p.z) > 2.5) return;
      const range = w.knife ? w.range + 0.4 : 300;
      const others = [...players.values()].filter(q => q.alive && q.id !== p.id);
      const ends = [], hits = new Map();   // ofiara -> {dmg, head}
      let firstHit = 0, firstAxis = -1;
      for (const d of dirs) {
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        const dir = [d[0] / len, d[1] / len, d[2] / len];
        const res = traceShot(o, dir, range, others, p.id);
        ends.push([o[0] + dir[0] * res.t, o[1] + dir[1] * res.t, o[2] + dir[2] * res.t].map(r2));
        if (ends.length === 1) { firstHit = res.hit ? res.hit.id : 0; firstAxis = res.axis; }
        if (!res.hit || res.hit.team === p.team) continue;
        let dmg = w.dmg;
        if (res.head) dmg *= w.knife ? 1.5 : 4;
        if (w.knife && msg.alt) dmg = 65;
        if (w.pellets) dmg *= Math.max(0.2, Math.min(1, 1 - (res.t - 4) / 18));
        const h = hits.get(res.hit) || { dmg: 0, head: false };
        h.dmg += dmg; h.head ||= res.head;
        hits.set(res.hit, h);
      }
      broadcast({ t: 'shot', id: p.id, w: msg.w, o, e: ends[0], es: w.pellets ? ends : undefined, h: firstHit, ax: firstAxis }, ws);
      for (const [victim, h] of hits) {
        const dmg = Math.round(h.dmg);
        send(ws, { t: 'hitmark', hs: h.head, kill: victim.hp - dmg <= 0 });
        damage(victim, p, dmg, msg.w, h.head);
      }
      break;
    }
    case 'throw': {
      if (!p || !p.alive || game.phase === 'freeze') return;
      const w = WEAPONS[msg.g];
      if (!w || !w.nade || !(p.nades[msg.g] > 0)) return;
      const o = msg.o, v = msg.v;
      if (!Array.isArray(o) || !Array.isArray(v) || o.length !== 3 || v.length !== 3) return;
      if (![...o, ...v].every(x => typeof x === 'number' && isFinite(x))) return;
      const eye = p.y + (p.crouch ? PLAYER.ceye : PLAYER.eye);
      if (Math.hypot(o[0] - p.x, o[1] - eye, o[2] - p.z) > 2.5) return;
      const t = now();
      if (t - p.lastShot < 500) return;
      p.lastShot = t;
      const sp = Math.hypot(v[0], v[1], v[2]);
      if (sp > NADE.maxSpeed) for (let i = 0; i < 3; i++) v[i] *= NADE.maxSpeed / sp;
      if (--p.nades[msg.g] <= 0) delete p.nades[msg.g];
      const cid = Number(msg.cid) | 0;
      const end = simNade(o, v, msg.g);
      pendingNades.push({ g: msg.g, by: p.id, cid, at: t + end.t * 1000, x: end.x, y: end.y, z: end.z, ground: end.ground });
      broadcast({ t: 'nade', g: msg.g, by: p.id, cid, o, v });
      break;
    }
    case 'buy': {
      if (!p || !p.alive || !buyAllowed()) return;
      const w = WEAPONS[msg.item], it = ITEMS[msg.item];
      const def = w || it;
      if (!def || def.price == null) return;
      if (def.team && def.team !== p.team) return;
      if (p.money < def.price) return send(ws, { t: 'msg', text: 'Za mało kasy!' });
      if (w && w.nade) {
        if ((p.nades[msg.item] || 0) >= w.max) return send(ws, { t: 'msg', text: `Limit: ${w.name} ×${w.max}` });
        if (nadeCount(p) >= NADE.total) return send(ws, { t: 'msg', text: `Maksymalnie ${NADE.total} granaty` });
        p.nades[msg.item] = (p.nades[msg.item] || 0) + 1;
        send(ws, { t: 'give', w: msg.item, nade: true });
      } else if (w) {
        if (w.slot === 1) { if (p.prim === msg.item) return; p.prim = msg.item; }
        else { if (p.sec === msg.item) return; p.sec = msg.item; }
        p.wep = msg.item;
        send(ws, { t: 'give', w: msg.item });
      } else if (msg.item === 'vest') { if (p.armor >= 100) return; p.armor = 100; }
      else if (msg.item === 'vesthelm') { if (p.armor >= 100 && p.helmet) return; p.armor = 100; p.helmet = true; }
      else if (msg.item === 'kit') { if (p.kit) return; p.kit = true; }
      p.money -= def.price;
      break;
    }
    case 'useStart': {
      if (!p || !p.alive || game.phase !== 'live' || !game.bomb) return;
      const b = game.bomb;
      if (p.team === 'T' && b.state === 'carried' && b.carrier === p.id && siteAt(p.x, p.z)) {
        p.use = { type: 'plant', t0: now(), x: p.x, z: p.z };
      } else if (p.team === 'CT' && b.state === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) < 2) {
        p.use = { type: 'defuse', t0: now(), x: p.x, z: p.z };
      }
      break;
    }
    case 'useEnd': if (p) p.use = null; break;
    // głos: sygnalizacja WebRTC (serwer tylko przekazuje wiadomości między graczami)
    case 'rtc': {
      const to = players.get(msg.to);
      if (p && to && msg.data && typeof msg.data === 'object') send(to.ws, { t: 'rtc', from: p.id, data: msg.data });
      break;
    }
    case 'talk': if (p) broadcast({ t: 'talk', id: p.id, on: !!msg.on }); break;
    case 'chat': {
      const text = sanitize(msg.text, 120);
      if (p && text) broadcast({ t: 'chat', id: p.id, name: p.name, team: p.team, dead: !p.alive, text });
      break;
    }
  }
}

// ---------------------------------------------------------------- granaty
function sees(o, q, h) {
  const d = [q.x - o[0], q.y + h - o[1], q.z - o[2]];
  const dist = Math.hypot(...d);
  return traceMap(o, d.map(v => v / dist), dist).t >= dist - 0.05;
}
const inSmoke = (x, y, z) => smokes.some(s => Math.hypot(x - s.x, y - s.y, z - s.z) < NADE.smokeRadius + 0.5);

function detonate(n) {
  const kind = WEAPONS[n.g].nade, by = players.get(n.by) || null;
  const msg = { t: 'det', g: n.g, by: n.by, cid: n.cid, x: r2(n.x), y: r2(n.y), z: r2(n.z) };
  // granaty ranią wrogów i rzucającego (bez ognia przyjacielskiego, jak przy broni palnej)
  const target = q => q.alive && (!by || q === by || q.team !== by.team);
  if (kind === 'he') {
    const o = [n.x, n.y + 0.15, n.z];
    for (const q of players.values()) {
      if (!target(q)) continue;
      const d = Math.hypot(q.x - n.x, q.y + 0.9 - n.y, q.z - n.z);
      if (d > NADE.heRadius || !(sees(o, q, 1.0) || sees(o, q, 1.6) || sees(o, q, 0.2))) continue;
      const dmg = Math.round(NADE.heDmg * Math.pow(1 - d / NADE.heRadius, 1.3));
      if (dmg > 0) damage(q, by, dmg, n.g, false, n);
    }
  } else if (kind === 'smoke') {
    smokes.push({ x: n.x, y: n.y, z: n.z, until: now() + NADE.smokeTime * 1000 });
    for (const f of fires) {
      if (Math.hypot(f.x - n.x, f.z - n.z) < NADE.smokeRadius + NADE.fireRadius && Math.abs(f.y - n.y) < 3) f.until = 0;
    }
  } else if (kind === 'fire') {
    let y = n.y;
    if (!n.ground) y = n.y - traceMap([n.x, n.y, n.z], [0, -1, 0], 50).t;
    msg.y = r2(y);
    if (inSmoke(n.x, y, n.z)) msg.fizz = true;
    else {
      const f = { id: nextFire++, x: n.x, y, z: n.z, until: now() + NADE.fireTime * 1000, by: n.by, g: n.g, next: 0 };
      fires.push(f);
      msg.fid = f.id; msg.dur = NADE.fireTime * 1000;
    }
  }
  broadcast(msg);
}

function updateNades(t) {
  const due = pendingNades.filter(n => t >= n.at);
  if (due.length) { pendingNades = pendingNades.filter(n => t < n.at); due.forEach(detonate); }
  smokes = smokes.filter(s => t < s.until);
  for (const f of fires) {
    if (t >= f.until) { broadcast({ t: 'fireOut', id: f.id }); continue; }
    if (t < f.next) continue;
    f.next = t + 250;
    const by = players.get(f.by) || null;
    for (const q of players.values()) {
      if (!q.alive || (by && q !== by && q.team === by.team)) continue;
      if (Math.hypot(q.x - f.x, q.z - f.z) < NADE.fireRadius && q.y - f.y > -0.5 && q.y - f.y < 1.5) {
        damage(q, by, Math.round(NADE.fireDps / 4), f.g, false, f);
      }
    }
  }
  fires = fires.filter(f => t < f.until);
}

// ---------------------------------------------------------------- pętla
function tick() {
  const t = now();
  const tc = teamPlayers('T').length, ctc = teamPlayers('CT').length;

  if (game.phase === 'warmup') {
    if (tc >= 1 && ctc >= 1) {
      if (!game.startAt) {
        game.startAt = t + 10000;
        broadcast({ t: 'msg', text: 'Mecz startuje za 10 sekund', big: true });
      } else if (t >= game.startAt) startMatch();
    } else game.startAt = 0;
    for (const p of players.values()) if (!p.alive && p.respawnAt && t >= p.respawnAt) { p.respawnAt = 0; warmupSpawn(p); }
  } else {
    if (tc === 0 || ctc === 0) goWarmup();
    else if (game.phase === 'freeze' && t >= game.phaseEnd) {
      game.phase = 'live';
      game.phaseEnd = t + ROUND.live * 1000;
      game.liveStart = t;
      broadcast({ t: 'go' });
    } else if (game.phase === 'live') {
      const b = game.bomb;
      if (b && b.state === 'planted') {
        if (t >= b.explodeAt) {
          endRound('T', 'bomb');
          broadcast({ t: 'explode', x: b.x, y: b.y, z: b.z });
          game.bomb = { state: 'exploded', x: b.x, y: b.y, z: b.z };
          for (const p of players.values()) {
            if (!p.alive) continue;
            const d = Math.hypot(p.x - b.x, p.z - b.z);
            if (d < 25) damage(p, null, Math.round(500 * Math.pow(1 - d / 25, 1.5)), 'bomb', false);
          }
        }
      } else if (t >= game.phaseEnd) endRound('CT', 'time');
      // podnoszenie upuszczonej bomby
      if (game.bomb && game.bomb.state === 'dropped') {
        for (const p of alivePlayers('T')) {
          if (Math.hypot(p.x - game.bomb.x, p.z - game.bomb.z) < 1.2 && Math.abs(p.y - game.bomb.y) < 1.5) {
            game.bomb = { state: 'carried', carrier: p.id };
            send(p.ws, { t: 'msg', text: 'Podniosłeś bombę' });
            break;
          }
        }
      }
      // podkładanie / rozbrajanie
      for (const p of players.values()) {
        if (!p.use) continue;
        const b2 = game.bomb;
        if (!p.alive || Math.hypot(p.x - p.use.x, p.z - p.use.z) > 0.6 || game.phase !== 'live') { p.use = null; continue; }
        const need = p.use.type === 'plant' ? ROUND.plant : (p.kit ? ROUND.defuseKit : ROUND.defuse);
        if ((t - p.use.t0) / 1000 < need) continue;
        if (p.use.type === 'plant' && b2.state === 'carried' && b2.carrier === p.id) {
          const site = siteAt(p.x, p.z);
          game.bomb = { state: 'planted', x: p.x, y: p.y, z: p.z, site, explodeAt: t + ROUND.bomb * 1000 };
          p.money = Math.min(ROUND.maxMoney, p.money + ROUND.plantMoney);
          broadcast({ t: 'planted', site, x: p.x, y: p.y, z: p.z, name: p.name });
        } else if (p.use.type === 'defuse' && b2.state === 'planted') {
          game.bomb = { state: 'defused', x: b2.x, y: b2.y, z: b2.z };
          broadcast({ t: 'defused', name: p.name });
          endRound('CT', 'defuse');
        }
        p.use = null;
      }
    } else if (game.phase === 'end' && t >= game.phaseEnd) {
      if (game.matchOver) startMatch(); else startRound();
    }
  }

  updateNades(t);

  // snapshot
  const b = game.bomb;
  const snap = {
    t: 'snap',
    ph: game.phase,
    tl: game.phase === 'warmup' ? (game.startAt ? game.startAt - t : -1) : Math.max(0, game.phaseEnd - t),
    bt: buyAllowed() ? (game.phase === 'live' ? game.liveStart + ROUND.buyTime * 1000 - t : 1) : 0,
    sc: game.score, rn: game.round,
    b: b ? { s: b.state, c: b.carrier, x: r2(b.x ?? 0), y: r2(b.y ?? 0), z: r2(b.z ?? 0), tl: b.explodeAt ? Math.max(0, b.explodeAt - t) : 0 } : null,
    p: [...players.values()].map(p => {
      const need = p.use ? (p.use.type === 'plant' ? ROUND.plant : (p.kit ? ROUND.defuseKit : ROUND.defuse)) : 1;
      return {
        i: p.id, n: p.name, t: p.team, a: p.alive, x: r2(p.x), y: r2(p.y), z: r2(p.z),
        yw: r2(p.yaw), pt: r2(p.pitch), c: p.crouch, w: p.wep, hp: Math.max(0, p.hp), ar: p.armor, hm: p.helmet,
        m: p.money, k: p.kills, d: p.deaths, pr: p.prim, se: p.sec, kit: p.kit, gr: p.nades,
        u: p.use ? Math.min(1, (t - p.use.t0) / 1000 / need) : 0, ut: p.use ? p.use.type : null,
      };
    }),
  };
  broadcast(snap);
}

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  clients.add(ws);
  send(ws, { t: 'hello', urls: lanUrls(), players: players.size });
  ws.on('message', data => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.t === 'string') onMessage(ws, msg);
  });
  ws.on('close', () => {
    clients.delete(ws);
    const p = ws.player;
    if (p) {
      dropBomb(p);
      players.delete(p.id);
      broadcast({ t: 'left', id: p.id, text: `${p.name} wychodzi z gry` });
      checkElimination();
    }
  });
});

setInterval(tick, 50);
server.listen(PORT, () => {
  console.log(`Jede CS działa na http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  w sieci lokalnej: ${u}`);
});
