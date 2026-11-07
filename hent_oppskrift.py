#!/usr/bin/env python3
"""Hent en oppskrift fra en nettside og kopier den til utklippstavlen.

Bruk:
    python hent_oppskrift.py <lenke>            # kopierer JSON til utklippstavlen
    python hent_oppskrift.py <lenke> --print    # skriver JSON ut også

Lim deretter inn i appen: Middager -> «Importer».

Leser strukturerte data (schema.org/Recipe, JSON-LD) fra siden, så det virker på de
fleste oppskriftssider (testet på matprat.no). Bruker bare Python-standardbiblioteket.
Bruk det til privat bruk, og følg vilkårene til siden du henter fra.
"""
import argparse
import html
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request

UNITS = (r"(?:stk\.?|g|kg|dl|l|liter|ml|cl|ss|ts|msk|tsk|boks(?:er)?|pk\.?|pakke(?:r)?|pose(?:r)?|"
         r"neve|fedd|båt(?:er)?|stilk(?:er)?|klype|skive(?:r)?|bunt|glass|knippe|cm|porsjon(?:er)?)")
NUM = r"(?:\d+[.,]?\d*(?:\s*[-–]\s*\d+[.,]?\d*)?|\d+/\d+|[½¼¾⅓⅔])"
ING_RE = re.compile(rf"^\s*(?P<num>{NUM}(?:\s+{NUM})?)\s*(?P<unit>{UNITS})?(?=\s|$)\s*(?P<rest>.*)$", re.I)


def fetch(url):
    parts = urllib.parse.urlparse(url)
    if parts.scheme not in ("http", "https"):
        sys.exit("Lenken må starte med http:// eller https://")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hent_oppskrift)",
                                               "Accept-Language": "nb,no;q=0.9,en;q=0.5"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def find_recipe(node):
    """Search parsed JSON-LD (dict/list, possibly @graph) for a Recipe object."""
    if isinstance(node, list):
        for x in node:
            r = find_recipe(x)
            if r:
                return r
    elif isinstance(node, dict):
        t = node.get("@type")
        if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
            return node
        for v in node.values():
            if isinstance(v, (list, dict)):
                r = find_recipe(v)
                if r:
                    return r
    return None


def extract_recipe(page):
    for m in re.finditer(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, re.S | re.I):
        try:
            data = json.loads(m.group(1), strict=False)
        except ValueError:
            continue
        r = find_recipe(data)
        if r:
            return r
    return None


def clean(t):
    return re.sub(r"\s+", " ", html.unescape(str(t))).strip()


def steps_of(instr):
    out = []
    if isinstance(instr, str):
        return [clean(x) for x in re.split(r"\n+", instr) if clean(x)]
    for x in instr or []:
        if isinstance(x, str):
            out.append(clean(x))
        elif isinstance(x, dict):
            if "itemListElement" in x:
                out.extend(steps_of(x["itemListElement"]))
            elif x.get("text"):
                out.append(clean(x["text"]))
    return [s for s in out if s]


def parse_ingredient(raw):
    raw = clean(raw)
    m = ING_RE.match(raw)
    if not m or not m.group("rest"):
        return {"raw": raw, "qty": "", "text": raw}
    num = re.sub(r"\s+", " ", m.group("num")).strip()
    unit = (m.group("unit") or "").rstrip(".")
    qty = num if (not unit or unit.lower() == "stk") else f"{num} {unit}"
    return {"raw": raw, "qty": qty, "text": m.group("rest").strip()}


def minutes(iso):
    m = re.fullmatch(r"P(?:T(?:(\d+)H)?(?:(\d+)M)?)?", str(iso or ""))
    if not m or not (m.group(1) or m.group(2)):
        return ""
    total = int(m.group(1) or 0) * 60 + int(m.group(2) or 0)
    return f"{total // 60} t {total % 60} min" if total >= 60 and total % 60 else (f"{total // 60} t" if total >= 60 else f"{total} min")


def servings(y):
    if isinstance(y, list):
        y = next((v for v in y if v), "")
    return clean(y).lower()


def copy_to_clipboard(text):
    try:
        if sys.platform.startswith("win"):
            subprocess.run(["clip"], input=text.encode("utf-16"), check=True)   # BOM => clip reads Unicode
        elif sys.platform == "darwin":
            subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        else:
            for cmd in (["xclip", "-selection", "clipboard"], ["xsel", "-ib"], ["wl-copy"]):
                try:
                    subprocess.run(cmd, input=text.encode("utf-8"), check=True)
                    return True
                except (FileNotFoundError, subprocess.CalledProcessError):
                    continue
            return False
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def main():
    ap = argparse.ArgumentParser(description="Hent oppskrift fra en lenke og kopier den som JSON.")
    ap.add_argument("url")
    ap.add_argument("--print", action="store_true", help="skriv JSON til skjermen også")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    try:
        page = fetch(args.url)
    except Exception as e:  # network/HTTP errors
        sys.exit(f"Kunne ikke hente siden: {e}")
    r = extract_recipe(page)
    if not r:
        sys.exit("Fant ingen oppskrift (schema.org/Recipe) på denne siden.")

    out = {
        "format": "handleliste-oppskrift", "version": 1,
        "source": args.url,
        "name": clean(r.get("name", "")),
        "servings": servings(r.get("recipeYield")),
        "time": minutes(r.get("totalTime")),
        "ingredients": [parse_ingredient(x) for x in r.get("recipeIngredient", []) if clean(x)],
        "steps": steps_of(r.get("recipeInstructions")),
    }
    text = json.dumps(out, ensure_ascii=False, indent=1)
    ok = copy_to_clipboard(text)
    print(f"{out['name']}: {len(out['ingredients'])} ingredienser, {len(out['steps'])} steg.")
    if ok:
        print("Kopiert til utklippstavlen. Lim inn i appen: Middager -> Importer.")
    if args.print or not ok:
        print(text)


if __name__ == "__main__":
    main()
