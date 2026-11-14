// Small pure helpers. No state, no Firebase.
export const $ = (id) => document.getElementById(id);
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-|-$/g, "") || "gruppe";
export const normName = (t) => t.toLocaleLowerCase("nb").replace(/[^a-z0-9æøå]/g, "");
export const itemKey = (x) => x.category + "|" + normName(x.text || "");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const DAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
export const tsOf = (i) => i.createdAt?.seconds ?? Infinity;   // pending (not yet synced) writes sort as newest
// Same order+text => duplicates (e.g. the same ingredient for two dinners) end up directly under each other.
export const cmpItems = (a, b) => ((a.order ?? 0) - (b.order ?? 0)) || a.text.localeCompare(b.text, "nb") || ((a.day ?? 0) - (b.day ?? 0));
