// Test runner. Open tests/ through a local web server (python -m http.server), then:
//   tests/?suite=a   list, shopping and edit flows
//   tests/?suite=b   dinners, import, backup and Rema import
// The unit tests of js/util.js and js/logic.js run in both.
import "./stub-firestore.js";
import { updateDoc } from "./stub-firestore.js";
import { unit } from "./unit.js";
import { mountApp } from "./mount.js";

const suite = new URLSearchParams(location.search).get("suite") === "b" ? "b" : "a";
const S = window.__store, $ = (id) => document.getElementById(id);
const out = [], errs = [];
let failed = 0;
const ok = (name, cond) => { if (!cond) failed++; out.push((cond ? "PASS " : "FAIL ") + name); };
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
window.alert = (m) => errs.push("alert: " + m);
window.confirm = () => true;
window.addEventListener("error", (e) => errs.push("error: " + e.message));
window.addEventListener("unhandledrejection", (e) => errs.push("rejection: " + (e.reason?.message || e.reason)));

const t = {
  S, $, ok, wait, updateDoc,
  vals: (c) => Object.values(S[c]),
  type: async (v) => { $("search").value = v; $("search").dispatchEvent(new Event("input")); await wait(); },
  enter: async () => { $("search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true })); await wait(); },
  // put a file in a hidden <input type=file> and fire its change event
  pick: async (inputId, name, json, ms = 300) => {
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(json)], name, { type: "application/json" }));
    $(inputId).files = dt.files;
    $(inputId).dispatchEvent(new Event("change"));
    await wait(ms);
  },
};

try {
  unit(ok);
  const mod = await import(`./smoke-${suite}.js`);
  // start from default view settings (only the app's own keys: the page may share an origin with the real app)
  ["mode", "openCats", "hideDone", "lastNewCat"].forEach((k) => localStorage.removeItem(k));
  mod.seed(S);
  await mountApp();
  await wait(200);
  await mod.run(t);
} catch (e) { errs.push("EXCEPTION " + (e.stack || e)); }

const pre = document.createElement("pre");
pre.id = "testout";
pre.textContent = `\nsuite ${suite}: ${out.length - failed} passed, ${failed} failed\n` + out.join("\n") + "\nERRORS: " + JSON.stringify(errs) + "\nEND\n";
const link = document.createElement("a");
link.href = "?suite=" + (suite === "a" ? "b" : "a");
link.textContent = "kjør suite " + (suite === "a" ? "b" : "a");
pre.appendChild(link);
document.body.appendChild(pre);
document.title = (failed || errs.length ? "FEIL" : "OK") + " – Handleliste tester";
