// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/pricing?utm_source=news&plan=pro#top" }
/**
 * A CHECKOUT BODY THAT NAMES NO VISITOR JOINS TO NO LANDING.
 *
 * WHAT WAS WRONG. The server records the start of every Stripe session it
 * mints (checkout_starts, keyed on the session id) and joins that row back
 * to the visitor's landing_view through two body fields, `visitorId` and
 * `page`. The first build shipped the server side and the pglite join, and
 * not one client call sent either field: every row would have carried
 * visitor_id NULL and origin_path NULL, and the join the record exists for
 * would have matched nothing (three reviewers, 2026-09-27).
 *
 * THE PROPERTY, three ways:
 *
 *   1. THE PRODUCER. checkoutContext() in the chokepoint yields the browser's
 *      one visitor id and the current page as a pathname -- never the query
 *      string, never the hash -- at a production address that carries both.
 *
 *   2. THE ROUND TRIP. The server's reader (checkoutContextOf, imported from
 *      the shared Deno module, which has no imports so it runs here) is
 *      handed exactly what the producer made, and reads both fields back
 *      whole. The two runtimes are held to the same two names by executing
 *      them, not by comparing spellings.
 *
 *   3. EVERY CALLER. The set of functions that mint a live Stripe session is
 *      DERIVED from supabase/functions (the same rule as the minter guard),
 *      the client call sites of each are DERIVED from src (a bare client
 *      invoke of the function's name, or the resilient caller bound to it),
 *      and every one of those calls spreads the producer into its body and
 *      imports it from the chokepoint. Every minter has at least one caller,
 *      so the derivation is known to be reading the tree.
 *
 * TEETH in-file: a call site with the spread removed fails the property.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { checkoutContext, getVisitorId } from "../lib/track-transport";
import { checkoutContextOf } from "../../supabase/functions/_shared/checkout-start";

const ROOT = resolve(__dirname, "../..");
const CHOKEPOINT = "src/lib/track-transport.ts";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPREAD = "...checkoutContext()";

// ---------------------------------------------------------------------------
// 1 and 2: the producer, and the round trip through the server's reader.
// ---------------------------------------------------------------------------

describe("the browser's checkout context", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("runs at a production address carrying a query and a hash (the setup itself must work)", () => {
    expect(window.location.hostname).toBe("resumebooster.work");
    expect(window.location.search).toContain("plan=pro");
    expect(window.location.hash).toBe("#top");
  });

  it("is this browser's one visitor id and the page as a pathname, and nothing else", () => {
    const ctx = checkoutContext();
    expect(Object.keys(ctx).sort()).toEqual(["page", "visitorId"]);
    expect(ctx.visitorId).toMatch(UUID_RE);
    expect(ctx.visitorId).toBe(getVisitorId());
    expect(ctx.page).toBe("/pricing");
  });

  it("round-trips through the server's reader whole: the reader takes exactly the two names the producer makes", () => {
    const sent = checkoutContext();
    const read = checkoutContextOf(JSON.parse(JSON.stringify({ email: "buyer@example.com", ...sent })));
    expect(read).toEqual({ visitorId: sent.visitorId, page: sent.page });
    expect(read.visitorId, "a null here is the first build's every row").not.toBeNull();
    expect(read.page).not.toBeNull();
  });

  it("with storage blocked the context is still a well-formed visitor and a path", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const ctx = checkoutContext();
    expect(ctx.visitorId).toMatch(UUID_RE);
    expect(checkoutContextOf(ctx).visitorId).toBe(ctx.visitorId);
  });
});

// ---------------------------------------------------------------------------
// 3: every caller of every live minter.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const code = (rel: string) => codeOf(read(rel));

/** Every function that mints a Stripe Checkout session with the LIVE key -- the minter guard's rule. */
function liveMinters(): string[] {
  const dir = resolve(ROOT, "supabase/functions");
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(resolve(dir, d.name, "index.ts")))
    .map((d) => d.name)
    .filter((n) => {
      const c = code(`supabase/functions/${n}/index.ts`);
      return c.includes("checkout.sessions.create(") && !c.includes("STRIPE_TEST_SECRET_KEY");
    })
    .sort();
}

/** Every application source file under src: no tests, no declarations, not the chokepoint. */
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

/** The resilient callers bound to a minter: `name: createResilientCaller('<fn>'` -> name. */
function resilientCallersFor(minters: string[]): Map<string, string> {
  const src = code("src/lib/resilient-edge-function.ts");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/(\w+): createResilientCaller\(['"]([^'"]+)['"]/g)) {
    if (minters.includes(m[2])) out.set(m[1], m[2]);
  }
  return out;
}

/** The text of a call from `at` (the opening paren must follow) to its matching close. */
function callTextFrom(src: string, at: number): string {
  const open = src.indexOf("(", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    if (src[i] === ")" && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

type CallSite = { file: string; minter: string; via: string; text: string };

/** Every client call of a live minter, derived from the tree. */
function callSites(minters: string[], files: string[]): CallSite[] {
  const resilient = resilientCallersFor(minters);
  const out: CallSite[] = [];
  for (const file of files) {
    const src = code(file);
    for (const minter of minters) {
      const re = new RegExp(`\\.invoke\\(\\s*['"]${minter}['"]`, "g");
      for (const m of src.matchAll(re)) out.push({ file, minter, via: "invoke", text: callTextFrom(src, m.index!) });
    }
    for (const [name, minter] of resilient) {
      const re = new RegExp(`resilientCallers\\.${name}\\(`, "g");
      for (const m of src.matchAll(re)) out.push({ file, minter, via: `resilientCallers.${name}`, text: callTextFrom(src, m.index!) });
    }
  }
  return out;
}

/** What a call site must hold, as named failures. */
function siteViolations(site: CallSite, fileCode: string): string[] {
  const out: string[] = [];
  if (!site.text.includes(SPREAD)) out.push("body does not spread checkoutContext()");
  if (!/import \{[^}]*\bcheckoutContext\b[^}]*\} from ['"](?:@\/lib|\.\.\/lib|\.\.\/\.\.\/lib)\/track-transport['"]/.test(fileCode)) out.push("checkoutContext not imported from the chokepoint");
  return out;
}

describe("every client call of every live minter carries the visitor and the page", () => {
  const minters = liveMinters();
  const files = appFiles();
  const sites = callSites(minters, files);

  it("the derivation reads the tree: six minters, each with at least one caller", () => {
    expect(minters.length).toBeGreaterThanOrEqual(6);
    expect(minters).toContain("create-checkout");
    expect(minters).not.toContain("create-test-checkout");
    for (const m of minters) {
      expect(sites.filter((s) => s.minter === m).length, `${m} has no client caller in src -- the derivation is not reading it`).toBeGreaterThan(0);
    }
    expect(sites.some((s) => s.via.startsWith("resilientCallers.")), "the resilient caller for create-checkout was not found").toBe(true);
  });

  for (const site of callSites(minters, files)) {
    it(`${site.file} -> ${site.minter} (${site.via})`, () => {
      expect(siteViolations(site, code(site.file))).toEqual([]);
    });
  }

  it("TEETH: a call site with the spread removed fails, and a body that spells the keys by hand instead of spreading the producer fails too", () => {
    const site = sites.find((s) => s.minter === "create-pass-checkout")!;
    expect(site).toBeDefined();
    const fileCode = code(site.file);
    const cut = { ...site, text: site.text.replace(SPREAD, "") };
    expect(cut.text).not.toBe(site.text);
    expect(siteViolations(cut, fileCode)).toContain("body does not spread checkoutContext()");
    const byHand = { ...site, text: site.text.replace(SPREAD, "visitorId: localStorage.getItem('rb_visitor_id'), page: window.location.href") };
    expect(siteViolations(byHand, fileCode)).toContain("body does not spread checkoutContext()");
    const noImport = fileCode.replace(/import \{[^}]*\bcheckoutContext\b[^}]*\} from ['"][^'"]*track-transport['"];?/, "");
    expect(noImport).not.toBe(fileCode);
    expect(siteViolations(site, noImport)).toContain("checkoutContext not imported from the chokepoint");
  });
});
