// Entry point: login, wiring of the fixed controls in index.html, and glue between the store and the views.
import { $ } from "./util.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, doc, serverTimestamp, auth,
  db, itemsCol } from "./firebase.js";
import { items, products, meals, recipes, itemsSynced, syncStatus, onStoreChange, subscribe, unsubscribeAll, batchOver } from "./store.js";
import { mode, setRenderer, render, onModeChange, setMode, safeRender } from "./ui.js";
import { updateSuggestions, importRema } from "./rema.js";
import { backupDownload, restoreFromFile } from "./backup.js";
import { editState, selected, bulkMove, bulkDelete } from "./edit-tools.js";
import { renderApp, searchEnter } from "./list-view.js";
import { newWeek } from "./dinners.js";

$("hideDone").checked = localStorage.getItem("hideDone") === "1";

// ---------- auth ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    subscribe();
    syncWakeLock();
  } else {
    unsubscribeAll();
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    syncWakeLock();
  }
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginErr").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    $("loginErr").textContent = "Feil e-post eller passord.";
  }
});
// Google sign-in: Google handles 2FA (if enabled on the account); Firestore rules still limit access to the two e-mails.
async function providerLogin(provider) {
  $("loginErr").textContent = "";
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const msgs = {
      "auth/popup-blocked": "Nettleseren blokkerte innloggingsvinduet. Tillat popup og prøv igjen.",
      "auth/account-exists-with-different-credential": "Denne e-posten er knyttet til en annen innloggingsmåte. Prøv Google eller e-post.",
      "auth/unauthorized-domain": "Domenet er ikke godkjent i Firebase (Authentication → Settings → Authorized domains).",
      "auth/operation-not-allowed": "Denne innloggingsmåten er ikke slått på i Firebase ennå."
    };
    if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(err.code)) return;
    $("loginErr").textContent = msgs[err.code] || ("Innlogging feilet (" + (err.code || err.message) + ").");
  }
}
$("googleBtn").addEventListener("click", () => providerLogin(new GoogleAuthProvider()));
$("logout").addEventListener("click", () => signOut(auth));

// Make failed writes visible (e.g. rules not published) instead of silently reverting.
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  alert("Kunne ikke lagre: " + (e.reason?.code || e.reason?.message || e.reason));
});

// ---------- UI wiring ----------
$("backupBtn").addEventListener("click", () => backupDownload().catch((e) => alert("Sikkerhetskopi feilet: " + e.message)));
$("restoreBtn").addEventListener("click", () => $("restoreFile").click());
$("restoreFile").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) restoreFromFile(f).catch((err) => alert("Gjenoppretting feilet: " + err.message));
});
$("remaBtn").addEventListener("click", () => $("remaFile").click());
$("remaFile").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) importRema(f).catch((err) => alert("Import feilet: " + err.message));
});
$("search").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); searchEnter(); } });
const setAllOpen = (open) => document.querySelectorAll("#list details").forEach((d) => { d.open = open; });
$("expandAll").addEventListener("click", () => setAllOpen(true));
$("collapseAll").addEventListener("click", () => setAllOpen(false));
$("menuBtn").addEventListener("click", () => $("menu").classList.toggle("hidden"));
$("hideDone").addEventListener("change", () => { localStorage.setItem("hideDone", $("hideDone").checked ? "1" : "0"); render(); });
// Keep the screen on while shopping (released automatically when the app is hidden, so re-request on return).
let wakeLock = null;
async function syncWakeLock() {
  const want = mode === "shop" && document.visibilityState === "visible" && !!auth.currentUser;
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      const l = wakeLock = await navigator.wakeLock.request("screen");
      l.addEventListener("release", () => { if (wakeLock === l) wakeLock = null; });
    } else if (!want && wakeLock) { const l = wakeLock; wakeLock = null; await l.release(); }
  } catch { wakeLock = null; }   // not supported, or refused (e.g. battery saver)
}
document.addEventListener("visibilitychange", syncWakeLock);
$("tabPlan").addEventListener("click", () => setMode("plan"));
$("tabShop").addEventListener("click", () => setMode("shop"));
$("tabEdit").addEventListener("click", () => setMode("edit"));
$("search").addEventListener("input", render);
$("fCat").addEventListener("change", (e) => { editState.filterCat = e.target.value; render(); });
$("fNeeded").addEventListener("change", (e) => { editState.onlyNeeded = e.target.checked; render(); });
$("fSort").addEventListener("change", (e) => { editState.sort = e.target.value; render(); });
$("btnDups").addEventListener("click", () => { editState.showDups = !editState.showDups; render(); });
$("btnSelAll").addEventListener("click", () => { editState.visibleIds.forEach((id) => selected.add(id)); render(); });
$("bulkMove").addEventListener("click", bulkMove);
$("bulkDel").addEventListener("click", bulkDelete);
$("bulkClear").addEventListener("click", () => { selected.clear(); render(); });
const bulk = (pred, data, msg) => {
  const l = items.filter(pred);
  $("menu").classList.add("hidden");
  // Ingredients that came from a dinner are deleted (not returned to the master list) when removed.
  if (l.length && confirm(msg(l.length))) batchOver(l, (b, it) =>
    (it.mealId && data.needed === false) ? b.delete(doc(db, "items", it.id)) : b.update(doc(db, "items", it.id), data.needed === false ? { ...data, qty: "" } : data));
};
// Done shopping: ticked items leave the shopping list (back to the master list, unticked)
$("finishShop").addEventListener("click", () => bulk((i) => i.needed && i.checked, { needed: false, checked: false }, (n) => `Fjerne ${n} avkryssede varer fra handlelisten?`));
$("uncheckAll").addEventListener("click", () => bulk((i) => i.needed && i.checked, { checked: false }, (n) => `Fjerne avkryssing på ${n} varer?`));
$("clearNeeded").addEventListener("click", () => bulk((i) => i.needed, { needed: false, checked: false }, (n) => `Tømme hele handlelisten (${n} varer)?`));
$("tabMeals").addEventListener("click", () => setMode("meals"));
$("tabRecipes").addEventListener("click", () => setMode("recipes"));
$("clearMeals").addEventListener("click", () => { $("menu").classList.add("hidden"); newWeek(); });
$("seedBtn").addEventListener("click", async () => {
  if (items.length || !itemsSynced) return;
  const seed = await (await fetch("seed.json")).json();
  const rows = [];
  seed.forEach((c) => c.items.forEach((it, i) => rows.push({ text: it.text, category: c.name, needed: false, checked: false, order: i })));
  await batchOver(rows, (b, r) => b.set(doc(itemsCol), { ...r, addedBy: "import", createdAt: serverTimestamp() }));
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

setRenderer(renderApp);
onModeChange(syncWakeLock);
onStoreChange((what) => {
  if (what === "items" || what === "status") {
    const st = $("status");
    st.textContent = syncStatus.text;
    st.className = "status " + syncStatus.cls;
  }
  if (what === "status") return;
  if (what === "items" || what === "products") updateSuggestions();
  if (what !== "products") safeRender();
});
