// The item list in its three forms (Planlegg, Handle, Rediger) plus the page chrome that depends on the tab.
import { $, normName, esc, DAYS, cmpItems } from "./util.js";
import { setDoc, doc, db } from "./firebase.js";
import { items, products, meals, recipes, itemsSynced, groupNames, addItem, upd, toggleNeeded, toggleChecked, remove, batchOver } from "./store.js";
import { openState, mode, render, toast } from "./ui.js";
import { dragSort } from "./drag.js";
import { editState, selected, editCmp, dupPanel, updateBulk, saveGroupOrder, moveGroup, addGroup, renameGroup, deleteGroup,
  moveItem, moveItemToGroup } from "./edit-tools.js";
import { renderRecipes, renderMeals } from "./dinners.js";

export function renderApp() {
  const shop = mode === "shop", edit = mode === "edit";
  document.body.dataset.mode = mode;
  const q = $("search").value.trim().toLocaleLowerCase("nb");
  const hide = shop && $("hideDone").checked;

  const names = groupNames();
  const byCat = new Map(names.map((n) => [n, []]));
  items.forEach((it) => { if (it.mealId) { if (shop) byCat.get(it.mealCategory)?.push(it); } else byCat.get(it.category)?.push(it); });

  const neededCount = items.filter((i) => i.needed).length;
  $("shopCount").textContent = neededCount;
  $("tabPlan").classList.toggle("active", mode === "plan");
  $("tabShop").classList.toggle("active", shop);
  $("tabEdit").classList.toggle("active", edit);
  const recMode = mode === "recipes";
  const mealsMode = mode === "meals";
  $("tabRecipes").classList.toggle("active", recMode);
  $("search").placeholder = recMode ? "Søk i middager…" : edit ? "Søk i alle varer…" : "Søk eller legg til vare…";
  $("tabMeals").classList.toggle("active", mealsMode);
  $("clearMeals").classList.toggle("hidden", !mealsMode);
  $("clearNeeded").classList.toggle("hidden", mealsMode || recMode);
  $("search").classList.toggle("hidden", shop || mealsMode);
  $("hideDoneLbl").classList.toggle("hidden", !shop);
  $("finishShop").classList.toggle("hidden", !shop);
  $("uncheckAll").classList.toggle("hidden", !shop);

  if (mealsMode || recMode) { $("empty").classList.add("hidden"); $("seedBtn").classList.add("hidden"); (recMode ? renderRecipes : renderMeals)(); return; }

  $("editTools").classList.toggle("hidden", !edit);
  if (edit) {
    if (editState.filterCat && !names.includes(editState.filterCat)) editState.filterCat = "";
    $("fCat").innerHTML = `<option value="">Alle kategorier</option>` + names.map((n) => `<option ${n === editState.filterCat ? "selected" : ""}>${esc(n)}</option>`).join("");
    $("fNeeded").checked = editState.onlyNeeded; $("fSort").value = editState.sort;
    $("btnDups").classList.toggle("primary", editState.showDups);
    editState.visibleIds = [];
  }
  updateBulk();

  // An empty cache on a new device is not an empty list: offering the start list then would duplicate everything.
  $("seedBtn").classList.toggle("hidden", items.length > 0 || !itemsSynced);
  const empty = $("empty");
  empty.classList.toggle("hidden", !(items.length === 0 || (shop && neededCount === 0)));
  empty.textContent = items.length === 0
    ? (itemsSynced ? "Listen er tom. Åpne «⋯» og velg «Last inn startliste»." : "Henter listen…")
    : "Handlelisten er tom. Gå til «Planlegg» og trykk på varene du trenger.";

  const root = $("list");
  root.innerHTML = "";
  if (edit && editState.showDups) root.appendChild(dupPanel());
  if (mode === "plan" && q) { const p = addNewPanel(names); if (p) root.appendChild(p); }
  if (shop && neededCount) {
    const done = items.filter((i) => i.needed && i.checked).length;
    const p = document.createElement("div");
    p.className = "progress";
    p.innerHTML = `${done} av ${neededCount} i kurven<div class="bar"><i style="width:${Math.round(100 * done / neededCount)}%"></i></div>`;
    root.appendChild(p);
  }
  names.forEach((cat, gi) => {
    const all = byCat.get(cat);
    if (edit && editState.filterCat && cat !== editState.filterCat) return;
    let list = all.slice();
    if (edit && editState.onlyNeeded) list = list.filter((i) => i.needed);
    const need = all.filter((i) => i.needed).length;
    if (shop) list = list.filter((i) => i.needed);
    else if (q) list = list.filter((i) => i.text.toLocaleLowerCase("nb").includes(q));
    if (hide) list = list.filter((i) => !i.checked);
    if (!list.length && (shop || (q && !edit))) return;
    if (!list.length && edit && (q || editState.filterCat || editState.onlyNeeded)) return;
    list.sort(edit ? editCmp : cmpItems);
    if (edit) list.forEach((i) => editState.visibleIds.push(i.id));
    const reorderOff = !!q || !!editState.filterCat || editState.onlyNeeded || editState.sort !== "manual";

    const key = (shop ? "s:" : edit ? "e:" : "p:") + cat;
    const d = document.createElement("details");
    d.open = q ? true : (openState[key] ?? !edit);
    if (edit) d.dataset.id = cat;
    d.addEventListener("toggle", () => { if (q) return; openState[key] = d.open; localStorage.setItem("openCats", JSON.stringify(openState)); });
    const count = shop ? `${all.filter((i) => i.needed && !i.checked).length} igjen` : edit ? `${all.length}` : (need ? `${need} valgt` : "");
    const sum = document.createElement("summary");
    sum.innerHTML = edit
      ? `<input type="text" class="gname" value="${esc(cat)}" aria-label="Gruppenavn"><span class="count">${count}</span>`
      : `${esc(cat)}<span class="count">${count}</span>`;
    if (edit) {
      // rename right in the header, without expanding the group
      const nameInp = sum.querySelector("input");
      nameInp.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
      for (const ev of ["keydown", "keyup"]) nameInp.addEventListener(ev, (e) => e.stopPropagation());
      nameInp.addEventListener("change", () => renameGroup(cat, nameInp.value));
      const gripG = document.createElement("button");
      gripG.type = "button"; gripG.className = "grip"; gripG.textContent = "⠿";
      gripG.setAttribute("aria-label", "Dra for å flytte gruppen");
      gripG.disabled = !!q || !!editState.filterCat || editState.onlyNeeded;
      gripG.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
      gripG.addEventListener("pointerdown", (e) => dragSort(e, d, root, (ids) => saveGroupOrder(ids),
        () => { root.classList.add("dragging-groups"); return () => root.classList.remove("dragging-groups"); }));
      sum.prepend(gripG);
      for (const [label, dir] of [["▲", -1], ["▼", 1]]) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "ico"; b.textContent = label;
        b.setAttribute("aria-label", dir < 0 ? "Flytt gruppe opp" : "Flytt gruppe ned");
        b.disabled = (dir < 0 && gi === 0) || (dir > 0 && gi === names.length - 1);
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); moveGroup(names, gi, dir); });
        sum.appendChild(b);
      }
      const delB = document.createElement("button");
      delB.type = "button"; delB.className = "ico"; delB.textContent = "🗑";
      delB.setAttribute("aria-label", "Slett gruppe");
      delB.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); deleteGroup(cat, all.length); });
      sum.appendChild(delB);
    }
    d.appendChild(sum);

    const ul = document.createElement("ul");
    list.forEach((it, idx) => {
      const li = document.createElement("li");
      if (edit) {
        li.className = "edit";
        li.dataset.id = it.id;
        li.innerHTML = `<button class="grip" type="button" aria-label="Dra for å flytte">⠿</button><input class="sel" type="checkbox" ${selected.has(it.id) ? "checked" : ""} aria-label="Velg"><input class="t" type="text" value="${esc(it.text)}" aria-label="Varenavn">
          <select aria-label="Flytt til gruppe">${names.map((n) => `<option ${n === cat ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
          <button class="ico" type="button" aria-label="Opp">▲</button>
          <button class="ico" type="button" aria-label="Ned">▼</button>
          <button class="ico" type="button" aria-label="Slett">🗑</button>`;
        const [up, down, del] = li.querySelectorAll("button.ico");
        const grip = li.querySelector(".grip");
        grip.disabled = reorderOff;
        grip.addEventListener("pointerdown", (e) => {
          if (reorderOff) return;
          dragSort(e, li, ul, async (ids) => {
            const byId = new Map(list.map((i) => [i.id, i]));
            const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
            await batchOver(ordered, (b, i) => { const o = ordered.indexOf(i); if (i.order !== o) b.update(doc(db, "items", i.id), { order: o }); });
          });
        });
        up.disabled = reorderOff || idx === 0;
        down.disabled = reorderOff || idx === list.length - 1;
        const inp = li.querySelector("input.t");
        li.querySelector("input.sel").addEventListener("change", (e) => { e.target.checked ? selected.add(it.id) : selected.delete(it.id); updateBulk(); });
        inp.addEventListener("change", () => { const t = inp.value.trim(); if (t && t !== it.text) upd(it, { text: t }); else inp.value = it.text; });
        li.querySelector("select").addEventListener("change", (e) => moveItemToGroup(it, e.target.value));
        up.addEventListener("click", () => moveItem(list, idx, -1));
        down.addEventListener("click", () => moveItem(list, idx, 1));
        del.addEventListener("click", () => { if (confirm(`Slette «${it.text}» for godt?`)) remove(it); });
      } else {
        const on = shop ? it.checked : it.needed;
        li.className = shop ? (it.checked ? "done" : "") : (it.needed ? "need" : "");
        li.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} aria-label="${shop ? "I handlekurven" : "Trenger"}">
          <span class="txt">${esc(it.text)}${shop && it.qty ? `<span class="qtyb">${esc(it.qty)}</span>` : ""}${it.mealId ? `<span class="sub">${esc(DAYS[it.day] ?? "")} · ${esc(it.mealName || "")}</span>` : ""}</span>
          ${!shop && it.needed ? `<input class="qty" type="text" placeholder="antall" value="${esc(it.qty || "")}" aria-label="Antall (valgfritt)" autocomplete="off">` : ""}
          ${shop ? `<button class="x" aria-label="Fjern fra handlelisten">🗑</button>` : ""}`;
        const act = () => (shop ? toggleChecked(it) : toggleNeeded(it));
        li.querySelector("input").addEventListener("change", act);
        li.querySelector(".txt").addEventListener("click", act);
        const qi = li.querySelector("input.qty");
        if (qi) qi.addEventListener("change", () => upd(it, { qty: qi.value.trim() }));
        if (shop) li.querySelector(".x").addEventListener("click", () => {
          const { id, ...data } = it;
          if (it.mealId) remove(it); else upd(it, { needed: false, checked: false, qty: "" });
          toast(`«${it.text}» fjernet`, () => (it.mealId ? setDoc(doc(db, "items", id), data)
            : upd(it, { needed: true, checked: !!it.checked, qty: it.qty || "" })));
        });
      }
      ul.appendChild(li);
    });
    d.appendChild(ul);
    if (!shop) {
      const f = document.createElement("form");
      f.className = "add";
      f.innerHTML = `<input type="text" placeholder="Ny vare i ${esc(cat)}…" autocomplete="off" list="suggest"><button type="submit">+</button>`;
      f.addEventListener("submit", (e) => { e.preventDefault(); const inp = f.querySelector("input"); addItem(inp.value, cat, !edit); inp.value = ""; });
      d.appendChild(f);
    }
    root.appendChild(d);
  });

  const inCart = shop ? items.filter((i) => i.needed && i.checked).length : 0;
  if (inCart) {   // "Tøm handlelisten" (removes everything) lives in the ⋯ menu only
    const fb = document.createElement("button");
    fb.type = "button"; fb.className = "finishbtn primary";
    fb.textContent = `✓ Ferdig handlet (fjern ${inCart} avkryssede)`;
    fb.addEventListener("click", () => $("finishShop").click());
    root.appendChild(fb);
  }

  if (edit && !q) {
    const f = document.createElement("form");
    f.className = "newgroup";
    f.innerHTML = `<input type="text" placeholder="Ny gruppe…" autocomplete="off"><button class="primary" type="submit">Legg til gruppe</button>`;
    f.addEventListener("submit", (e) => { e.preventDefault(); const inp = f.querySelector("input"); addGroup(inp.value); inp.value = ""; });
    root.appendChild(f);
  }
}

// ---------- combined search / add (Planlegg) ----------
const findItem = (text) => { const n = normName(text); return n ? items.find((i) => !i.mealId && i.category && normName(i.text) === n) : null; };
const newItemCat = (names) => { const last = localStorage.getItem("lastNewCat"); return names.includes(last) ? last : names[0]; };
function addNew(text) {
  const names = groupNames();
  if (!names.length) return;
  addItem(text, newItemCat(names));
  toast(`«${text.trim()}» lagt på handlelisten`);
  $("search").value = "";
  render();
}
// Enter in the search field: put the matching item on the shopping list, or create it if it does not exist.
export function searchEnter() {
  const q = $("search").value.trim();
  if (mode !== "plan" || !q) return;
  const ex = findItem(q);
  if (!ex) { addNew(q); return; }
  if (!ex.needed) upd(ex, { needed: true, checked: false });
  toast(ex.needed ? `«${ex.text}» står allerede på handlelisten` : `«${ex.text}» lagt på handlelisten`);
  $("search").value = "";
  render();
}
// Shown above the filtered list while searching: create the item, or pick a product bought at Rema before.
function addNewPanel(names) {
  const q = $("search").value.trim(), ql = q.toLocaleLowerCase("nb");
  if (!names.length) return null;
  const have = new Set(items.map((i) => normName(i.text || "")));
  const seen = new Set();
  const prods = products.filter((p) => p.name && p.name.toLocaleLowerCase("nb").includes(ql))
    .sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, "nb"))
    .filter((p) => { const k = normName(p.name); if (!k || have.has(k) || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5);
  const exists = !!findItem(q);
  if (exists && !prods.length) return null;
  const box = document.createElement("div");
  box.className = "addnew";
  box.innerHTML = `<div class="sugg"><div class="newrow"><span>${exists ? "Forslag legges i:" : `Ny vare «${esc(q)}» i:`}</span>
    <select aria-label="Kategori">${names.map((n) => `<option>${esc(n)}</option>`).join("")}</select>
    ${exists ? "" : `<button type="button" class="primary">Legg til</button>`}</div></div>`;
  const sel = box.querySelector("select"), sugg = box.querySelector(".sugg");
  sel.value = newItemCat(names);
  sel.addEventListener("change", () => localStorage.setItem("lastNewCat", sel.value));
  box.querySelector("button")?.addEventListener("click", () => addNew(q));
  prods.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `＋ ${esc(p.name)} <span class="cat">kjøpt ${Number(p.count) || 1}×</span>`;
    b.addEventListener("click", () => addNew(p.name));
    sugg.appendChild(b);
  });
  return box;
}
