/**
 * WHAT A READER TYPES INTO THE BAKED HOMEPAGE SEARCH IS KEPT WHEN REACT SWAPS
 * THE PAGE IN (PERFORMANCE-M1, SEO audit 2026-11-18).
 *
 * The bake writes a working GET form on "/" (#home-q, #home-location), so a
 * reader can start typing at the first paint, about 2.0 s on a phone. React's
 * commit comes at about 4.8 s, and HomeSearchHero started both fields empty
 * while main.tsx removed the baked nodes: in two runs on the phone profile,
 * "nurse" typed at 1.7-2.2 s read back as {value: '', focused: false}.
 *
 * Held here, with a real React root beside the baked form the way main.tsx
 * mounts it: the hero starts from what the baked fields hold, and the focus
 * and caret come back to the field that had them, both when the hero commits
 * while the baked form is still on screen (an English reader) and when the
 * baked form left with an earlier commit (a reader whose language loads first:
 * the page draws its header, then the hero). Nothing typed means nothing
 * carried; a focus the reader moved elsewhere is not taken back; a later
 * visit to "/" in the same tab starts empty. On 9c9234e9a the typed text is
 * '' after React mounts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HomeSearchHero } from "@/components/home/HomeSearchHero";
import { bakedField, mountBesidePrerendered } from "@/lib/keep-prerendered-page";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");

// The baked hero's form as scripts/prerender-seo.mjs writes it (ids, names, types).
const BAKED = `<header class="baked"><a href="/">Resume Booster</a></header>
<main class="baked"><section aria-labelledby="home-h1"><h1 id="home-h1">Jobs straight from employers</h1>
<form action="/jobs" method="get" role="search">
<label for="home-q">What</label><input id="home-q" name="q" type="search" />
<label for="home-location">Where</label><input id="home-location" name="location" type="text" />
<button type="submit">Search jobs</button></form></section></main>
<footer class="baked"><a href="/terms">Terms</a></footer>`;

let root: Root | null = null;
let actEnv: unknown;

function bakedHome() {
  document.head.innerHTML = `<meta name="x-prerendered" content="1" />`;
  document.body.innerHTML = `<div id="root">${BAKED}</div>`;
  return document.getElementById("root")!;
}
/** The reader types into a baked field: the value, the focus and a caret at the end. */
function typeInto(id: string, text: string, focus = true) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (focus) el.focus();
  el.value = text;
  if (focus) el.setSelectionRange(text.length, text.length);
}
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
const reactField = (mount: HTMLElement, id: string) => mount.querySelector<HTMLInputElement>(`#${id}`)!;
const hero = () => <MemoryRouter><HomeSearchHero openTotal={null} asOf={null} /></MemoryRouter>;

/** The homepage for a reader whose language loads first: header and an empty main, then the hero. */
function LateHero({ after }: { after: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), after); return () => clearTimeout(t); }, [after]);
  return (
    <MemoryRouter>
      <header role="banner"><a href="/pricing" id="site-pricing">Pricing</a></header>
      {shown ? <main><HomeSearchHero openTotal={null} asOf={null} /></main> : <main aria-busy="true" />}
    </MemoryRouter>
  );
}

beforeEach(() => {
  actEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  // A browser, not act(): commits happen when React schedules them.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnv;
});

describe("text typed into the baked homepage search", () => {
  it("is in React's fields after the swap, with the focus and the caret where they were", async () => {
    const container = bakedHome();
    typeInto("home-location", "Leeds", false);
    typeInto("home-q", "nurse");
    // The caret mid-word: at the end is where the browser leaves it anyway,
    // so only a caret elsewhere shows the restore ran.
    (document.getElementById("home-q") as HTMLInputElement).setSelectionRange(2, 2);
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(hero());
    await settle(60);
    expect(container.querySelector(".baked"), "the baked page has left").toBeNull();
    const q = reactField(mount, "home-q");
    expect(q.value).toBe("nurse");
    expect(reactField(mount, "home-location").value).toBe("Leeds");
    expect(document.activeElement).toBe(q);
    expect([q.selectionStart, q.selectionEnd]).toEqual([2, 2]);
  });

  it("is kept when the baked form left with an earlier commit, and the focus comes back while nothing else took it", async () => {
    const container = bakedHome();
    typeInto("home-q", "nurse");
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(<LateHero after={40} />);
    await settle(15);
    expect(container.querySelector(".baked"), "the header's commit took the baked page").toBeNull();
    expect(document.activeElement).toBe(document.body);
    await settle(80);
    const q = reactField(mount, "home-q");
    expect(q.value).toBe("nurse");
    expect(document.activeElement).toBe(q);
  });

  it("does not take the focus back from where the reader moved it, but keeps the words", async () => {
    const container = bakedHome();
    typeInto("home-q", "nurse");
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(<LateHero after={40} />);
    await settle(15);
    (document.getElementById("site-pricing") as HTMLElement).focus();
    await settle(80);
    expect(reactField(mount, "home-q").value).toBe("nurse");
    expect(document.activeElement?.id).toBe("site-pricing");
  });

  it("is offered once: a later visit to / in the same tab starts empty", async () => {
    const container = bakedHome();
    typeInto("home-q", "nurse");
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(hero());
    await settle(60);
    expect(reactField(mount, "home-q").value).toBe("nurse");
    expect(bakedField("home-q")).toBeNull();
    root.render(<div>another page</div>);
    await settle(20);
    root.render(hero());
    await settle(20);
    expect(reactField(mount, "home-q").value).toBe("");
  });

  it("nothing typed carries nothing and moves no focus", async () => {
    const container = bakedHome();
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(hero());
    await settle(60);
    expect(reactField(mount, "home-q").value).toBe("");
    expect(reactField(mount, "home-location").value).toBe("");
    expect(document.activeElement).toBe(document.body);
  });

  it("the hero's fields carry the ids the bake writes", () => {
    const bake = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));
    expect(bake).toMatch(/<input id="home-q" name="q"/);
    expect(bake).toMatch(/<input id="home-location" name="location"/);
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);
    root.render(hero());
    return settle(20).then(() => {
      expect(div.querySelector("input#home-q[name=q]")).not.toBeNull();
      expect(div.querySelector("input#home-location[name=location]")).not.toBeNull();
    });
  });
});
