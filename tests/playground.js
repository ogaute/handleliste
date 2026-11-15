// Fills the in-memory store with the start list (seed.json) plus a little sample data, then starts the app.
import "./stub-firestore.js";
import { Timestamp } from "./stub-firestore.js";
import { slug } from "../js/util.js";
import { mountApp } from "./mount.js";

const S = window.__store;
const seed = await (await fetch("../seed.json")).json();
let n = 0;
const used = new Set();
seed.forEach((c, order) => {
  let id = slug(c.name);
  while (used.has(id)) id += "-x";
  used.add(id);
  S.categories[id] = { name: c.name, order };
  c.items.forEach((it, i) => {
    S.items["seed" + (++n)] = {
      text: it.text, category: c.name, order: i, addedBy: "lekeplass", createdAt: new Timestamp(1700000000 + n, 0),
      needed: i < 2 && order < 4,          // a small shopping list to start with
      checked: i === 0 && order === 0, qty: i === 1 && order === 0 ? "2" : "",
    };
  });
});

// Two sample dinners built from whatever the start list contains, one of them planned on Tuesday.
const pick = (catIdx, itemIdx) => {
  const c = seed[catIdx % seed.length], it = c?.items[itemIdx % (c.items.length || 1)];
  return it ? { text: it.text, category: c.name } : null;
};
const ing = (...pairs) => pairs.map(([a, b]) => pick(a, b)).filter(Boolean);
S.recipes.demo1 = { name: "Eksempelmiddag", recipe: "1. Dette er en eksempeloppskrift.\n2. Endre den som du vil. Ingenting lagres.",
  ingredients: ing([0, 2], [1, 0], [2, 1]), createdAt: new Timestamp(1700000000, 0) };
S.recipes.demo2 = { name: "Rask hverdagsrett", recipe: "", ingredients: ing([0, 3], [3, 0]), createdAt: new Timestamp(1700000001, 0) };
S.meals["dag-1"] = { day: 1, name: "Eksempelmiddag", planned: false, recipeId: "demo1", ingredients: S.recipes.demo1.ingredients };

// Suggestions as they look after a Rema import.
S.products._all = { list: [["TACOSKJELL 12STK", 9], ["TACOSAUS MILD", 7], ["PIZZABUNN 2PK", 5], ["KOKOSMELK 400ML", 4], ["PEANØTTSMØR", 2]].map(([n2, c]) => ({ n: n2, c })) };

await mountApp();
const banner = document.createElement("div");
banner.id = "playBanner";
banner.textContent = "🧪 Lekeplass: falske data, ingenting lagres. Last siden på nytt for å starte forfra.";
document.body.prepend(banner);
