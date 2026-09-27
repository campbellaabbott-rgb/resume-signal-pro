// @vitest-environment jsdom
/**
 * ONE BROWSER IS ONE VISITOR, NOT SEVEN.
 *
 * WHAT WAS WRONG (audited 2026-09-27). Seven hooks each carried a private
 * copy of "get or mint the visitor id", each under a storage key of its own:
 * the A/B hook, the funnel, the product conversions, the cohort record, the
 * scroll milestones, the time milestones and the optimisation events. The
 * board, the error boundaries and the outcome buttons used an eighth, the
 * canonical one. So a single browser's landing, its scroll, its A/B view and
 * its purchase were four visitors, and no stage of the funnel could be joined
 * to any other. The chokepoint's own getVisitorId() already existed and was
 * self-healing; the hooks simply did not call it.
 *
 * THE PROPERTY. There is one producer of a visitor id in the tree, the
 * chokepoint, and everything that records an event is stamped by it. Read
 * three ways:
 *
 *   1. BEHAVIOUR — a browser that already carries an id under a legacy key
 *      keeps THAT id: the legacy keys are read in a fixed priority order, the
 *      first well-formed one wins, it is written under the canonical key, and
 *      no second id is ever minted for a browser that has one. A browser with
 *      no usable storage is still one visitor for the whole page.
 *
 *   2. THE TREE, over comment-stripped code — a ratchet that has burned down
 *      to nothing. The files that mint or write a visitor id outside the
 *      chokepoint are named EXACTLY, and the list is empty: the four that the
 *      first build left (the outcome buttons, the share card, the score hero,
 *      the homepage's outcome-link effect) now call getVisitorId(). The same
 *      for files that read a legacy key: none. So the chokepoint no longer
 *      mirrors the one id under legacy keys for anyone — it WRITES exactly one
 *      key, and nothing is rewritten in a browser that carried the old ones.
 *
 *   3. THE KEYS — every visitor-id storage key named anywhere in the tree is
 *      one the chokepoint knows about. An eighth key cannot appear.
 *
 * Nothing here pins a spelling the code does not have to have: the ratchet
 * matches what a producer DOES (writes a visitor key, mints on a missed read,
 * defines its own getter), and the key sets are derived from source and from
 * the chokepoint's exports, then compared.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const CHOKEPOINT = "src/lib/track-transport.ts";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Transport = typeof import("../lib/track-transport");

/** A fresh module instance per test, so the page-lifetime memo starts empty. */
async function freshTransport(): Promise<Transport> {
  vi.resetModules();
  return await import("../lib/track-transport");
}

// ---------------------------------------------------------------------------
// 1. Behaviour: a browser keeps the id it has.
// ---------------------------------------------------------------------------

describe("a browser keeps the visitor id it already carries", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the A/B hook's id becomes the one id, written under the canonical key", async () => {
    const t = await freshTransport();
    const ab = "11111111-2222-4333-8444-555555555555";
    localStorage.setItem("ab_visitor_id", ab);
    expect(t.getVisitorId()).toBe(ab);
    expect(localStorage.getItem(t.VISITOR_ID_KEY)).toBe(ab);
    expect(localStorage.length, "exactly one key was added").toBe(2);
  });

  it("with every legacy key present the priority order decides, once, and nothing else is rewritten", async () => {
    const t = await freshTransport();
    const ids = t.LEGACY_VISITOR_ID_KEYS.map((_, i) => `${String(i).repeat(8)}-0000-4000-8000-000000000000`);
    t.LEGACY_VISITOR_ID_KEYS.forEach((k, i) => localStorage.setItem(k, ids[i]));
    const chosen = t.getVisitorId();
    expect(chosen).toBe(ids[0]);
    expect(t.LEGACY_VISITOR_ID_KEYS[0]).toBe("ab_visitor_id");
    expect(localStorage.getItem(t.VISITOR_ID_KEY)).toBe(chosen);
    // Every legacy key keeps what it had: nothing is deleted, nothing is
    // overwritten, a rollback finds its keys where it left them.
    t.LEGACY_VISITOR_ID_KEYS.forEach((k, i) => {
      expect(localStorage.getItem(k)).toBe(ids[i]);
    });
    // And a second call changes nothing.
    expect(t.getVisitorId()).toBe(chosen);
  });

  it("a canonical id beats every legacy one, and no legacy key is rewritten", async () => {
    const t = await freshTransport();
    const canonical = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const ab = "99999999-8888-4777-8666-555555555555";
    localStorage.setItem(t.VISITOR_ID_KEY, canonical);
    localStorage.setItem("ab_visitor_id", ab);
    expect(t.getVisitorId()).toBe(canonical);
    expect(localStorage.getItem("ab_visitor_id")).toBe(ab);
    expect(localStorage.getItem("funnel_visitor_id")).toBeNull();
  });

  it("storage that can be read but not written keeps the id it read, for the whole page", async () => {
    // A full quota: getItem works, setItem throws. The first cut minted a
    // fresh id in the catch even though it had already read the browser's
    // legacy id (reviewed 2026-09-27).
    const t = await freshTransport();
    const legacy = "5a5a5a5a-6b6b-4c7c-8d8d-9e9e9e9e9e9e";
    const store: Record<string, string> = { ab_visitor_id: legacy };
    vi.stubGlobal("localStorage", {
      getItem(k: string) { return store[k] ?? null; },
      setItem() { throw new Error("QuotaExceededError"); },
    });
    expect(t.getVisitorId()).toBe(legacy);
    expect(t.getVisitorId()).toBe(legacy);
  });

  it("a malformed legacy id is skipped for the next well-formed one, never adopted", async () => {
    const t = await freshTransport();
    const funnel = "12121212-3434-4565-8787-989898989898";
    localStorage.setItem("ab_visitor_id", "v_1784936171593_d2u1jnsls");
    localStorage.setItem("funnel_visitor_id", funnel);
    expect(t.getVisitorId()).toBe(funnel);
  });

  it("with nothing stored, one id is minted and it is the id from then on", async () => {
    const t = await freshTransport();
    const first = t.getVisitorId();
    expect(first).toMatch(UUID_RE);
    for (let i = 0; i < 5; i++) expect(t.getVisitorId()).toBe(first);
    expect(localStorage.getItem(t.VISITOR_ID_KEY)).toBe(first);
  });

  it("with storage blocked, a page is ONE visitor for its lifetime — not one per event", async () => {
    const t = await freshTransport();
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const a = t.getVisitorId();
    const b = t.getVisitorId();
    expect(a).toMatch(UUID_RE);
    expect(b).toBe(a);
  });

  it("a page whose storage comes back keeps the id it was already sending", async () => {
    const t = await freshTransport();
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const whileBlocked = t.getVisitorId();
    vi.unstubAllGlobals();
    localStorage.clear();
    expect(t.getVisitorId()).toBe(whileBlocked);
    expect(localStorage.getItem(t.VISITOR_ID_KEY)).toBe(whileBlocked);
  });
});

// ---------------------------------------------------------------------------
// 2 and 3. The tree, over comment-stripped code.
// ---------------------------------------------------------------------------

/** Every application source file under src: no tests, no test helpers, no declarations, not the chokepoint. */
function appFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (relative(ROOT, p) === "src/test") continue;
        walk(p);
        continue;
      }
      const rel = relative(ROOT, p);
      if (!/\.(ts|tsx)$/.test(rel) || /\.(test|spec)\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts")) continue;
      if (rel === CHOKEPOINT) continue;
      out.push(rel);
    }
  };
  walk(resolve(ROOT, "src"));
  return out.sort();
}

const code = (rel: string) => codeOf(readFileSync(resolve(ROOT, rel), "utf8"));

/** A storage key that is a visitor id, as a quoted literal handed to localStorage. */
const STORAGE_READ = /localStorage\.getItem\(\s*["']([a-z_]*visitor_id)["']/g;
const STORAGE_WRITE = /localStorage\.setItem\(\s*["']([a-z_]*visitor_id)["']/g;
/** A read of a visitor key with a mint on the miss: `getItem('…visitor_id') || crypto.randomUUID()`. */
const MINT_ON_MISS = /visitor_id["']\)\s*(?:\?\?|\|\|)\s*crypto\.randomUUID\(\)/;
/** A private getter — the shape every one of the seven hooks had. */
const OWN_GETTER = /(?:const|let|var)\s+getVisitorId\s*=|function\s+(?:getVisitorId|visitorId)\s*\(/;

const all = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]);

/**
 * THE RATCHET, burned down. Every file outside the chokepoint that produces a
 * visitor id, exactly: none. Adding one fails this at once.
 */
const PRODUCERS_STILL_OUTSIDE: string[] = [];

/** Files that read a legacy key directly, exactly: none. Same ratchet. */
const LEGACY_READERS_STILL_OUTSIDE: string[] = [];

describe("the tree has one producer of a visitor id", () => {
  const files = appFiles();
  const sources = new Map(files.map((f) => [f, code(f)] as const));

  it("reads a tree (the derivation itself must work)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.startsWith("src/hooks/"))).toBe(true);
    expect(files).not.toContain(CHOKEPOINT);
  });

  it("no hook mints, writes or defines a visitor id, and none reads a legacy key", () => {
    const hooks = files.filter((f) => f.startsWith("src/hooks/"));
    expect(hooks.length).toBeGreaterThanOrEqual(8);
    for (const f of hooks) {
      const src = sources.get(f)!;
      expect(all(src, STORAGE_WRITE), `${f} writes a visitor key`).toEqual([]);
      expect(all(src, STORAGE_READ), `${f} reads a visitor key`).toEqual([]);
      expect(MINT_ON_MISS.test(src), `${f} mints a visitor id on a missed read`).toBe(false);
      expect(OWN_GETTER.test(src), `${f} defines its own visitor getter`).toBe(false);
    }
  });

  it("the producers outside the chokepoint are exactly the named ones (a ratchet)", () => {
    const producers = files.filter((f) => {
      const src = sources.get(f)!;
      return all(src, STORAGE_WRITE).length > 0 || MINT_ON_MISS.test(src) || OWN_GETTER.test(src);
    });
    expect(producers).toEqual([...PRODUCERS_STILL_OUTSIDE].sort());
  });

  it("the legacy readers outside the chokepoint are exactly the named ones (none), so the chokepoint writes exactly one key", async () => {
    const t = await freshTransport();
    const readers: string[] = [];
    for (const f of files) {
      const legacy = all(sources.get(f)!, STORAGE_READ).filter((k) => k !== t.VISITOR_ID_KEY);
      if (legacy.length > 0) readers.push(f);
    }
    expect(readers).toEqual([...LEGACY_READERS_STILL_OUTSIDE].sort());
    // With no reader of a legacy key left, the chokepoint has nothing to
    // mirror: every localStorage write in it targets the canonical key.
    const writes = [...code(CHOKEPOINT).matchAll(/localStorage\.setItem\(\s*([^,]+),/g)].map((m) => m[1].trim());
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes), `the chokepoint writes ${writes.join(", ")}`).toEqual(new Set(["VISITOR_ID_KEY"]));
    expect("MIRRORED_LEGACY_VISITOR_ID_KEYS" in t, "a mirror list survived its last reader").toBe(false);
  });

  it("every visitor-id storage key named anywhere in src -- the chokepoint included -- is one the chokepoint knows", async () => {
    const t = await freshTransport();
    const known = new Set<string>([t.VISITOR_ID_KEY, ...t.LEGACY_VISITOR_ID_KEYS]);
    // Any quoted literal shaped like a visitor key, not only one handed to
    // localStorage: now that no app file names one, the chokepoint's own
    // constants are what keeps the scan honest, and a stray literal anywhere
    // (a new hook's private key, a reader of an old one) fails here.
    const KEY_LITERAL = /["']([a-z_]*visitor_id)["']/g;
    const seen = new Set<string>();
    for (const src of [...sources.values(), code(CHOKEPOINT)]) all(src, KEY_LITERAL).forEach((k) => seen.add(k));
    expect(seen.size, "the scan found no keys at all — the regexes are not reading the tree").toBeGreaterThan(0);
    expect(seen.has(t.VISITOR_ID_KEY)).toBe(true);
    const strangers = [...seen].filter((k) => !known.has(k));
    expect(strangers, `visitor keys the chokepoint has never heard of: ${strangers.join(", ")}`).toEqual([]);
    // And outside the chokepoint, none at all.
    const outside = new Set<string>();
    for (const src of sources.values()) all(src, KEY_LITERAL).forEach((k) => outside.add(k));
    expect([...outside], "a visitor key literal outside the chokepoint").toEqual([]);
  });

  it("the canonical key is not a legacy key", async () => {
    const t = await freshTransport();
    expect(new Set<string>(t.LEGACY_VISITOR_ID_KEYS).has(t.VISITOR_ID_KEY)).toBe(false);
  });
});
