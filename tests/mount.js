// Start the real app inside a test page: borrow index.html's markup and styles (not its scripts), then load
// js/app.js. The page's import map has already swapped the Firebase SDK for the in-memory stubs.
export async function mountApp() {
  const page = new DOMParser().parseFromString(await (await fetch("../index.html")).text(), "text/html");
  page.querySelectorAll("script").forEach((s) => s.remove());
  page.querySelectorAll("style").forEach((s) => document.head.appendChild(document.adoptNode(s)));
  document.body.insertAdjacentHTML("afterbegin", page.body.innerHTML);
  await import("../js/app.js");
}
