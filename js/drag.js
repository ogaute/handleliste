import { render, setDragActive, clearPendingRender, safeRender } from "./ui.js";

// ---------- drag & drop reordering (pointer events: mouse + touch) ----------
// el: the dragged element, container: its parent; children with data-id take part.
// onDone(ids) gets the new id order; prep() may return an undo function (e.g. collapse groups while dragging).
export function dragSort(e, el, container, onDone, prep) {
  if (e.button != null && e.button > 0) return;
  e.preventDefault();
  // Moving a row in the DOM would release a capture held by its own grip, so capture on <html>
  // (never moves) and listen on window: pointer events keep arriving however fast you drag.
  const pid = e.pointerId, root = document.documentElement;
  try { root.setPointerCapture(pid); } catch {}
  setDragActive(true);
  const undo = prep?.();

  // Measure once. During the drag everything is arithmetic on cached sizes (no layout reads => no lag).
  const order = [...container.children].filter((c) => c.dataset.id);
  const rects = order.map((r) => r.getBoundingClientRect());
  const h = new Map(order.map((r, i) => [r, rects[i].height]));
  const gap = order.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
  const startTop = rects[0].top + window.scrollY;           // page coordinates of the first row
  const r0 = rects[order.indexOf(el)];
  const grab = Math.min(Math.max(e.clientY - r0.top, 0), r0.height);
  const hEl = h.get(el);
  let y = e.clientY, raf = 0;
  el.classList.add("dragging");
  el.style.willChange = "transform";

  const render1 = () => {
    raf = 0;
    const wantTop = y + window.scrollY - grab;               // where the dragged row should be (page coords)
    const center = wantTop + hEl / 2;
    // target slot = number of other rows whose midpoint is above the dragged row's center
    const others = order.filter((r) => r !== el);
    let pos = startTop, target = 0;
    for (const o of others) {
      if (pos + h.get(o) / 2 < center) target++;
      pos += h.get(o) + gap;
    }
    if (order.indexOf(el) !== target) {
      order.splice(order.indexOf(el), 1);
      order.splice(target, 0, el);
      if (target >= others.length) others[others.length - 1].after(el); else others[target].before(el);
    }
    let natural = startTop;
    for (const r of order) { if (r === el) break; natural += h.get(r) + gap; }
    el.style.transform = `translateY(${wantTop - natural}px)`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render1); };
  render1();

  const move = (ev) => { if (ev.pointerId !== pid) return; y = ev.clientY; schedule(); };
  const timer = setInterval(() => {            // auto-scroll near the edges
    if (y < 70) window.scrollBy(0, -14); else if (y > window.innerHeight - 70) window.scrollBy(0, 14); else return;
    schedule();
  }, 16);
  const finish = (save) => {
    clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    try { root.releasePointerCapture(pid); } catch {}
    el.classList.remove("dragging");
    el.style.transform = ""; el.style.willChange = "";
    const ids = order.map((c) => c.dataset.id);
    undo?.();
    setDragActive(false);
    clearPendingRender();
    // The local snapshot redraws right after the write; the timer only covers "nothing changed".
    if (save) { onDone(ids); setTimeout(safeRender, 300); } else render();
  };
  const up = (ev) => { if (ev.pointerId === pid) finish(true); }, cancel = (ev) => { if (ev.pointerId === pid) finish(false); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}
