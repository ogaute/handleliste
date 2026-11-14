// Suite a: search/add, shopping view, group rename/delete, bulk move. All while "offline" (see stub-firestore.js).
export function seed(S) {
  Object.assign(S.categories, { frukt: { name: "Frukt", order: 0 }, meieri: { name: "Meieri", order: 1 } });
  Object.assign(S.items, {
    i1: { text: "Melk", category: "Meieri", needed: false, checked: false, order: 0 },
    i2: { text: "Eple", category: "Frukt", needed: true, checked: true, order: 0 },
    i3: { text: "Banan", category: "Frukt", needed: true, checked: false, order: 1 },
    m1: { text: "Fløte", category: null, mealCategory: "Meieri", mealId: "dag-0", mealName: "Suppe", day: 0, needed: true, checked: false, order: 0 },
  });
  S.meals["dag-0"] = { day: 0, name: "Suppe", planned: true, recipeId: "r1", ingredients: [{ text: "Fløte", category: "Meieri" }] };
  S.recipes.r1 = { name: "Suppe", recipe: "", ingredients: [{ text: "Fløte", category: "Meieri" }, { text: "Melk", category: "Meieri" }] };
  S.products._all = { list: [{ n: "OSTEPOP 100G", c: 4 }] };
  S.products.p2 = { name: "OSTEHØVEL", count: 1 };   // older one-document-per-product layout
}

export async function run({ S, $, ok, wait, type, enter, vals, updateDoc }) {
  const q = (sel) => document.querySelector(sel), qa = (sel) => [...document.querySelectorAll(sel)];
  $("tabPlan").click(); await wait();
  ok("status shows live", $("status").textContent === "live" && $("status").className === "status on");

  // combined search / add
  await type("oste");
  ok("add panel shown for unknown item", !!q(".addnew .newrow button.primary"));
  const sugg = qa(".addnew .sugg > button").map((b) => b.textContent);
  ok("rema suggestions from both product layouts", sugg.some((s) => s.includes("OSTEPOP") && s.includes("4×")) && sugg.some((s) => s.includes("OSTEHØVEL")));
  await type("ost"); await enter();
  ok("enter creates new needed item", vals("items").some((i) => i.text === "ost" && i.needed && i.category === "Frukt"));
  ok("search cleared", $("search").value === "");
  await type("melk");
  ok("no add panel for existing item", !q(".addnew"));
  await enter();
  ok("enter ticks existing item", S.items.i1.needed === true);
  ok("no duplicate Melk", vals("items").filter((i) => i.text.toLowerCase() === "melk").length === 1);

  // a remote change must not wipe a half-typed field
  const addInp = q("#list form.add input"); addInp.focus(); addInp.value = "halvskrevet";
  updateDoc({ col: "items", id: "i3" }, { qty: "3" }); await wait();
  ok("half-typed text survives a remote change", document.activeElement === addInp && addInp.value === "halvskrevet");
  addInp.value = ""; addInp.blur(); await wait(120);

  // shop
  $("tabShop").click(); await wait();
  ok("progress shown", /1 av \d+ i kurven/.test(q(".progress")?.textContent || ""));
  ok("finish button shown", !!q(".finishbtn"));
  const fruit = qa("#list details").find((d) => d.querySelector("summary").textContent.startsWith("Frukt"));
  ok("ticked item keeps its place", fruit.querySelector("li .txt").textContent.startsWith("Eple"));
  const mealRow = () => qa("#list li").find((l) => l.textContent.includes("Fløte"));
  ok("dinner row visible in shop", !!mealRow());
  mealRow().querySelector(".x").click(); await wait();
  ok("dinner row removed", !S.items.m1 && !mealRow());
  q(".toast button").click(); await wait();
  ok("undo restores dinner row", S.items.m1?.mealId === "dag-0" && !!mealRow());
  mealRow().querySelector("input").click(); await wait();
  ok("ticking a row in shop", S.items.m1.checked === true);

  // rename group: everything follows
  $("tabEdit").click(); await wait();
  const g = qa("summary input.gname").find((i) => i.value === "Meieri");
  g.value = "Kjøl"; g.dispatchEvent(new Event("change")); await wait();
  ok("rename: items", S.items.i1.category === "Kjøl");
  ok("rename: dinner row", S.items.m1.mealCategory === "Kjøl");
  ok("rename: meal ingredients", S.meals["dag-0"].ingredients[0].category === "Kjøl");
  ok("rename: recipe ingredients", S.recipes.r1.ingredients.every((x) => x.category === "Kjøl"));
  ok("rename: category doc", S.categories.meieri.name === "Kjøl" && Object.keys(S.categories).length === 2);
  $("tabShop").click(); await wait();
  ok("dinner row still visible after rename", !!mealRow());

  // edit filters
  $("tabEdit").click(); await wait();
  $("fSort").value = "az"; $("fSort").dispatchEvent(new Event("change")); await wait();
  const fr = qa("#list details").find((d) => d.querySelector("input.gname").value === "Frukt");
  ok("A–Å sort in edit", [...fr.querySelectorAll("input.t")].map((i) => i.value).join() === "Banan,Eple,ost");
  ok("reorder disabled while sorted", fr.querySelector("li .grip").disabled === true);
  $("fSort").value = "manual"; $("fSort").dispatchEvent(new Event("change")); await wait();
  $("btnDups").click(); await wait();
  ok("duplicate panel opens", !!q(".dups"));
  $("btnDups").click(); await wait();

  // bulk move offline: selection clears, recipe ingredient follows the item
  const row = qa("li.edit").find((l) => l.querySelector("input.t").value === "Melk");
  const cb = row.querySelector("input.sel"); cb.checked = true; cb.dispatchEvent(new Event("change")); await wait();
  ok("bulk bar shown", !$("bulkBar").classList.contains("hidden"));
  $("bulkCat").value = "Frukt"; $("bulkMove").click(); await wait();
  ok("bulk move applied", S.items.i1.category === "Frukt");
  ok("bulk selection cleared while offline", $("bulkBar").classList.contains("hidden"));
  ok("recipe ingredient follows moved item", S.recipes.r1.ingredients.find((x) => x.text === "Melk").category === "Frukt"
    && S.recipes.r1.ingredients.find((x) => x.text === "Fløte").category === "Kjøl");

  // move group up, then delete a group that only dinners use
  const kj = () => qa("#list details").find((d) => d.querySelector("input.gname").value === "Kjøl");
  kj().querySelector('button[aria-label="Flytt gruppe opp"]').click(); await wait();
  ok("move group up", S.categories.meieri.order === 0 && S.categories.frukt.order === 1);
  kj().querySelector('button[aria-label="Slett gruppe"]').click(); await wait();
  ok("delete group: gone", !S.categories.meieri);
  ok("delete group: dinner refs moved", S.items.m1.mealCategory === "Frukt" && S.meals["dag-0"].ingredients[0].category === "Frukt");

  // menu actions
  $("tabShop").click(); await wait();
  $("finishShop").click(); await wait();
  ok("Ferdig handlet: ticked items leave the list, dinner rows are deleted", S.items.i2.needed === false && !S.items.m1 && S.items.i3.needed === true);
}
