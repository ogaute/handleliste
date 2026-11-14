// Pure logic that is easy to get wrong: matching, duplicate detection and backup validation.
// Everything here takes its data as arguments, so tests/ can exercise it without a browser session.
// Returns {item, exact}. Only an exact match may replace the ingredient; a similar item
// ("melk" inside "kokosmelk") is just a hint for which category to suggest.
import { $, slug, normName } from "./util.js";

export function matchItem(text, items) {
  const n = normName(text);
  if (!n) return null;
  const cands = items.filter((i) => !i.mealId && i.category);
  const exact = cands.find((i) => normName(i.text) === n);
  if (exact) return { item: exact, exact: true };
  let best = null;
  cands.forEach((i) => {
    const x = normName(i.text);
    if (x.length >= 4 && n.length >= 4 && (n.includes(x) || x.includes(n)) && (!best || x.length > normName(best.text).length)) best = i;
  });
  return best ? { item: best, exact: false } : null;
}
export function lev1(a, b) {   // true if edit distance <= 1
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
export function findDupGroups(items) {
  const list = items.filter((i) => !i.mealId && i.category).map((i) => ({ it: i, n: normName(i.text) })).filter((x) => x.n);
  const parent = list.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const x = list[a].n, y = list[b].n;
    if (x === y || (x.length >= 4 && y.length >= 4 && lev1(x, y))) parent[find(a)] = find(b);
  }
  const groups = new Map();
  list.forEach((x, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(x.it); });
  return [...groups.values()].filter((g) => g.length > 1);
}
// "Kjøtt & fisk" and "Kjøtt/fisk" give the same slug; never reuse an id that belongs to another group.
export function freeCatId(name, used) {
  let id = slug(name);
  for (let k = 2; used.has(id); k++) id = slug(name) + "-" + k;
  used.add(id);
  return id;
}
export const BACKUP_COLS = ["items", "categories", "meals", "recipes"];
export const BK = {
  str: (n) => (v) => typeof v === "string" && v.length <= n,
  num: (v) => Number.isFinite(v),
  bool: (v) => typeof v === "boolean",
  ts: (v) => v?.__ts && v.__ts.length === 2 && v.__ts.every(Number.isInteger),
};
export const bkOpt = (f) => (v) => v == null || f(v);
export const bkIng = (v) => typeof v === "string" ? v.length <= 300
  : v && typeof v === "object" && BK.str(300)(v.text) && (v.category == null || BK.str(100)(v.category)) && (v.qty == null || BK.str(100)(v.qty));
export const BK_SCHEMA = {
  items: { req: ["text"], f: { text: BK.str(300), category: bkOpt(BK.str(100)), needed: BK.bool, checked: BK.bool, order: BK.num, qty: BK.str(100),
    mealId: BK.str(100), mealName: BK.str(300), mealCategory: bkOpt(BK.str(100)), day: BK.num, addedBy: BK.str(100), createdAt: bkOpt(BK.ts) } },
  categories: { req: ["name"], f: { name: BK.str(100), order: BK.num } },
  meals: { req: ["name", "day"], f: { name: BK.str(300), day: (v) => Number.isInteger(v) && v >= 0 && v <= 6, planned: BK.bool, recipeId: bkOpt(BK.str(100)),
    ingredients: (v) => Array.isArray(v) && v.length <= 300 && v.every(bkIng) } },
  recipes: { req: ["name"], f: { name: BK.str(300), recipe: BK.str(50000), source: BK.str(2000), createdAt: bkOpt(BK.ts),
    ingredients: (v) => Array.isArray(v) && v.length <= 300 && v.every(bkIng) } },
};
// Returns a list of problems (empty = file is safe to restore). Nothing is written before this passes.
export function validateBackup(j) {
  const errs = [];
  const add = (m) => { if (errs.length < 12) errs.push(m); };
  if (!j || typeof j.collections !== "object" || Array.isArray(j.collections)) return ["Mangler «collections»."];
  Object.keys(j.collections).forEach((c) => { if (!BACKUP_COLS.includes(c)) add(`Ukjent samling «${c}».`); });
  let total = 0;
  for (const c of BACKUP_COLS) {
    const list = j.collections[c] ?? [];
    if (!Array.isArray(list)) { add(`«${c}» er ikke en liste.`); continue; }
    total += list.length;
    const sc = BK_SCHEMA[c], seen = new Set();
    list.forEach((d, n) => {
      const at = `${c} #${n + 1}`;
      if (!d || typeof d.id !== "string" || !/^[A-Za-z0-9æøåÆØÅ_-]{1,64}$/.test(d.id)) return add(`${at}: ugyldig id.`);
      if (seen.has(d.id)) add(`${at}: id «${d.id}» finnes to ganger.`);
      seen.add(d.id);
      const data = d.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return add(`${at}: mangler data.`);
      sc.req.forEach((k) => { if (data[k] === undefined) add(`${at}: mangler «${k}».`); });
      Object.entries(data).forEach(([k, v]) => {
        if (!sc.f[k]) add(`${at}: ukjent felt «${k}».`);
        else if (!sc.f[k](v)) add(`${at}: ugyldig verdi i «${k}».`);
      });
    });
  }
  if (total > 20000) add("For mange dokumenter (maks 20000).");
  return errs;
}
