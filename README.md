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
- Bronie: pistolety (Glock-18, USP-S, P250, Dual Berettas, Tec-9, Five-SeveN, Desert Eagle), SMG (MAC-10, MP9, UMP-45, MP7, P90), ciężkie (Nova, XM1014, Negev), karabiny (Galil AR, FAMAS, AK-47, M4A4, M4A1-S, SG 553, AUG, SSG 08, AWP) + kamizelka, hełm, zestaw do rozbrajania. Headshot ×4. Nagrody za fraga jak w CS (SMG $600, Nova $900, nóż $1500, AWP $100).
- Granaty (max 4): HE (do 100 obrażeń, nie przebija ścian), flashbang (oślepia zależnie od kąta patrzenia i odległości), dym (18 s, zasłania widok i radar, gasi ogień), mołotow T / granat zapalający CT (pożar 7 s, gaśnie w dymie).

## Sterowanie

WASD ruch · Spacja skok · C kucanie (w powietrzu = crouch-jump) · Shift cichy chód · LPM strzał · PPM luneta (AWP, SSG 08, AUG, SG 553) / dźgnięcie nożem ·
R przeładowanie · 1/2/3, Q, kółko – zmiana broni · 4 granaty (LPM rzut, PPM lekki rzut) · B sklep · E bomba · Tab wyniki · Y czat · Esc pauza (zmiana drużyny, czułość, głośność)

## Struktura

- `server.js` – serwer HTTP + WebSocket, autorytatywna logika rund, trafień (hitscan), bomby i ekonomii
- `public/shared.js` – mapa, bronie, stałe i raycasting (współdzielone przez serwer i klienta)
- `public/game.js` – klient: render 3D, ruch z kolizjami, strzelanie/odrzut, HUD, radar, dźwięki (WebAudio)
- `public/index.html` – HUD i menu
