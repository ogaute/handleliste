// Suite b: dinners, recipe import, group ids, backup restore and Rema import. All while "offline".
export function seed(S) {
  Object.assign(S.categories, { "kjøtt-fisk": { name: "Kjøtt & fisk", order: 0 }, meieri: { name: "Meieri", order: 1 } });
  Object.assign(S.items, {
    i1: { text: "Melk", category: "Meieri", needed: false, checked: false, order: 0 },
    i2: { text: "Smør", category: "Meieri", needed: false, checked: false, order: 1 },
    i3: { text: "Kjøttdeig", category: "Kjøtt & fisk", needed: false, checked: false, order: 0 },
  });
  S.recipes.r1 = { name: "Suppe", recipe: "", ingredients: [{ text: "Melk", category: "Meieri" }] };
  S.meals["dag-0"] = { day: 0, name: "Suppe", planned: false, recipeId: "r1", ingredients: [{ text: "Melk", category: "Meieri" }, { text: "Smør", category: "Meieri" }] };
  S.products.old1 = { name: "GAMMEL VARE", count: 1 };
}

export async function run({ S, $, ok, wait, vals, pick }) {
  const q = (sel) => document.querySelector(sel), qa = (sel) => [...document.querySelectorAll(sel)];

  // search is cleared on tab change
  $("tabPlan").click(); await wait();
  $("search").value = "melk"; $("search").dispatchEvent(new Event("input")); await wait();
  $("tabRecipes").click(); await wait();
  ok("search cleared on tab change", $("search").value === "" && !q("#list .empty"));

  // import: only exact matches replace the ingredient
  q(".importbtn").click(); await wait();
  const ta = q(".imp textarea");
  ta.value = JSON.stringify({ format: "handleliste-oppskrift", name: "Curry", steps: ["Kok"], ingredients: [
    { qty: "4 dl", text: "kokosmelk" }, { qty: "1", text: "peanøttsmør" }, { qty: "400 g", text: "kjøttdeig" }, { qty: "", text: "koriander" }] });
  ta.dispatchEvent(new Event("input"));
  q(".imp button.primary").click(); await wait();
  const rows = qa(".improw").map((r) => ({ t: r.querySelector(".t").value, c: r.querySelector("select").value, st: r.querySelector(".st").textContent }));
  ok("kokosmelk kept, category suggested from Melk", rows[0].t === "kokosmelk" && rows[0].c === "Meieri" && rows[0].st === "ny");
  ok("peanøttsmør kept", rows[1].t === "peanøttsmør" && rows[1].st === "ny");
  ok("exact match adopts item name", rows[2].t === "Kjøttdeig" && rows[2].c === "Kjøtt & fisk" && rows[2].st.includes("finnes"));
  ok("unknown ingredient kept", rows[3].t === "koriander");
  qa(".imp button.primary").pop().click(); await wait();
  ok("import saved offline with new items", vals("recipes").some((r) => r.name === "Curry" && r.ingredients.length === 4)
    && vals("items").some((i) => i.text === "kokosmelk") && vals("items").filter((i) => i.text === "Kjøttdeig").length === 1);

  // new dinner, add an ingredient through the picker, plan it on a day
  const nf = q("form.newrecipe"); nf.querySelector("input").value = "Taco"; nf.dispatchEvent(new Event("submit", { cancelable: true })); await wait();
  const taco = () => qa("#list details").find((d) => d.querySelector("input.gname")?.value === "Taco");
  ok("new dinner saved and open", vals("recipes").some((r) => r.name === "Taco") && taco()?.open === true);
  const pk = taco().querySelector(".picker input"); pk.value = "kjøtt"; pk.dispatchEvent(new Event("input")); await wait();
  taco().querySelector(".picker .sugg button").click(); await wait();
  ok("ingredient picker adds an existing item", vals("recipes").find((r) => r.name === "Taco").ingredients[0]?.text === "Kjøttdeig");
  pk.blur(); await wait(120);
  taco().querySelector(".planrow select").value = "3"; taco().querySelector(".planrow button").click(); await wait();
  ok("plan dinner switches to Uke while offline", document.body.dataset.mode === "meals" && S.meals["dag-3"]?.name === "Taco");

  // save-and-add updates the saved dinner
  const mon = qa("#list details").find((d) => d.querySelector("summary").textContent.startsWith("Mandag"));
  mon.querySelector(".meal-actions .done").click(); await wait();
  ok("finishMeal updates saved dinner", S.recipes.r1.ingredients.length === 2 && S.meals["dag-0"].planned === true);
  ok("finishMeal adds rows to shopping list", vals("items").filter((i) => i.mealId === "dag-0").length === 2);
  $("tabShop").click(); await wait();
  ok("dinner rows show day and dinner in shop", qa("#list li .sub").some((s) => s.textContent === "Mandag · Suppe"));

  // group names that give the same slug
  $("tabEdit").click(); await wait();
  const ng = q("form.newgroup"); ng.querySelector("input").value = "Kjøtt/fisk"; ng.dispatchEvent(new Event("submit", { cancelable: true })); await wait();
  const names = vals("categories").map((c) => c.name);
  ok("colliding group name gets its own doc", names.includes("Kjøtt & fisk") && names.includes("Kjøtt/fisk") && S.categories["kjøtt-fisk"].name === "Kjøtt & fisk");

  // restore a backup with a pending timestamp and an unknown group, more than one batch
  const many = Array.from({ length: 450 }, (_, i) => ({ id: "b" + i, data: { text: "Vare " + i, category: "Ukjent gruppe", needed: false, checked: false, order: i, createdAt: null } }));
  await pick("restoreFile", "b.json", { format: "handleliste-backup", version: 1, exportedAt: "2026-11-15T00:00:00Z", collections: { items: many, categories: [], meals: [], recipes: [] } }, 500);
  ok("restore completes offline past 400 docs", !!S.items.b0 && !!S.items.b449);
  ok("restore toast shown", (q(".toast")?.textContent || "").includes("Gjenopprettet 450"));

  // Rema import: one document, same name merged, old per-product documents removed
  await pick("remaFile", "rema.json", [{ name: "OSTEPOP 100G", ean: "7000000000011", count: 4 }, { name: "Ostepop 100g", ean: "7000000000028", count: 2 }, { name: "PIZZA", count: 1 }]);
  ok("rema import writes one document", S.products._all?.list.length === 2 && S.products._all.list[0].n === "OSTEPOP 100G" && S.products._all.list[0].c === 6);
  ok("rema import removes old per-product documents", !S.products.old1 && Object.keys(S.products).length === 1);
  $("tabPlan").click(); await wait();
  $("search").value = "pizz"; $("search").dispatchEvent(new Event("input")); await wait();
  ok("imported products are suggested", qa(".addnew .sugg > button").some((b) => b.textContent.includes("PIZZA")));
}
