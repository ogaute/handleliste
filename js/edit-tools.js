// Rediger tab: filter/sort state, duplicate finder, bulk actions, and the group/item edit operations.
import { $, normName, itemKey, esc, tsOf, cmpItems } from "./util.js";
import { findDupGroups, freeCatId } from "./logic.js";
import { doc, writeBatch, db, catsCol } from "./firebase.js";
import { items, cats, groupNames, batchOver, recatOps, runOps } from "./store.js";
import { mode, render, clearPendingRender } from "./ui.js";

export const editState = { sort: "manual", filterCat: "", onlyNeeded: false, showDups: false, visibleIds: [] };
export const selected = new Set();   // ids ticked for bulk move/delete
export const editCmp = (a, b) => editState.sort === "az" ? a.text.localeCompare(b.text, "nb")
  : editState.sort === "new" ? (tsOf(b) - tsOf(a)) || a.text.localeCompare(b.text, "nb") : cmpItems(a, b);

async function mergeKeep(keep, others) {
  const b = writeBatch(db);
  others.forEach((o) => b.delete(doc(db, "items", o.id)));
  if (!keep.needed && others.some((o) => o.needed)) b.update(doc(db, "items", keep.id), { needed: true });
  await b.commit();
}
export function dupPanel() {
  const groups = findDupGroups(items);
  const box = document.createElement("div");
  box.className = "dups";
  box.innerHTML = `<h3>${groups.length ? `${groups.length} mulige duplikater` : "Ingen duplikater funnet 🎉"}<button type="button">Lukk</button></h3>`;
  box.querySelector("h3 button").addEventListener("click", () => { editState.showDups = false; render(); });
  groups.forEach((g) => {
    const gd = document.createElement("div");
    gd.className = "dupgroup";
    g.sort((a, b) => a.text.localeCompare(b.text, "nb")).forEach((it) => {
      const r = document.createElement("div");
      r.className = "duprow";
      r.innerHTML = `<span class="n">${esc(it.text)}</span><span class="c">[${esc(it.category)}]${it.needed ? " · på handlelisten" : ""}</span><button type="button">Behold</button>`;
      r.querySelector("button").addEventListener("click", () => {
        const others = g.filter((o) => o !== it);
        if (confirm(`Beholde «${it.text}» [${it.category}] og slette ${others.length} andre?`)) mergeKeep(it, others);
      });
      gd.appendChild(r);
    });
    box.appendChild(gd);
  });
  return box;
}
export function updateBulk() {
  const ids = new Set(items.map((i) => i.id));
  [...selected].forEach((id) => { if (!ids.has(id)) selected.delete(id); });
  const on = mode === "edit" && selected.size > 0;
  $("bulkBar").classList.toggle("hidden", !on);
  if (!on) return;
  $("bulkCount").textContent = `${selected.size} valgt`;
  const sel = $("bulkCat"), keep = sel.value, names = groupNames();
  sel.innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join("");
  if (names.includes(keep)) sel.value = keep;
}
export async function bulkMove() {
  const target = $("bulkCat").value;
  const moving = items.filter((i) => selected.has(i.id) && i.category !== target);
  if (!target || !moving.length) return;
  const inTarget = items.filter((i) => i.category === target);
  let order = inTarget.length ? Math.max(...inTarget.map((i) => i.order ?? 0)) + 1 : 0;
  const moved = new Set(moving.map(itemKey));
  const ops = moving.map((it) => { const o = order++; return (b) => b.update(doc(db, "items", it.id), { category: target, order: o }); });
  const done = runOps([...ops, ...recatOps((x) => (moved.has(itemKey(x)) ? target : null))]);
  selected.clear(); render();
  await done;
}
export async function bulkDelete() {
  const del = items.filter((i) => selected.has(i.id));
  if (!del.length || !confirm(`Slette ${del.length} varer for godt?`)) return;
  const done = batchOver(del, (b, it) => b.delete(doc(db, "items", it.id)));
  selected.clear(); render();
  await done;
}

// ---------- edit operations ----------
// Persist a full group order (rewrites order 0..n so there are never ties)
export async function saveGroupOrder(names) {
  const known = new Map(cats.map((c) => [c.name, c.id]));
  const used = new Set(cats.map((c) => c.id));
  await batchOver(names, (b, n) => {
    const id = known.get(n) || freeCatId(n, used);
    b.set(doc(catsCol, id), { name: n, order: names.indexOf(n) });
  });
}
export async function moveGroup(names, i, dir) {
  document.activeElement?.blur?.(); // so the page can redraw even if a text field had focus
  clearPendingRender();
  const j = i + dir;
  if (j < 0 || j >= names.length) return;
  const next = names.slice();
  [next[i], next[j]] = [next[j], next[i]];
  await saveGroupOrder(next);
}
export async function addGroup(name) {
  name = name.trim();
  if (!name) return;
  if (groupNames().some((n) => n.toLocaleLowerCase("nb") === name.toLocaleLowerCase("nb"))) { alert("Det finnes allerede en gruppe med det navnet."); return; }
  await saveGroupOrder([...groupNames(), name]);
}
export async function renameGroup(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) { render(); return; }
  if (groupNames().some((n) => n !== oldName && n.toLocaleLowerCase("nb") === newName.toLocaleLowerCase("nb"))) { alert("Det finnes allerede en gruppe med det navnet."); render(); return; }
  const c = cats.find((x) => x.name === oldName);
  const order = groupNames().indexOf(oldName);
  const ops = [(b) => b.set(doc(catsCol, c?.id || freeCatId(newName, new Set(cats.map((x) => x.id)))), { name: newName, order })];
  items.forEach((it) => { if (it.category === oldName) ops.push((b) => b.update(doc(db, "items", it.id), { category: newName })); });
  // dinners (week plan, saved dinners, dinner rows on the shopping list) carry their own copy of the group name
  ops.push(...recatOps((x) => (x.category === oldName ? newName : null)));
  await runOps(ops);
}
export async function deleteGroup(name, count) {
  if (count > 0) { alert(`«${name}» har ${count} varer. Flytt eller slett dem først.`); return; }
  // Dinner ingredients that still point at this group follow their item, or go to the first other group.
  const fallback = groupNames().find((n) => n !== name);
  const home = (x) => items.find((i) => !i.mealId && i.category && i.category !== name && normName(i.text) === normName(x.text))?.category || fallback;
  const ops = recatOps((x) => (x.category === name ? home(x) : null));
  if (ops.length && !fallback) { alert(`«${name}» brukes av middager og er den eneste gruppen.`); return; }
  if (!confirm(`Slette gruppen «${name}»?` + (ops.length ? `\n\nMiddagsingredienser som ligger i gruppen flyttes til gruppen varen ligger i nå (ellers «${fallback}»).` : ""))) return;
  const c = cats.find((x) => x.name === name);
  if (c) ops.push((b) => b.delete(doc(catsCol, c.id)));
  await runOps(ops);
}
// Items: rewrite order 0..n for a group's list so swaps are stable
export async function moveItem(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  await batchOver(next, (b, it) => { const o = next.indexOf(it); if (it.order !== o) b.update(doc(db, "items", it.id), { order: o }); });
}
export async function moveItemToGroup(it, group) {
  if (group === it.category) return;
  const inTarget = items.filter((i) => i.category === group);
  const order = inTarget.length ? Math.max(...inTarget.map((i) => i.order ?? 0)) + 1 : 0;
  const key = itemKey(it);
  await runOps([(b) => b.update(doc(db, "items", it.id), { category: group, order }), ...recatOps((x) => (itemKey(x) === key ? group : null))]);
}
