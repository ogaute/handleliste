#!/usr/bin/env python3
"""Hent produkter du har handlet hos Rema 1000 og lag en JSON-fil med varer til forslag i appen.

Bruk:
    python hent_rema.py login     # første gang: logg inn (OAuth/PKCE) og lagre token lokalt
    python hent_rema.py hent      # hent kjøp og skriv rema_produkter.json

Dette bruker Remas PRIVATE API (reverse-engineeret, se gisten av HelgeSverre). Det er ikke
støttet av Rema og kan slutte å virke når appen oppdateres. Bruk det bare på egne data.

Oppsett: lag rema_config.json ved siden av skriptet (står i .gitignore):
    {
      "subscription_key": "<ocp-apim-subscription-key fra gisten>",
      "phone": "<ditt mobilnummer>",
      "app_version": "3.0.12 #110549"
    }
Token lagres i rema_token.json (også i .gitignore). Del aldri disse filene.
Bruker bare Python-standardbiblioteket.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, "rema_config.json")
TOKEN_FILE = os.path.join(HERE, "rema_token.json")
OUT_FILE = os.path.join(HERE, "rema_produkter.json")
CACHE_FILE = os.path.join(HERE, "rema_cache.json")   # varelinjer per kjøp, så en avbrutt kjøring kan fortsette

API = "https://api.rema.no"
AUTH_URL = "https://id.rema.no/authorization"
TOKEN_URL = "https://id.rema.no/token"
CLIENT_ID = "android-251010"
REDIRECT_URI = "https://ae-appen.appspot.com/redirect/redirect.html"


def make_ssl_context():
    """Standard sertifikatsjekk. api.rema.no sender en rotkjede som Pythons Windows-lager
    ikke alltid har (Sectigo R46), så bruk certifi eller SSL_CERT_FILE hvis tilgjengelig."""
    cafile = os.environ.get("SSL_CERT_FILE")
    if not cafile:
        try:
            import certifi
            cafile = certifi.where()
        except ImportError:
            pass
    return ssl.create_default_context(cafile=cafile)


SSL_CTX = make_ssl_context()


def ssl_hint(e):
    if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
        sys.exit("Sertifikatfeil mot Rema. Kjør: pip install certifi  (sjekken er ikke slått av).")
    raise e


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_private(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def config():
    cfg = load_json(CONFIG_FILE)
    if not cfg or not cfg.get("subscription_key"):
        sys.exit(f"Mangler {CONFIG_FILE} med subscription_key (se toppen av denne filen).")
    cfg["subscription_key"] = cfg["subscription_key"].strip().strip("<>\"' ")
    return cfg


def post_form(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Token-kall feilet: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as e:
        ssl_hint(e)


def store_token(tok):
    tok["obtained_at"] = int(time.time())
    old = load_json(TOKEN_FILE) or {}
    # Behold refresh_token hvis serveren ikke sender ny
    tok.setdefault("refresh_token", old.get("refresh_token"))
    save_private(TOKEN_FILE, tok)
    return tok


def login():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID, "response_type": "code", "scope": "all",
        "redirect_uri": REDIRECT_URI, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256"})
    print("Åpner nettleseren for innlogging hos Rema. Logg inn der.")
    print("Etter innlogging havner du på en side hos ae-appen.appspot.com.")
    print("Kopier HELE adressen fra adressefeltet (den inneholder ?code=...) og lim den inn her.\n")
    print(url + "\n")
    webbrowser.open(url)
    pasted = input("Lim inn adressen (eller bare code-verdien): ").strip()
    if pasted.startswith("http"):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(pasted).query)
        if qs.get("state", [state])[0] != state:
            sys.exit("state stemmer ikke, avbryter.")
        code = (qs.get("code") or [""])[0]
    else:
        code = pasted
    if not code:
        sys.exit("Fant ingen code i det du limte inn.")
    tok = post_form(TOKEN_URL, {
        "grant_type": "authorization_code", "client_id": CLIENT_ID, "code": code,
        "code_verifier": verifier, "redirect_uri": REDIRECT_URI})
    store_token(tok)
    print("Innlogging lagret i rema_token.json")


def access_token():
    tok = load_json(TOKEN_FILE)
    if not tok:
        sys.exit("Ikke innlogget. Kjør: python hent_rema.py login")
    expires_in = int(tok.get("expires_in") or 0)
    if expires_in and time.time() < tok.get("obtained_at", 0) + expires_in - 60:
        return tok["access_token"]
    if not tok.get("refresh_token"):
        sys.exit("Token utløpt og mangler refresh_token. Kjør: python hent_rema.py login")
    new = post_form(TOKEN_URL, {"grant_type": "refresh_token", "client_id": CLIENT_ID,
                                "refresh_token": tok["refresh_token"]})
    return store_token(new)["access_token"]


_device_id = None


def api_get(path, params=None):
    global _device_id
    cfg = config()
    if _device_id is None:
        _device_id = cfg.get("device_id") or str(uuid.uuid4())
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {
        "Authorization": "Bearer " + access_token(),
        "ocp-apim-subscription-key": cfg["subscription_key"],
        "x-platform": "android",
        "x-correlation-id": str(uuid.uuid4()),
        "x-device-id": _device_id,
        "x-mobile-nr": cfg.get("phone", ""),
        "x-app": "bella",
        "x-app-version": cfg.get("app_version", "3.0.12 #110549"),
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(1, 6):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                wait = int(e.headers.get("Retry-After") or 0) or 5 * attempt
            else:
                sys.exit(f"{path} feilet: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
        except urllib.error.URLError as e:
            ssl_hint(e)
            if attempt == 5:
                sys.exit(f"{path}: nettverksfeil etter 5 forsøk ({e.reason}). Kjør på nytt, det fortsetter der det stoppet.")
            wait = 5 * attempt
        except TimeoutError:
            if attempt == 5:
                sys.exit(f"{path}: tidsavbrudd etter 5 forsøk. Kjør på nytt, det fortsetter der det stoppet.")
            wait = 5 * attempt
        print(f"  midlertidig feil, prøver igjen om {wait}s ({attempt}/5) ...")
        time.sleep(wait)


def clean_name(row):
    name = (row.get("prodtxt1") or row.get("productDescription") or "").strip()
    return re.sub(r"\s+", " ", name)


def hent(max_kjop):
    heads = api_get("/v1/bella/transaction/v2/heads")
    transactions = heads.get("transactions", [])
    transactions.sort(key=lambda t: t.get("purchaseDate", 0), reverse=True)
    if max_kjop:
        transactions = transactions[:max_kjop]
    print(f"{len(transactions)} kjøp funnet, henter varelinjer ...")

    products = {}
    stats = defaultdict(lambda: {"count": 0, "last": 0, "price": None})
    cache = load_json(CACHE_FILE) or {}
    for n, t in enumerate(transactions, 1):
        tid = str(t["id"])
        if tid in cache:
            rows = cache[tid]
        else:
            rows = api_get(f"/v1/bella/transaction/v2/rows/{tid}")
            if isinstance(rows, dict):  # faktisk svar: {"rows": [...]} (gisten sier liste)
                rows = rows.get("rows", [])
            cache[tid] = rows
            save_private(CACHE_FILE, cache)
            time.sleep(0.5)  # vær snill mot serveren
        for row in rows if isinstance(rows, list) else []:
            name = clean_name(row)
            if not name:
                continue
            ean = (row.get("prodtxt3") or "").strip()
            key = ean if ean.isdigit() and len(ean) >= 8 else name.lower()
            products[key] = {"name": name, "ean": ean if key == ean else "",
                             "group": row.get("productGroupDescription") or ""}
            s = stats[key]
            s["count"] += 1
            when = t.get("purchaseDate", 0)
            if when >= s["last"]:
                s["last"] = when
                if isinstance(row.get("unitPrice"), (int, float)):
                    s["price"] = row["unitPrice"]   # pris fra siste kjøp
        if n % 10 == 0:
            print(f"  {n}/{len(transactions)}")

    out = []
    for key, p in products.items():
        s = stats[key]
        out.append({**p, "count": s["count"],
                    "lastBought": datetime.fromtimestamp(s["last"] / 1000, timezone.utc).strftime("%Y-%m-%d") if s["last"] else "",
                    "lastPrice": s["price"]})
    out.sort(key=lambda p: (-p["count"], p["name"]))
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Skrev {len(out)} produkter til {OUT_FILE}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    h = sub.add_parser("hent")
    h.add_argument("--max", type=int, default=0, help="Bare de siste N kjøpene (standard: alle)")
    a = ap.parse_args()
    login() if a.cmd == "login" else hent(a.max)


if __name__ == "__main__":
    main()
