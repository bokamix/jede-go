# Jede CS

Przeglądarkowy multiplayer FPS w stylu CS:GO (Node.js + WebSocket + Three.js).

## Start

```bash
npm install
npm start          # http://localhost:3000  (PORT=xxxx npm start – inny port)
```

Znajomi w tej samej sieci wchodzą na adres LAN wypisany w konsoli serwera (np. `http://192.168.x.x:3000`).
Przez internet: wystaw port (router / `ngrok http 3000` / `cloudflared tunnel`).

## Zasady

- Terroryści vs Antyterroryści, mapa z bombsite'ami A i B.
- Rozgrzewka (respawn, $16000), dopóki w obu drużynach nie ma graczy; potem mecz do 8 wygranych rund.
- Freeze time 5 s, runda 1:55, zakupy przez 25 s. T podkłada bombę (E, 3,2 s), CT rozbraja (E, 5 s / 2,5 s z zestawem), bomba wybucha po 40 s.
- Ekonomia: start $800, wygrana $3250, przegrana $1900, frag $300 (AWP $100, nóż $1500), podłożenie +$300.
- Bronie: Glock, USP-S, Deagle, MAC-10, MP9, AK-47, M4A4, AWP (+ kamizelka, hełm, zestaw do rozbrajania). Headshot ×4.

## Sterowanie

WASD ruch · Spacja skok · C kucanie (w powietrzu = crouch-jump) · Shift cichy chód · LPM strzał · PPM luneta AWP / dźgnięcie nożem ·
R przeładowanie · 1/2/3, Q, kółko – zmiana broni · B sklep · E bomba · Tab wyniki · Y czat · Esc pauza (zmiana drużyny, czułość, głośność)

## Struktura

- `server.js` – serwer HTTP + WebSocket, autorytatywna logika rund, trafień (hitscan), bomby i ekonomii
- `public/shared.js` – mapa, bronie, stałe i raycasting (współdzielone przez serwer i klienta)
- `public/game.js` – klient: render 3D, ruch z kolizjami, strzelanie/odrzut, HUD, radar, dźwięki (WebAudio)
- `public/index.html` – HUD i menu
