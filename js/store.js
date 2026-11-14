// Data layer: the live copies of the Firestore collections, and every write that is not specific to one view.
// Other modules read these arrays (live bindings) and are told about changes through onStoreChange().
import { slug } from "./util.js";
import { collection, onSnapshot, setDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp, auth, db, itemsCol, catsCol,
  mealsCol, recipesCol, productsCol } from "./firebase.js";

export let items = [];
export let products = [];      // bought at Rema (import via hent_rema.py); used for suggestions: [{name, count}]
export let productDocIds = []; // ids of the documents in the products collection (see rema.js)
export let cats = [];          // [{id, name, order}]
export let meals = [];         // [{id, day 0-6, name, ingredients[], planned}]
export let recipes = [];       // saved dinners: [{id, name, ingredients[], recipe}]
let itemsLoaded = false;
let catsLoaded = false;
export let itemsSynced = false;   // the server (not just the local cache) has answered for items
export let syncStatus = { text: "kobler til…", cls: "" };
let seedOrder = [];
const seedOrderReady = fetch("seed.json").then((r) => r.json()).then((s) => { seedOrder = s.map((c) => c.name); }).catch(() => {});

const listeners = [];
// fn(what) is called with "items" | "cats" | "meals" | "recipes" | "products" | "status"
export const onStoreChange = (fn) => { listeners.push(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export const PRODUCTS_DOC = "_all";   // all Rema products in one document: one read per app start instead of one per product
let unsubs = [];
function stopListening() { unsubs.forEach((u) => u()); unsubs = []; }
export function subscribe() {
  stopListening();
  const snapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const denied = (text) => (err) => { console.error(err); syncStatus = { text, cls: "off" }; emit("status"); };
  unsubs = [
    onSnapshot(productsCol, (snap) => {
      productDocIds = snap.docs.map((d) => d.id);
      products = snap.docs.flatMap((d) => d.id === PRODUCTS_DOC
        ? (d.data().list || []).map((p) => ({ name: p.n, count: p.c }))
        : [{ id: d.id, ...d.data() }]);   // older layout: one document per product
      emit("products");
    }, (err) => console.error("products:", err)),   // missing rules just means no suggestions
    onSnapshot(recipesCol, (snap) => { recipes = snapDocs(snap); emit("recipes"); },
      (err) => { console.error(err); alert("Ingen tilgang til middagsdatabasen – publiser oppdaterte regler (firestore.rules)."); }),
    onSnapshot(mealsCol, (snap) => { meals = snapDocs(snap); emit("meals"); },
      (err) => { console.error(err); alert("Ingen tilgang til middagsplanen – publiser oppdaterte regler (firestore.rules)."); }),
    onSnapshot(itemsCol, { includeMetadataChanges: true }, (snap) => {
      items = snapDocs(snap);
      itemsLoaded = true;
      if (!snap.metadata.fromCache) itemsSynced = true;
      const offline = snap.metadata.fromCache && !navigator.onLine;
      syncStatus = { text: offline ? "frakoblet" : (snap.metadata.hasPendingWrites ? "synker…" : "live"), cls: offline ? "off" : "on" };
      ensureCategories();
      emit("items");
    }, denied("ingen tilgang")),
    onSnapshot(catsCol, { includeMetadataChanges: true }, (snap) => {
      cats = snapDocs(snap).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      // Only trust "no groups yet" once the server has answered; an empty cache must not
      // trigger the first-run setup (it would overwrite a saved order with the seed order).
      catsLoaded = !snap.metadata.fromCache;
      ensureCategories();
      emit("cats");
    }, denied("ingen tilgang (publiser nye regler?)")),
  ];
}
// On logout: stop listening and forget the data.
export function unsubscribeAll() {
  stopListening();
  items = []; cats = []; meals = []; recipes = [];
  itemsLoaded = catsLoaded = itemsSynced = false;
}
let ensuring = false;
// First run after upgrade: create the group list from seed order + any categories used by items.
async function ensureCategories() {
  if (ensuring || !itemsLoaded || !catsLoaded || cats.length || !items.length) return;
  ensuring = true;
  try {
    await seedOrderReady;
    const names = [...seedOrder];
    items.forEach((i) => { if (i.category && !names.includes(i.category)) names.push(i.category); });
    await batchOver(names, (b, n) => {
      const id = slug(n);
      b.set(doc(catsCol, id), { name: n, order: names.indexOf(n) });
    });
  } catch (e) { console.error(e); } finally { ensuring = false; }
}

// Group names in display order (unknown item categories are appended)
export function groupNames() {
  const names = cats.map((c) => c.name);
  items.forEach((i) => { const c = i.mealId ? i.mealCategory : i.category; if (c && !names.includes(c)) names.push(c); });
  return names;
}

// NB: Firestore write promises only settle once the server has answered, i.e. never while offline.
// So never `await` a write before doing UI work or the next write. Fire it and let the snapshot
// listeners redraw. Failures still surface through the unhandledrejection handler above.
export function addItem(text, category, needed = true) {
  text = text.trim();
  if (!text) return;
  const inCat = items.filter((i) => i.category === category);
  const order = inCat.length ? Math.max(...inCat.map((i) => i.order ?? 0)) + 1 : 0;
  return setDoc(doc(itemsCol), {
    text, category, needed, checked: false, order,
    addedBy: (auth.currentUser?.email || "").split("@")[0],
    createdAt: serverTimestamp()
  });
}
// needed  = on the shopping list (chosen while planning)
// checked = in the cart (ticked while shopping; only meaningful when needed)
export const upd = (it, data) => updateDoc(doc(db, "items", it.id), data);
export const toggleNeeded = (it) => upd(it, { needed: !it.needed, checked: false, qty: "" });
export const toggleChecked = (it) => upd(it, { checked: !it.checked });
export const remove = (it) => deleteDoc(doc(db, "items", it.id));

// All chunks are queued at once (see NB above); the returned promise settles when the server has them all.
export function batchOver(list, fn) {
  const commits = [];
  for (let i = 0; i < list.length; i += 400) {
    const b = writeBatch(db);
    list.slice(i, i + 400).forEach((it) => fn(b, it));
    commits.push(b.commit());
  }
  return Promise.all(commits);
}
// Dinners keep their ingredients as {text, category} copies (in meals, recipes and dinner rows on the
// shopping list). Returns batch operations that rewrite the category wherever fn(ingredient) gives a new one.
export function recatOps(fn) {
  const ops = [];
  const remap = (list) => {
    let hit = false;
    const out = (list || []).map((x) => {
      const c = x && typeof x === "object" ? fn(x) : null;
      if (!c || c === x.category) return x;
      hit = true;
      return { ...x, category: c };
    });
    return hit ? out : null;
  };
  meals.forEach((m) => { const l = remap(m.ingredients); if (l) ops.push((b) => b.update(doc(db, "meals", m.id), { ingredients: l })); });
  recipes.forEach((r) => { const l = remap(r.ingredients); if (l) ops.push((b) => b.update(doc(db, "recipes", r.id), { ingredients: l })); });
  items.forEach((i) => {
    if (!i.mealId) return;
    const c = fn({ text: i.text, category: i.mealCategory });
    if (c && c !== i.mealCategory) ops.push((b) => b.update(doc(db, "items", i.id), { mealCategory: c }));
  });
  return ops;
}
export const runOps = (ops) => batchOver(ops, (b, op) => op(b));
