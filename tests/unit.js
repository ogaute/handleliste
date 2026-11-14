// Unit tests for the pure helpers. No DOM and no Firebase involved.
import { normName, slug, esc, cmpItems, itemKey } from "../js/util.js";
import { matchItem, lev1, findDupGroups, freeCatId, validateBackup } from "../js/logic.js";

export function unit(ok) {
  ok("unit normName strips case, spaces and punctuation", normName(" Kjøtt-Deig 400g! ") === "kjøttdeig400g");
  ok("unit slug", slug("Kjøtt & fisk") === "kjøtt-fisk" && slug("!!!") === "gruppe");
  ok("unit esc", esc(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;" && esc(null) === "");
  ok("unit itemKey", itemKey({ category: "Meieri", text: "Melk " }) === "Meieri|melk");
  const sorted = [{ text: "b", order: 1 }, { text: "c", order: 0 }, { text: "a", order: 1 }].sort(cmpItems).map((x) => x.text).join("");
  ok("unit cmpItems: order, then name", sorted === "cab");

  ok("unit lev1", lev1("tomat", "tomat") && lev1("tomat", "tomater") === false && lev1("tomat", "tomt") && lev1("tomat", "tomar") && !lev1("ab", "ba"));

  const items = [
    { id: "1", text: "Melk", category: "Meieri" },
    { id: "2", text: "Smør", category: "Meieri" },
    { id: "3", text: "Kjøttdeig", category: "Kjøtt" },
    { id: "4", text: "Kjøtdeig", category: "Kjøtt" },
    { id: "5", text: "Melk", category: null, mealId: "dag-0" },
  ];
  const m1 = matchItem("kjøttdeig", items), m2 = matchItem("kokosmelk", items);
  ok("unit matchItem exact", m1?.exact === true && m1.item.id === "3");
  ok("unit matchItem similar is only a hint", m2?.exact === false && m2.item.text === "Melk");
  ok("unit matchItem none / short words", matchItem("koriander", items) === null && matchItem("is", items) === null);

  const dups = findDupGroups(items);
  ok("unit findDupGroups: near-identical names, dinner rows ignored", dups.length === 1 && dups[0].map((i) => i.id).sort().join() === "3,4");

  const used = new Set(["kjøtt-fisk"]);
  ok("unit freeCatId avoids taken ids", freeCatId("Kjøtt/fisk", used) === "kjøtt-fisk-2" && freeCatId("Kjøtt.fisk", used) === "kjøtt-fisk-3" && freeCatId("Brød", used) === "brød");

  const bk = (items2) => ({ collections: { items: items2, categories: [], meals: [], recipes: [] } });
  const good = { id: "a1", data: { text: "Melk", category: "Meieri", needed: false, checked: false, order: 0, createdAt: { __ts: [1, 2] } } };
  ok("unit validateBackup accepts a normal file", validateBackup(bk([good])).length === 0);
  ok("unit validateBackup accepts unsynced timestamp and unknown group", validateBackup(bk([{ id: "a2", data: { text: "x", category: "Finnes ikke", createdAt: null } }])).length === 0);
  ok("unit validateBackup rejects unknown field", validateBackup(bk([{ id: "a3", data: { text: "x", evil: 1 } }])).length === 1);
  ok("unit validateBackup rejects bad id and missing text", validateBackup(bk([{ id: "a/b", data: { text: "x" } }, { id: "ok", data: {} }])).length === 2);
  ok("unit validateBackup rejects unknown collection", validateBackup({ collections: { users: [] } }).length === 1);
}
