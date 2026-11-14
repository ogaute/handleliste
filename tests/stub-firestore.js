// In-memory Firestore that behaves like an OFFLINE client: local snapshots fire, but write promises never
// settle. Code that waits for a write before doing the next thing therefore hangs here, as it would in a shop
// without coverage. The data is in window.__store: { collection: { id: fields } }.
const store = window.__store = { items: {}, categories: {}, meals: {}, recipes: {}, products: {} };
const subs = {};
const pending = {};
let n = 0;
const never = () => new Promise(() => {});
const snap = (c) => ({
  docs: Object.entries(store[c]).map(([id, d]) => ({ id, data: () => ({ ...d }) })),
  metadata: { fromCache: false, hasPendingWrites: false },
});
// one snapshot per collection per tick, like a real batch
const notify = (c) => {
  if (pending[c]) return;
  pending[c] = true;
  setTimeout(() => { pending[c] = false; (subs[c] || []).forEach((cb) => cb(snap(c))); }, 0);
};
const set = (r, d) => { store[r.col][r.id] = { ...d }; notify(r.col); };
const upd = (r, d) => {
  if (!store[r.col][r.id]) throw new Error("no document " + r.col + "/" + r.id);
  Object.assign(store[r.col][r.id], d); notify(r.col);
};
const del = (r) => { delete store[r.col][r.id]; notify(r.col); };

export class Timestamp { constructor(s, ns) { this.seconds = s; this.nanoseconds = ns; } }
export const initializeFirestore = () => ({}), persistentLocalCache = () => ({}), persistentMultipleTabManager = () => ({});
export const serverTimestamp = () => new Timestamp(Math.floor(Date.now() / 1000), 0);
export const collection = (db, name) => ({ col: name });
export const doc = (a, b, c) => (a.col ? { col: a.col, id: b || "auto" + (++n) } : { col: b, id: c });
export const onSnapshot = (ref, ...rest) => {
  (subs[ref.col] ||= []).push(rest.find((x) => typeof x === "function"));
  notify(ref.col);
  return () => {};
};
export const getDocs = async (ref) => snap(ref.col);
export const setDoc = (r, d) => { set(r, d); return never(); };
export const updateDoc = (r, d) => { upd(r, d); return never(); };
export const deleteDoc = (r) => { del(r); return never(); };
export const writeBatch = () => {
  const q = [];
  return {
    set: (r, d) => q.push(() => set(r, d)),
    update: (r, d) => q.push(() => upd(r, d)),
    delete: (r) => q.push(() => del(r)),
    commit: () => { q.forEach((f) => f()); return never(); },
  };
};
