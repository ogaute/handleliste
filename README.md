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
