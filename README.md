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
Firestore-reglene sjekker fortsatt at e-postadressen er en av de to i `firestore.rules`.

Firebase-konsollen → Authentication → Sign-in method:
- **Google**: slå på, velg support-e-post, lagre.
- Authorized domains skal inneholde `ogaute.github.io`.

Når Google-innlogging fungerer for begge kan du slå av **Email/Password** der, så passord-innlogging ikke lenger er mulig.

Reglene krever `email_verified`. Google-innlogging er alltid verifisert. En e-post/passord-konto må ha bekreftet
e-postadressen for å få tilgang, så ingen kan registrere seg selv med en av de to adressene.

## Oppdatere Firebase-SDK

Versjonsnummeret står to steder og må være likt: importene øverst i skriptet i `index.html` og `SDK` i `sw.js`
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
