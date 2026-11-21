// Uke (week plan) and Middager (saved dinners), including recipe import.
import { $, normName, esc, DAYS } from "./util.js";
import { matchItem } from "./logic.js";
import { setDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp, auth, db, itemsCol, recipesCol } from "./firebase.js";
import { items, meals, recipes, groupNames, addItem, batchOver } from "./store.js";
import { openState, render, onModeChange, setMode, toast } from "./ui.js";

const openRecipes = new Set();   // expanded dinners; cleared whenever you leave/enter the tab
let importDraft = null;   // import panel state: {stage:'paste'|'preview', ...}
onModeChange(() => openRecipes.clear());
const mealRef = (day) => doc(db, "meals", "dag-" + day);
// Ingredients are {text, category}; tolerate plain strings.
const normIng = (list) => (list || []).map((x) => typeof x === "string" ? { text: x, category: groupNames()[0] } : x).filter((x) => x.text);
const mealIngredients = (m) => normIng(m.ingredients);
const mealItems = (m) => items.filter((i) => i.mealId === m.id);

async function saveMealName(day, name, m) {
  name = name.trim();
  if (!name) return;
  if (!m) { await setDoc(mealRef(day), { day, name, ingredients: [], planned: false }); return; }
  if (name === m.name) return;
  const b = writeBatch(db);
  b.update(mealRef(day), { name });
  mealItems(m).forEach((i) => b.update(doc(db, "items", i.id), { mealName: name }));
  await b.commit();
}
const setIngredients = (m, list) => updateDoc(mealRef(m.day), { ingredients: list });
async function deleteMeal(m) {
  if (!confirm(`Slette «${m.name}» fra ${DAYS[m.day].toLowerCase()}en?`)) return;
  const b = writeBatch(db);
  b.delete(mealRef(m.day));
  mealItems(m).forEach((i) => b.delete(doc(db, "items", i.id)));
  await b.commit();
}
// Done planning: every ingredient becomes its own shopping-list row (duplicates across dinners are kept).
async function finishMeal(m) {
  const list = mealIngredients(m);
  const b = writeBatch(db);
  const who = (auth.currentUser?.email || "").split("@")[0];
  list.forEach((ing) => {
    const master = items.find((i) => !i.mealId && i.category === ing.category && i.text === ing.text);
    b.set(doc(itemsCol), {
      text: ing.text, category: null, mealCategory: ing.category, mealId: m.id, mealName: m.name, day: m.day,
      needed: true, checked: false, qty: ing.qty || "", order: master?.order ?? 0, addedBy: who, createdAt: serverTimestamp()
    });
  });
  // Save to the dinner database: update the saved dinner if there is one, otherwise create it
  let rid = recipes.find((r) => r.id === m.recipeId)?.id || recipes.find((r) => normName(r.name) === normName(m.name))?.id;
  if (!rid) {
    const ref = doc(recipesCol);
    b.set(ref, { name: m.name, ingredients: list, recipe: "", createdAt: serverTimestamp() });
    rid = ref.id;
  } else b.update(recipeRef(rid), { name: m.name, ingredients: list });
  b.update(mealRef(m.day), { planned: true, recipeId: rid });
  await b.commit();
}
// Save only: store/update the dinner in the dinner database (Middager) without touching the shopping list.
async function saveMealOnly(m) {
  const list = mealIngredients(m);
  const ex = recipes.find((r) => r.id === m.recipeId) || recipes.find((r) => normName(r.name) === normName(m.name));
  const b = writeBatch(db);
  let rid;
  if (ex) { rid = ex.id; b.update(recipeRef(rid), { name: m.name, ingredients: list }); }
  else { const ref = doc(recipesCol); rid = ref.id; b.set(ref, { name: m.name, ingredients: list, recipe: "", createdAt: serverTimestamp() }); }
  b.update(mealRef(m.day), { recipeId: rid });
  toast(ex ? `«${m.name}» oppdatert i Middager` : `«${m.name}» lagret i Middager`);
  await b.commit();
}
async function reopenMeal(m) {
  const mine = mealItems(m);
  if (mine.length && !confirm(`Fjerne ${mine.length} ingredienser fra handlelisten og redigere «${m.name}»?`)) return;
  const b = writeBatch(db);
  mine.forEach((i) => b.delete(doc(db, "items", i.id)));
  b.update(mealRef(m.day), { planned: false });
  await b.commit();
}

// Search the existing item list (from the Planlegg tab) or create a new item in a chosen category.
function ingredientPicker(ing, save) {
  const wrap = document.createElement("div");
  wrap.className = "picker";
  const names = groupNames();
  wrap.innerHTML = `<input type="search" placeholder="Søk etter vare eller skriv ny…" autocomplete="off"><div class="sugg"></div>`;
  const inp = wrap.querySelector("input"), box = wrap.querySelector(".sugg");
  const has = (text, cat) => ing.some((x) => x.text.toLocaleLowerCase("nb") === text.toLocaleLowerCase("nb") && x.category === cat);
  const add = (text, cat, isNew) => {
    if (isNew) addItem(text, cat, false);   // becomes a permanent item, not on the shopping list yet
    return save([...ing, { text, category: cat }]);
  };
  const refresh = () => {
    const q = inp.value.trim(), ql = q.toLocaleLowerCase("nb");
    box.innerHTML = "";
    if (!q) return;
    const hits = items.filter((i) => !i.mealId && i.category && i.text.toLocaleLowerCase("nb").includes(ql) && !has(i.text, i.category))
      .sort((a, b) => a.text.localeCompare(b.text, "nb")).slice(0, 8);
    hits.forEach((i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `${esc(i.text)} <span class="cat">[${esc(i.category)}]</span>`;
      b.addEventListener("click", () => add(i.text, i.category, false));
      box.appendChild(b);
    });
    if (!items.some((i) => !i.mealId && i.text.toLocaleLowerCase("nb") === ql)) {
      const row = document.createElement("div");
      row.className = "newrow";
      row.innerHTML = `<span>Ny vare «${esc(q)}» i:</span><select aria-label="Kategori">${names.map((n) => `<option>${esc(n)}</option>`).join("")}</select><button type="button" class="primary">Legg til</button>`;
      const sel = row.querySelector("select");
      const last = localStorage.getItem("lastNewCat");
      if (names.includes(last)) sel.value = last;
      row.querySelector("button").addEventListener("click", () => { localStorage.setItem("lastNewCat", sel.value); add(q, sel.value, true); });
      box.appendChild(row);
    }
  };
  inp.addEventListener("input", refresh);
  return wrap;
}

// ---------- dinner database ----------
const recipeRef = (id) => doc(db, "recipes", id);
async function planRecipe(r, day, switchTab = true) {
  const old = meals.find((x) => x.day === day);
  if (old && !confirm(`${DAYS[day]} har allerede «${old.name}». Erstatte den?`)) return;
  const b = writeBatch(db);
  if (old) mealItems(old).forEach((i) => b.delete(doc(db, "items", i.id)));
  b.set(mealRef(day), { day, name: r.name, ingredients: normIng(r.ingredients), planned: false, recipeId: r.id });
  const done = b.commit();
  if (switchTab) setMode("meals");
  await done;
}
async function addRecipe(name) {
  name = name.trim();
  if (!name) return;
  const ex = recipes.find((r) => normName(r.name) === normName(name));
  if (ex) { openRecipes.add(ex.id); alert("Det finnes allerede en middag med det navnet."); render(); return; }
  const ref = doc(recipesCol);
  openRecipes.add(ref.id);
  await setDoc(ref, { name, ingredients: [], recipe: "", createdAt: serverTimestamp() });
}
async function deleteRecipe(r) {
  if (!confirm(`Slette «${r.name}» fra middagsdatabasen? Varer i varelisten beholdes.`)) return;
  await deleteDoc(recipeRef(r.id));
}

// ---------- import (from hent_oppskrift.py) ----------
function parseImport(raw) {
  let j;
  try { j = JSON.parse(raw.trim()); } catch { throw new Error("Det du limte inn er ikke gyldig JSON. Kjør hent_oppskrift.py og lim inn hele resultatet."); }
  if (j?.format !== "handleliste-oppskrift" || !Array.isArray(j.ingredients)) throw new Error("Dette ser ikke ut som en oppskrift fra hent_oppskrift.py.");
  const names = groupNames();
  const fallback = names.includes(localStorage.getItem("lastNewCat")) ? localStorage.getItem("lastNewCat") : names[0];
  const ingredients = j.ingredients.map((x) => {
    const text = String(x.text ?? x.raw ?? "").trim();
    const m = matchItem(text, items);
    return { qty: String(x.qty ?? ""), text: m?.exact ? m.item.text : text, category: m ? m.item.category : fallback };
  }).filter((x) => x.text);
  const meta = [j.servings, j.time].filter(Boolean).join(" · ");
  const steps = (Array.isArray(j.steps) ? j.steps : []).map((t, i) => `${i + 1}. ${t}`).join("\n");
  return { stage: "preview", name: String(j.name || ""), source: String(j.source || ""), steps: (meta ? meta + "\n\n" : "") + steps, ingredients };
}
async function saveImport() {
  const d = importDraft;
  const name = d.name.trim();
  if (!name) { alert("Gi middagen et navn."); return; }
  if (recipes.some((r) => normName(r.name) === normName(name)) && !confirm(`Det finnes allerede en middag som heter «${name}». Lagre likevel?`)) return;
  const existing = (x) => items.find((i) => !i.mealId && i.category === x.category && normName(i.text) === normName(x.text));
  const ings = d.ingredients.filter((x) => x.text.trim()).map((x) => ({ qty: x.qty.trim(), category: x.category, text: existing(x)?.text ?? x.text.trim() }));
  const seen = new Set();
  for (const x of ings) {                      // unknown ingredients become permanent items (not on the shopping list)
    const k = x.category + "|" + normName(x.text);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!existing(x)) addItem(x.text, x.category, false);
  }
  const ref = doc(recipesCol);
  openRecipes.add(ref.id);
  importDraft = null;
  render();
  await setDoc(ref, { name, ingredients: ings, recipe: d.steps, source: d.source, createdAt: serverTimestamp() });
}
function importPanel() {
  const box = document.createElement("div");
  box.className = "imp";
  const d = importDraft;
  if (d.stage === "paste") {
    box.innerHTML = `<h3>📥 Importer oppskrift</h3>
      <div class="hint">Kjør <code>python hent_oppskrift.py &lt;lenke&gt;</code> på maskinen. Resultatet kopieres til utklippstavlen. Lim det inn her.</div>
      <div class="pad"><textarea placeholder="Lim inn her…" aria-label="Importdata"></textarea>
      <div class="row"><button class="primary" type="button">Les inn</button><button type="button" class="link">Avbryt</button></div></div>`;
    const ta = box.querySelector("textarea");
    ta.value = d.raw;
    ta.addEventListener("input", () => { d.raw = ta.value; });
    const [go, cancel] = box.querySelectorAll("button");
    go.addEventListener("click", () => { try { importDraft = parseImport(ta.value); render(); } catch (e) { alert(e.message); } });
    cancel.addEventListener("click", () => { importDraft = null; render(); });
    return box;
  }
  const names = groupNames();
  box.innerHTML = `<h3>📥 Kontroller før lagring</h3>
    <div class="hint">Rett det som er feil. Varer som ikke finnes fra før, opprettes i valgt kategori.</div>
    <div class="pad"><input type="text" class="nm" aria-label="Navn på middag"></div>`;
  const nm = box.querySelector(".nm");
  nm.value = d.name;
  nm.addEventListener("input", () => { d.name = nm.value; });
  d.ingredients.forEach((x, idx) => {
    const row = document.createElement("div");
    row.className = "improw";
    row.innerHTML = `<input class="q" type="text" placeholder="antall" aria-label="Antall"><input class="t" type="text" aria-label="Vare">
      <select aria-label="Kategori">${names.map((n) => `<option ${n === x.category ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <span class="st"></span><button class="ico" type="button" aria-label="Fjern">🗑</button>`;
    const [q, t] = row.querySelectorAll("input"), sel = row.querySelector("select"), st = row.querySelector(".st");
    q.value = x.qty; t.value = x.text;
    const status = () => {
      const ex = items.some((i) => !i.mealId && i.category === x.category && normName(i.text) === normName(x.text));
      st.textContent = ex ? "✓ finnes" : "ny";
      st.className = "st" + (ex ? " ok" : "");
    };
    status();
    q.addEventListener("input", () => { x.qty = q.value; });
    t.addEventListener("input", () => { x.text = t.value; status(); });
    t.addEventListener("change", () => { const m = matchItem(x.text, items); if (m?.exact) { x.text = m.item.text; x.category = m.item.category; render(); } });
    sel.addEventListener("change", () => { x.category = sel.value; status(); });
    row.querySelector("button").addEventListener("click", () => { d.ingredients.splice(idx, 1); render(); });
    box.appendChild(row);
  });
  const rest = document.createElement("div");
  rest.className = "pad";
  rest.innerHTML = `<label class="hint" style="padding:0">Oppskrift</label><textarea aria-label="Oppskrift"></textarea>
    <div class="row"><button class="primary" type="button">Lagre middag</button><button type="button" class="link">Avbryt</button></div>`;
  const ta = rest.querySelector("textarea");
  ta.value = d.steps;
  ta.addEventListener("input", () => { d.steps = ta.value; });
  const [save, cancel] = rest.querySelectorAll("button");
  save.addEventListener("click", saveImport);
  cancel.addEventListener("click", () => { importDraft = null; render(); });
  box.appendChild(rest);
  return box;
}

export function renderRecipes() {
  const root = $("list");
  root.innerHTML = "";
  const q = $("search").value.trim().toLocaleLowerCase("nb");

  const nf = document.createElement("form");
  nf.className = "newrecipe";
  nf.innerHTML = `<input type="text" placeholder="Ny middag…" autocomplete="off"><button class="primary" type="submit">+</button>`;
  nf.addEventListener("submit", (e) => { e.preventDefault(); const inp = nf.querySelector("input"); addRecipe(inp.value); inp.value = ""; });
  root.appendChild(nf);
  if (importDraft) root.appendChild(importPanel());
  else {
    const ib = document.createElement("button");
    ib.type = "button"; ib.className = "importbtn"; ib.textContent = "📥 Importer oppskrift (fra hent_oppskrift.py)";
    ib.addEventListener("click", () => { importDraft = { stage: "paste", raw: "" }; render(); });
    root.appendChild(ib);
  }

  let list = recipes.slice().sort((a, b) => a.name.localeCompare(b.name, "nb"));
  if (q) list = list.filter((r) => r.name.toLocaleLowerCase("nb").includes(q) || normIng(r.ingredients).some((x) => x.text.toLocaleLowerCase("nb").includes(q)));
  if (!list.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = recipes.length ? "Ingen treff." : "Ingen lagrede middager ennå. Legg til en over, eller fullfør en middag i «Uke» så lagres den her.";
    root.appendChild(e);
    return;
  }

  list.forEach((r) => {
    const ing = normIng(r.ingredients);
    const d = document.createElement("details");
    d.open = q ? true : openRecipes.has(r.id);
    d.addEventListener("toggle", () => { if (q) return; d.open ? openRecipes.add(r.id) : openRecipes.delete(r.id); });
    const sum = document.createElement("summary");
    sum.innerHTML = `<input type="text" class="gname" value="${esc(r.name)}" aria-label="Navn på middag" autocomplete="off"><span class="count">${ing.length} varer${r.recipe?.trim() ? " · 📖" : ""}</span><button class="ico" type="button" aria-label="Slett middag">🗑</button>`;
    const nameInp = sum.querySelector("input");
    nameInp.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    for (const ev of ["keydown", "keyup"]) nameInp.addEventListener(ev, (e) => e.stopPropagation());
    nameInp.addEventListener("change", () => {
      const t = nameInp.value.trim();
      if (t && t !== r.name) updateDoc(recipeRef(r.id), { name: t }); else nameInp.value = r.name;
    });
    sum.querySelector("button").addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); deleteRecipe(r); });
    d.appendChild(sum);

    const save = (list2) => updateDoc(recipeRef(r.id), { ingredients: list2 });
    const ul = document.createElement("ul");
    ing.forEach((x, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="txt">${esc(x.text)}<span class="sub">${x.qty ? esc(x.qty) + " · " : ""}${esc(x.category)}</span></span><button class="x" aria-label="Fjern">🗑</button>`;
      li.querySelector(".x").addEventListener("click", () => save(ing.filter((_, k) => k !== idx)));
      ul.appendChild(li);
    });
    d.appendChild(ul);
    d.appendChild(ingredientPicker(ing, save));

    const body = document.createElement("div");
    body.className = "recipe-body";
    body.innerHTML = `<label>Oppskrift (lagres automatisk)</label><textarea placeholder="Skriv fremgangsmåten her…" aria-label="Oppskrift"></textarea>`;
    const ta = body.querySelector("textarea");
    ta.value = r.recipe || "";
    ta.addEventListener("change", () => updateDoc(recipeRef(r.id), { recipe: ta.value }));
    if (/^https?:\/\//.test(r.source || "")) {
      const a = document.createElement("a");
      a.href = r.source; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "🔗 Åpne original";
      body.appendChild(a);
    }
    d.appendChild(body);

    const pr = document.createElement("div");
    pr.className = "planrow";
    const firstFree = DAYS.findIndex((_, i) => !meals.some((m) => m.day === i));
    pr.innerHTML = `<select aria-label="Dag">${DAYS.map((n, i) => `<option value="${i}" ${i === Math.max(0, firstFree) ? "selected" : ""}>${n}</option>`).join("")}</select><button class="primary" type="button">📅 Planlegg på dag</button>`;
    pr.querySelector("button").addEventListener("click", () => planRecipe(r, +pr.querySelector("select").value));
    d.appendChild(pr);
    root.appendChild(d);
  });
}

// New week: clear the whole week plan, plus the dinner ingredients on the shopping list.
export async function newWeek() {
  if (!meals.length || !confirm("Starte ny uke? Hele ukeplanen tømmes, og ingredienser fra middagene fjernes også fra handlelisten.")) return;
  const refs = meals.map((m) => doc(db, "meals", m.id));
  items.filter((i) => i.mealId).forEach((i) => refs.push(doc(db, "items", i.id)));
  await batchOver(refs, (batch, ref) => batch.delete(ref));
}

export function renderMeals() {
  const root = $("list");
  root.innerHTML = "";
  DAYS.forEach((day, dayIdx) => {
    const m = meals.find((x) => x.day === dayIdx);
    const d = document.createElement("details");
    const key = "m:" + dayIdx;
    d.open = openState[key] ?? true;
    d.addEventListener("toggle", () => { openState[key] = d.open; localStorage.setItem("openCats", JSON.stringify(openState)); });
    const sum = document.createElement("summary");
    sum.innerHTML = `${esc(day)}<span class="count">${m ? esc(m.name) + (m.planned ? " ✓" : "") : ""}</span>`;
    d.appendChild(sum);

    const nf = document.createElement("form");
    nf.className = "meal-name";
    nf.innerHTML = `<input type="text" value="${esc(m?.name || "")}" placeholder="Middag på ${esc(day.toLowerCase())}…" aria-label="Navn på middag" autocomplete="off">` +
      (m ? `<button class="ico" type="button" aria-label="Slett middag">🗑</button>` : `<button class="primary" type="submit">+</button>`);
    nf.addEventListener("submit", (e) => { e.preventDefault(); saveMealName(dayIdx, nf.querySelector("input").value, m); });
    if (m) {
      nf.querySelector("input").addEventListener("change", (e) => saveMealName(dayIdx, e.target.value, m));
      nf.querySelector("button").addEventListener("click", () => deleteMeal(m));
    }
    d.appendChild(nf);

    if (!m && recipes.length) {
      const pr = document.createElement("div");
      pr.className = "planrow";
      pr.innerHTML = `<select aria-label="Velg lagret middag"><option value="">… eller velg en lagret middag</option>${recipes.slice().sort((a, b) => a.name.localeCompare(b.name, "nb")).map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>`;
      pr.querySelector("select").addEventListener("change", (e) => { const r = recipes.find((x) => x.id === e.target.value); if (r) planRecipe(r, dayIdx, false); });
      d.appendChild(pr);
    }

    if (m) {
      const ing = mealIngredients(m);
      const ul = document.createElement("ul");
      ing.forEach((x, idx) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="txt">${esc(x.text)}<span class="sub">${x.qty ? esc(x.qty) + " · " : ""}${esc(x.category)}</span></span>` + (m.planned ? "" : `<button class="x" aria-label="Fjern">🗑</button>`);
        if (!m.planned) li.querySelector(".x").addEventListener("click", () => setIngredients(m, ing.filter((_, k) => k !== idx)));
        ul.appendChild(li);
      });
      d.appendChild(ul);
      if (!m.planned) d.appendChild(ingredientPicker(ing, (l) => setIngredients(m, l)));
      const rec = recipes.find((r) => r.id === m.recipeId);
      if (rec?.recipe?.trim()) {
        const rd = document.createElement("details");
        rd.className = "inner";
        rd.innerHTML = `<summary>📖 Oppskrift</summary><div class="recipe-view">${esc(rec.recipe)}</div>`;
        if (/^https?:\/\//.test(rec.source || "")) {
          const a = document.createElement("a");
          a.href = rec.source; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "🔗 Åpne original";
          a.style.cssText = "display:block;padding:0 14px 10px;color:var(--accent)";
          rd.appendChild(a);
        }
        d.appendChild(rd);
      }
      const act = document.createElement("div");
      act.className = "meal-actions";
      if (m.planned) {
        act.innerHTML = `<button type="button">✏️ Rediger på nytt</button>`;
        act.querySelector("button").addEventListener("click", () => reopenMeal(m));
      } else {
        act.innerHTML = `<button class="primary save" type="button">💾 Lagre middag</button><button class="primary done" type="button" ${ing.length ? "" : "disabled"}>💾🛒 Lagre middag og legg i handlekurven</button>`;
        act.querySelector(".save").addEventListener("click", () => saveMealOnly(m));
        act.querySelector(".done").addEventListener("click", () => finishMeal(m));
      }
      d.appendChild(act);
    }
    root.appendChild(d);
  });
  const nw = document.createElement("button");
  nw.type = "button"; nw.className = "newweek"; nw.id = "newWeek"; nw.textContent = "🔄 Start ny uke";
  nw.disabled = !meals.length;
  nw.addEventListener("click", newWeek);
  root.appendChild(nw);
}
