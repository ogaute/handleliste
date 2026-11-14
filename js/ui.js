// Shared UI state and the single redraw entry point. The view layer registers its renderer here,
// so any module can call render() without importing the views.
import { $ } from "./util.js";

export const openState = JSON.parse(localStorage.getItem("openCats") || "{}");   // which groups are expanded, per tab
export let mode = ["shop", "edit", "meals", "recipes"].includes(localStorage.getItem("mode")) ? localStorage.getItem("mode") : "plan";

let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export function render() { renderer(); }

const modeHooks = [];
export const onModeChange = (fn) => { modeHooks.push(fn); };
export function setMode(m) {
  $("search").value = "";
  mode = m;
  localStorage.setItem("mode", m);
  modeHooks.forEach((fn) => fn(m));
  window.scrollTo(0, 0);
  render();
}

// Don't rebuild the page under someone who is typing, or in the middle of a drag.
let pendingRender = false;
let dragActive = false;
export const setDragActive = (v) => { dragActive = v; };
export const clearPendingRender = () => { pendingRender = false; };
export function safeRender() {
  if (dragActive) { pendingRender = true; return; }
  const a = document.activeElement;
  const typing = a && $("list").contains(a)
    && ((a.tagName === "INPUT" && (a.type === "text" || a.type === "search")) || a.tagName === "TEXTAREA")
    && (["edit", "meals", "recipes"].includes(mode) || a.classList.contains("qty") || a.value !== "");
  if (typing) { pendingRender = true; return; }
  render();
}
document.addEventListener("focusout", () => { if (pendingRender) { pendingRender = false; setTimeout(render, 50); } });

// With an undo function the toast gets an «Angre» button and stays a little longer.
let toastEl = null;
export function toast(msg, undo) {
  toastEl?.remove();
  const t = toastEl = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status");
  const s = document.createElement("span");
  s.textContent = msg;
  t.appendChild(s);
  if (undo) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "Angre";
    b.addEventListener("click", () => { t.remove(); undo(); });
    t.appendChild(b);
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), undo ? 6000 : 2200);
}
