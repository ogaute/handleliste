import { $ } from "./util.js";
import { BACKUP_COLS, validateBackup } from "./logic.js";
import { collection, getDocs, Timestamp, doc, db } from "./firebase.js";
import { batchOver } from "./store.js";
import { toast } from "./ui.js";

// ---------- backup / restore ----------
const encVal = (v) => v instanceof Timestamp ? { __ts: [v.seconds, v.nanoseconds] }
  : Array.isArray(v) ? v.map(encVal)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encVal(x)])) : v;
const decVal = (v) => v && typeof v === "object" && !Array.isArray(v)
  ? (v.__ts ? new Timestamp(v.__ts[0], v.__ts[1]) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decVal(x)])))
  : Array.isArray(v) ? v.map(decVal) : v;
export async function backupDownload() {
  const out = { format: "handleliste-backup", version: 1, exportedAt: new Date().toISOString(), collections: {} };
  for (const c of BACKUP_COLS) {
    const snap = await getDocs(collection(db, c));
    out.collections[c] = snap.docs.map((d) => ({ id: d.id, data: encVal(d.data()) }));
  }
  const n = Object.values(out.collections).reduce((a, l) => a + l.length, 0);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
  a.download = `handleliste-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Sikkerhetskopi lastet ned (${n} dokumenter)`);
}
export async function restoreFromFile(file) {
  if (file.size > 20 * 1024 * 1024) { alert("Filen er for stor."); return; }
  let j;
  try { j = JSON.parse(await file.text()); } catch { alert("Filen er ikke gyldig JSON."); return; }
  if (j?.format !== "handleliste-backup" || !j.collections) { alert("Dette er ikke en sikkerhetskopi fra Handleliste."); return; }
  const errs = validateBackup(j);
  if (errs.length) { alert("Filen er ikke gyldig og ble ikke gjenopprettet:\n\n• " + errs.join("\n• ")); return; }
  const all = BACKUP_COLS.flatMap((c) => (j.collections[c] || []).map((d) => ({ c, ...d })));
  if (!confirm(`Gjenopprette ${all.length} dokumenter fra ${j.exportedAt?.slice(0, 10) || "ukjent dato"}?

Eksisterende dokumenter med samme id overskrives. Dokumenter som er opprettet etter sikkerhetskopien blir liggende.`)) return;
  const done = batchOver(all, (b, d) => b.set(doc(db, d.c, d.id), decVal(d.data)));
  toast(`Gjenopprettet ${all.length} dokumenter`);
  await done;
}
