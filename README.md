# Handleliste

Shared shopping list with real-time sync. Static site on GitHub Pages + Firebase (Auth + Firestore).

## Setup

1. **Firebase console**
   - Build → **Authentication** → Sign-in method → enable **Email/Password**. Under Users, add two users (you and your wife).
   - Build → **Firestore Database** → create database (production mode, region `eur3` or `europe-west`).
   - **Rules** tab → paste `firestore.rules` (put in both e-mail addresses) → Publish.
   - Project settings → General → Your apps → add a **Web app** → copy the config into `firebase-config.js`.
   - Authentication → Settings → **Authorized domains** → add `ogaute.github.io`.
2. **GitHub**: push these files, then Settings → Pages → Deploy from branch `main` / root.
   The site will be at `https://ogaute.github.io/handleliste/`.
3. Open the site, log in, tap `⋯` → **Last inn startliste** (one-time import from `seed.json`).
4. On iPhone: Safari → Share → **Add to Home Screen**.

The Firebase web config is not a secret; the rules + login are what protect the data.

## Importere oppskrifter

Lokalt verktøy (kun Python, ingen installasjon):

```
python hent_oppskrift.py https://www.matprat.no/oppskrifter/gjester/pasta-bolognese/
```

Resultatet kopieres til utklippstavlen. I appen: **Middager → 📥 Importer**, lim inn, kontroller ingrediensene
(velg kategori for varer som ikke finnes fra før) og lagre. Virker på sider med strukturerte data (schema.org/Recipe).

## Innlogging med Google (2FA)

Appen støtter «Logg inn med Google». 2FA håndteres av Google (slå det på på selve kontoen).
Firestore-reglene sjekker at brukerens UID er en av dem i `firestore.rules` (UID finnes i Firebase-konsollen → Authentication → Users).

Firebase-konsollen → Authentication → Sign-in method:
- **Google**: slå på, velg support-e-post, lagre.
- Authorized domains skal inneholde `ogaute.github.io`.

Når Google-innlogging fungerer for begge kan du slå av **Email/Password** der, så passord-innlogging ikke lenger er mulig.

Siden reglene sjekker UID og ikke e-postadresse, kan ingen få tilgang ved å registrere en ny konto med en av adressene.

## Oppdatere Firebase-SDK

Versjonsnummeret står tre steder og må være likt: `js/firebase.js`, `SDK` i `sw.js` og importkartet i `tests/index.html`
(som lagrer SDK-filene slik at appen starter uten nett). Øk også `CACHE` i `sw.js`.

## Varer fra Rema 1000 (forslag)

Produkter du har handlet hos Rema kan brukes som forslag når du skriver en ny vare.
Bruker Remas **private** API via `hent_rema.py` (uoffisielt, kan slutte å virke, kun egne data).

1. Lag `rema_config.json` (står i `.gitignore`) med `subscription_key`, `phone` og `app_version`. Se toppen av `hent_rema.py`.
2. `pip install certifi` (trengs på Windows for sertifikatkjeden til api.rema.no).
3. `python hent_rema.py login` (én gang), deretter `python hent_rema.py hent` → `rema_produkter.json`.
4. Publiser oppdaterte `firestore.rules` (ny samling `products`).
5. I appen: `⋯` → **🛍 Importer Rema-produkter** → velg `rema_produkter.json`.

Forslagene vises som nedtrekksliste i «Legg til ny vare…» og i feltene per kategori. Varer som allerede finnes i listen foreslås ikke.

## Kodestruktur

Ingen byggesteg: `index.html` laster `js/app.js` som vanlige ES-moduler. En modul importerer bare fra dem som står over den her.

| Fil | Innhold |
| --- | --- |
| `js/util.js` | Små rene hjelpefunksjoner |
| `js/logic.js` | Ren logikk: varematching, duplikater, validering av sikkerhetskopi |
| `js/firebase.js` | Eneste fil som bruker Firebase-SDK-en |
| `js/store.js` | Dataene fra Firestore og alle felles skriveoperasjoner |
| `js/ui.js` | Felles UI-tilstand (aktiv fane), `render()` og toast |
| `js/drag.js` | Dra-og-slipp-sortering |
| `js/rema.js` | Rema-forslag og import |
| `js/backup.js` | Sikkerhetskopi og gjenoppretting |
| `js/edit-tools.js` | Rediger-fanen: filter, duplikater, flytting, grupper |
| `js/dinners.js` | Uke og Middager, inkludert oppskriftsimport |
| `js/list-view.js` | Varelisten i Planlegg, Handle og Rediger |
| `js/app.js` | Innlogging og kobling av knappene i `index.html` |

Nye filer i `js/` må legges til i `SHELL` i `sw.js` (og `CACHE` økes), ellers mangler de ved første start uten nett.

Skriv aldri `await` foran en Firestore-skriving før noe annet skal skje: uten nett blir løftet aldri ferdig.

## Kjøre lokalt

Appen må åpnes gjennom en webserver. Å åpne `index.html` rett fra disk virker ikke, fordi nettleseren da blokkerer skriptene.
Python har en innebygd server. Kjør dette i mappen der `index.html` ligger:

```
cd C:\Git\handleliste
python -m http.server 8123
```

La vinduet stå åpent mens du tester, og stopp serveren med `Ctrl+C`. Deretter kan du åpne:

| Adresse | Hva | Data |
| --- | --- | --- |
| `http://localhost:8123/tests/playground.html` | Lekeplass: hele appen, uten innlogging | Falske, ingenting lagres |
| `http://localhost:8123/tests/?suite=a` og `?suite=b` | Automatiske tester | Falske, ingenting lagres |
| `http://localhost:8123/` | Den ekte appen med Google-innlogging | **Ekte**: alt du endrer lagres |

Får du bare en filliste, ble serveren startet i feil mappe. Ser du en gammel versjon, last på nytt med `Ctrl+Shift+R`.

Den ekte appen på `localhost` krever at `http://localhost:8123` står i nettstedslisten til API-nøkkelen
(Google Cloud Console → APIs & Services → Credentials). Bruk derfor port 8123, eller legg inn porten du velger.
Lekeplassen og testene trenger ikke dette.

## Tester

Testene kjører i nettleseren mot en Firestore-etterligning i minnet (`tests/stub-firestore.js`), uten innlogging og uten å røre
de ekte dataene. Etterligningen oppfører seg som en frakoblet klient, så kode som venter på en skriving henger og testen feiler.

Start serveren som beskrevet over og åpne `http://localhost:8123/tests/?suite=a` og `http://localhost:8123/tests/?suite=b`.
Resultatet vises nede til høyre, og fanetittelen blir «OK» eller «FEIL».

### Lekeplass

`http://localhost:8123/tests/playground.html` starter hele appen på falske data (startlisten fra `seed.json` og et par
eksempelmiddager), uten innlogging. Ingenting lagres og de ekte dataene røres ikke. Last siden på nytt for å starte forfra.
Innlogging, sikkerhetsregler og synkronisering mellom enheter testes ikke her.
