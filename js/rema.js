// Products bought at Rema 1000 (from hent_rema.py), used as suggestions for new items.
// Suggestions: products bought at Rema that are not already an item, most-bought first.
import { $, normName } from "./util.js";
import { setDoc, doc, serverTimestamp, productsCol } from "./firebase.js";
import { items, products, productDocIds, PRODUCTS_DOC, batchOver } from "./store.js";
import { toast } from "./ui.js";

export function updateSuggestions() {
  const dl = document.getElementById("suggest");
  if (!dl) return;
  const have = new Set(items.map((i) => normName(i.text || "")));
  const seen = new Set();
  const list = products.filter((p) => p.name).sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, "nb"))
    .filter((p) => { const k = normName(p.name); if (!k || have.has(k) || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 800);
  dl.replaceChildren(...list.map((p) => { const o = document.createElement("option"); o.value = p.name; return o; }));
}

// Replaces the product list. Everything is stored in ONE document (products/_all), so opening the app
// costs one read instead of one per product. Documents from the older one-per-product layout are removed.
export async function importRema(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data) || !data.every((p) => p && typeof p.name === "string")) throw new Error("Ikke en gyldig rema_produkter.json");
  const byName = new Map();   // the same product can appear with several EANs: add the counts together
  data.forEach((p) => {
    const k = normName(p.name);
    if (!k) return;
    const e = byName.get(k) || byName.set(k, { n: p.name.trim().slice(0, 200), c: 0 }).get(k);
    e.c += Number(p.count) || 1;
  });
  const list = [...byName.values()].sort((a, b) => b.c - a.c).slice(0, 5000);
  if (!list.length) throw new Error("Ingen produkter i filen");
  if (products.length && !confirm(`Erstatt ${products.length} eksisterende Rema-produkter med ${list.length} nye? Handlelisten påvirkes ikke.`)) return;
  const old = productDocIds.filter((id) => id !== PRODUCTS_DOC);
  // Firestore sends writes in the order they were made: the new list first, then the leftovers are deleted.
  const done = Promise.all([
    setDoc(doc(productsCol, PRODUCTS_DOC), { list, updatedAt: serverTimestamp() }),
    batchOver(old, (b, id) => b.delete(doc(productsCol, id))),
  ]);
  toast(`Importerte ${list.length} Rema-produkter`);
  await done;
}
