// @vitest-environment node
/**
 * A $5 ANALYSIS SOLD BEFORE PRODUCTS WERE NAMED IS STILL DELIVERED -- AND
 * NOTHING ANY CHECKOUT CAN MINT IS MISTAKEN FOR ONE.
 *
 * WHAT WAS WRONG. The fix of 2026-10-01 judged a session by the product_type
 * in its metadata. create-checkout only began writing that on 2026-06-30
 * (6bdda09f). Every analysis it sold from the $5 price cut on 2025-12-23 to
 * then carries {resumeData, originalCurrency, baseAmountUSD} and nothing else,
 * so the buyers the stale $20 floor had already refused -- the larger part of
 * the ~50 who paid and got nothing -- were refused again, by name, at 402,
 * from the very success link the fix told them to reopen.
 *
 * A second refusal sat in the claim. A claim naming no product was read as
 * "the old analyze-resume already redeemed this", so a webhook from before
 * claims named their product (20260827180000) turned every buyer it touched
 * into a permanent 409 -- including every buyer of the window between a new
 * analyze-resume deploying and the new webhook following it.
 *
 * THE RULES THIS PINS, each run through the shipped handler:
 *   - the legacy shape is admitted exactly: no product named, no key beyond
 *     the three, baseAmountUSD "5", and no promotion-code discount (the old
 *     floor admitted discounted sessions, so those may have had an analysis
 *     already, and their only trace may be gone);
 *   - nothing a checkout can mint today passes for it: every minter's own
 *     metadata is read from its source and presented;
 *   - a claim with no product is told apart by who wrote it -- the webhook
 *     and verify record no address, analyze-resume always did;
 *   - and a legacy session is still redeemed once, never for another product,
 *     never unpaid.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { assertPaidSession } from "../../supabase/functions/_shared/paid-session";
import {
  analyzeResumeHarness,
  fullAnalysisSession,
  legacyFullAnalysisSession,
  RESUME,
  type FakeSession,
  type Harness,
} from "./helpers/analyze-resume-harness";

const ROOT = resolve(__dirname, "../..");
const FN = resolve(ROOT, "supabase/functions");
const fnPath = (fn: string) => resolve(FN, fn, "index.ts");
const code = (abs: string) => codeOf(readFileSync(abs, "utf8"));

let h: Harness;
beforeAll(async () => { h = await analyzeResumeHarness(); }, 60_000);
beforeEach(() => { h.reset(); });

const sell = (s: FakeSession) => { h.sessions.set(s.id, s); return s.id; };
const ask = (id: string, resume = RESUME) => h.call({ resumeText: resume, sessionId: id });

describe("a $5 analysis create-checkout sold before it named the product is delivered", () => {
  it("at the list price, in dollars", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_usd"));
    const r = await ask(id);
    expect(r.status, `a legacy $5 sale was answered ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`).toBe(200);
    expect(r.json.optimizedBullets).toBeTruthy();
    expect(h.db.rows("purchased_content").map((c) => c.product_type)).toEqual(["full_analysis"]);
  });

  // The window's own charges (create-checkout 33e3e3c5..d3336461): the rule
  // reads no amount, and these show it.
  for (const [currency, amount] of [["jpy", 770], ["twd", 16300], ["inr", 42300]] as const) {
    it(`at the list price, in ${currency}`, async () => {
      const id = sell(legacyFullAnalysisSession(`cs_live_legacy_${currency}`, {
        currency,
        amount_total: amount,
        metadata: { resumeData: "", originalCurrency: currency, baseAmountUSD: "5" },
      }));
      expect((await ask(id)).status).toBe(200);
    });
  }

  it("when Stripe dropped an empty resumeData, as it drops every empty metadata value", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_no_resume_key", { metadata: { originalCurrency: "usd", baseAmountUSD: "5" } }));
    expect((await ask(id)).status).toBe(200);
  });

  it("when an old webhook claimed it on payment, naming no product and recording no address", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_webhook_claim"));
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: null, ip_address: null });
    const r = await ask(id);
    expect(r.status, "a payment claim is not a redemption, whatever version of the webhook wrote it").toBe(200);
  });

  it("after an AI failure, on the retry with the same session", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_ai_flake"));
    h.aiPlan.push(500);
    expect((await ask(id)).status).toBe(500);
    expect((await ask(id)).status).toBe(200);
  });
});

describe("a legacy session is redeemed once, for this product, and only paid", () => {
  it("asking again returns the same analysis with no second AI call", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_twice"));
    const first = await ask(id);
    const again = await ask(id, `${RESUME} somebody else's resume`);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.json.marker, "one legacy purchase produced two analyses").toBe(first.json.marker);
    expect(again.json.shareId).toBe(first.json.shareId);
    expect(h.aiCalls()).toBe(1);
  });

  it("two requests racing on one legacy session hand back one analysis", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_race"));
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    h.aiPlan.push(gate, gate);
    const a = ask(id);
    const b = ask(id, `${RESUME} second tab`);
    for (let i = 0; i < 200 && h.aiCalls() < 2; i++) await new Promise((r) => setImmediate(r));
    expect(h.aiCalls(), "both requests must be inside the AI call at once").toBe(2);
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(ra.json.marker).toBe(rb.json.marker);
    expect(h.db.rows("purchased_content")).toHaveLength(1);
  });

  it("once its analysis is deleted, it is refused rather than analysed again", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_deleted"));
    expect((await ask(id)).status).toBe(200);
    h.db.tables.resume_analyses = [];
    expect((await ask(id)).status).toBe(409);
    expect(h.aiCalls()).toBe(1);
  });

  it("its claim names the full analysis, so the $5 receipt opens nothing else", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_receipt"));
    expect((await ask(id)).status).toBe(200);
    await h.settle();
    expect(h.db.rows("used_stripe_sessions").find((c) => c.session_id === id)?.product_type).toBe("full_analysis");
    expect(await assertPaidSession(h.db, id, ["premium_package"]), "a legacy $5 receipt opened the premium package").not.toBeNull();
  });

  it("an old webhook's unnamed claim is named once the analysis is delivered -- it was a key to every paid generator", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_stamp"));
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: null, ip_address: null });
    expect(await assertPaidSession(h.db, id, ["premium_package"]), "precondition: an unnamed claim is accepted everywhere").toBeNull();
    expect((await ask(id)).status).toBe(200);
    await h.settle();
    expect(h.db.rows("used_stripe_sessions").filter((c) => c.session_id === id).map((c) => c.product_type)).toEqual(["full_analysis"]);
    expect(await assertPaidSession(h.db, id, ["premium_package"]), "the delivered session still opens the premium package").not.toBeNull();
  });

  for (const status of ["unpaid", "no_payment_required"]) {
    it(`a legacy session whose payment_status is ${status} is refused before any spend`, async () => {
      const id = sell(legacyFullAnalysisSession(`cs_live_legacy_${status}`, { payment_status: status }));
      expect((await ask(id)).status).toBe(402);
      expect(h.aiCalls()).toBe(0);
    });
  }
});

describe("what is NOT taken for a legacy sale", () => {
  const refused = async (s: FakeSession, why: string) => {
    const r = await ask(sell(s));
    expect(r.status, `${why} was answered ${r.status}`).toBe(402);
    expect(h.aiCalls()).toBe(0);
  };

  it("one bought with a promotion code -- the old floor admitted it, so it may have had its analysis", async () => {
    await refused(legacyFullAnalysisSession("cs_live_legacy_promo", { amount_total: 250, total_details: { amount_discount: 250 } }), "a discounted legacy session");
  });

  it("the week the analysis cost $25 -- the old floor admitted those too", async () => {
    await refused(legacyFullAnalysisSession("cs_live_legacy_25", { amount_total: 2500, metadata: { resumeData: "", originalCurrency: "usd", baseAmountUSD: "25" } }), "a $25-era session");
  });

  it("the first week's shape, which recorded no price at all", async () => {
    await refused(legacyFullAnalysisSession("cs_live_legacy_first_week", { amount_total: 2500, metadata: { resumeData: "{}" } }), "a session with only resumeData");
  });

  it("the legacy keys beside any key create-checkout never wrote", async () => {
    for (const extra of ["product_name", "customer_email", "credits", "test_mode", "session_id"]) {
      h.reset();
      await refused(legacyFullAnalysisSession(`cs_live_legacy_plus_${extra}`, {
        metadata: { originalCurrency: "usd", baseAmountUSD: "5", [extra]: "x" },
      }), `the legacy shape plus ${extra}`);
    }
  });

  it("another product's session carrying the legacy keys", async () => {
    await refused(fullAnalysisSession("cs_live_scan_pack_legacy_keys", {
      amount_total: 9900,
      metadata: { product_type: "scan_pack", originalCurrency: "usd", baseAmountUSD: "5" },
    }), "a scan_pack session with baseAmountUSD 5");
  });

  it("a legacy session the old analyze-resume claimed (its claim records an address) is not redeemed again", async () => {
    const id = sell(legacyFullAnalysisSession("cs_live_legacy_old_redeemer"));
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: null, ip_address: "unknown" });
    const r = await ask(id);
    expect(r.status).toBe(409);
    expect(h.aiCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Every session any checkout can mint, read from the minters themselves.
// ---------------------------------------------------------------------------

function balanced(src: string, start: number): string {
  const open = src.slice(start).search(/[[({]/);
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + open; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === "\\") { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch) && --depth === 0) return src.slice(start + open, i + 1);
  }
  throw new Error("unbalanced");
}

/** Top-level `key: value` (or shorthand `key`) entries of an object literal. */
function entriesOf(obj: string): Array<[string, string]> {
  const body = obj.slice(1, -1);
  const parts: string[] = [];
  let depth = 0, quote: string | null = null, last = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === "\\") { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) { parts.push(body.slice(last, i)); last = i + 1; }
  }
  parts.push(body.slice(last));
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^([A-Za-z_]\w*)\s*(?::\s*([\s\S]*))?$/.exec(p);
    if (!m) throw new Error(`unreadable metadata entry: ${p}`);
    return [m[1], (m[2] ?? m[1]).trim()];
  });
}

/** Every function that calls Stripe's checkout.sessions.create, the test-mode one included. */
const MINTERS = readdirSync(FN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(fnPath(d.name)))
  .map((d) => d.name)
  .filter((n) => code(fnPath(n)).includes("checkout.sessions.create("))
  .sort();

/** The metadata object a minter hands Stripe -- not the one it hands recordCheckoutStart. */
function stripeMetadataOf(fn: string): string {
  const c = code(fnPath(fn));
  const skip: Array<[number, number]> = [];
  for (let at = c.indexOf("recordCheckoutStart("); at >= 0; at = c.indexOf("recordCheckoutStart(", at + 1)) {
    skip.push([at, at + balanced(c, at).length + (c.slice(at).search(/[[({]/))]);
  }
  const blocks: string[] = [];
  for (const m of c.matchAll(/\bmetadata:\s*\{/g)) {
    if (skip.some(([a, b]) => m.index! > a && m.index! < b)) continue;
    blocks.push(balanced(c, m.index! + m[0].length - 1));
  }
  if (blocks.length !== 1) throw new Error(`${fn}: expected one Stripe metadata block, found ${blocks.length} -- re-anchor this guard`);
  return blocks[0];
}

/** Each product_type value an expression can take. */
function productTypesOf(fn: string, expr: string): string[] {
  const lit = /^["']([a-z_]+)["']$/.exec(expr);
  if (lit) return [lit[1]];
  if (expr === "product.productType") {
    const c = code(fnPath(fn));
    const decl = c.indexOf("const PRODUCTS");
    const table = balanced(c, c.indexOf("= {", decl) + 2);
    return [...table.matchAll(/productType:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(expr)) {
    for (const f of readdirSync(resolve(FN, "_shared")).filter((n) => n.endsWith(".ts"))) {
      const m = new RegExp(`export const ${expr}\\s*=\\s*"([a-z_]+)"`).exec(code(resolve(FN, "_shared", f)));
      if (m) return [m[1]];
    }
  }
  throw new Error(`${fn}: cannot resolve product_type ${expr} -- re-anchor this guard`);
}

/** Every metadata object a minter can put on a session: one per product it sells, every value non-empty. */
function mintable(fn: string): Array<Record<string, string>> {
  const entries = entriesOf(stripeMetadataOf(fn));
  const typeExpr = entries.find(([k]) => k === "product_type")?.[1];
  const base = Object.fromEntries(entries.filter(([k]) => k !== "product_type").map(([k]) => [k, `minted-${k}`]));
  if (!typeExpr) return [base];
  return productTypesOf(fn, typeExpr).map((t) => ({ ...base, product_type: t }));
}

describe("nothing a checkout can mint passes for a legacy sale", () => {
  it("the minters are read, not listed here", () => {
    expect(MINTERS).toEqual(expect.arrayContaining(["create-checkout", "create-product-checkout", "create-scan-pack-checkout", "create-test-checkout"]));
    expect(MINTERS.length).toBeGreaterThanOrEqual(7);
    expect(mintable("create-product-checkout").length, "the product table parsed to nothing").toBeGreaterThanOrEqual(10);
  });

  it("every session a checkout mints today is admitted only when it names the full analysis", async () => {
    const { fullAnalysisRefusal } = await import("../../supabase/functions/_shared/full-analysis");
    const admitted: string[] = [];
    for (const fn of MINTERS) {
      for (const metadata of mintable(fn)) {
        const verdict = fullAnalysisRefusal({ payment_status: "paid", metadata, total_details: { amount_discount: 0 } });
        if (verdict === null) admitted.push(`${fn}:${metadata.product_type ?? "<no product>"}`);
      }
    }
    expect(admitted).toEqual(["create-checkout:full_analysis"]);
  });

  it("and stays refused with its product name stripped, and with the legacy price key forged in", async () => {
    const { fullAnalysisRefusal } = await import("../../supabase/functions/_shared/full-analysis");
    const admitted: string[] = [];
    for (const fn of MINTERS.filter((f) => f !== "create-checkout")) {
      for (const minted of mintable(fn)) {
        const { product_type: _dropped, ...rest } = minted;
        for (const metadata of [rest, { ...rest, baseAmountUSD: "5", originalCurrency: "usd" }]) {
          if (fullAnalysisRefusal({ payment_status: "paid", metadata, total_details: { amount_discount: 0 } }) === null) {
            admitted.push(`${fn}: ${JSON.stringify(metadata)}`);
          }
        }
      }
    }
    expect(admitted, "a session another checkout minted passed for a $5 analysis").toEqual([]);
  });
});

/**
 * Every .ts file under supabase/functions, read ONCE for the whole file.
 *
 * Two guards below each used to walk the tree themselves and strip the
 * comments out of every file in it: 9.3 MB, two 1.9 MB catalogues among it,
 * twice over, for two patterns. Alone that cost a quarter of a second to a
 * second each; under a 41-file run it reached 4.2 s, and one 10-file run lost
 * a case to vitest's 5 s default with no assertion behind it -- the same
 * "timed out" that names nothing, which helpers/mount-budget.ts argues
 * against. That file also says what to prefer: make the guard fast rather
 * than give it longer.
 *
 * So the tree is read once, and a file is stripped only when its RAW text
 * contains the name the guard is looking for. That skip cannot hide a match.
 * codeOf only takes text away -- a block comment becomes one space, a line
 * comment goes up to its newline, which stays -- so it can never put two
 * pieces together into a name that was not already spelled out in the source.
 * A file that never spells the name cannot spell it once stripped. The other
 * direction is unchanged: a file that spells the name only in a comment gets
 * past the skip, and the stripping then takes the name away, as before.
 */
let functionSources: Array<{ rel: string; raw: string }> | undefined;
function allFunctionSources(): Array<{ rel: string; raw: string }> {
  if (!functionSources) {
    const all: Array<{ rel: string; raw: string }> = [];
    const walk = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const abs = resolve(dir, d.name);
        if (d.isDirectory()) walk(abs);
        else if (d.name.endsWith(".ts")) all.push({ rel: abs.slice(FN.length + 1), raw: readFileSync(abs, "utf8") });
      }
    };
    walk(FN);
    functionSources = all;
  }
  return functionSources;
}
const stripped = new Map<string, string>();
function sourcesSpelling(name: string): Array<[string, string]> {
  if (!name) throw new Error("sourcesSpelling needs a name -- an empty one would strip the whole tree");
  const out: Array<[string, string]> = [];
  for (const { rel, raw } of allFunctionSources()) {
    if (!raw.includes(name)) continue;
    let c = stripped.get(rel);
    if (c === undefined) { c = codeOf(raw); stripped.set(rel, c); }
    out.push([rel, c]);
  }
  return out;
}

describe("the legacy shape cannot be minted any more", () => {
  it("the tree the guards below read is the whole tree", () => {
    const all = allFunctionSources();
    expect(all.length, "the walk found too few sources -- it is not reading supabase/functions").toBeGreaterThanOrEqual(100);
    expect(all.map((f) => f.rel)).toEqual(expect.arrayContaining([
      "create-checkout/index.ts", "analyze-resume/index.ts", "stripe-webhook/index.ts", "_shared/full-analysis.ts",
    ]));
  });

  it("no function but create-checkout writes baseAmountUSD", () => {
    const writers = sourcesSpelling("baseAmountUSD")
      .filter(([, c]) => /\bbaseAmountUSD["'`]?\s*:/.test(c))
      .map(([rel]) => rel);
    expect(writers).toEqual(["create-checkout/index.ts"]);
  });

  it("and create-checkout now names the product on every session it mints", () => {
    const entries = new Map(entriesOf(stripeMetadataOf("create-checkout")));
    expect(entries.get("product_type"), "create-checkout can mint the legacy shape again").toMatch(/^["']full_analysis["']$/);
  });
});

describe("the verdicts, case by case (the pure rules the handler applies)", () => {
  it("the legacy shape, and its edges", async () => {
    const { fullAnalysisRefusal, legacyFullAnalysisRefusal } = await import("../../supabase/functions/_shared/full-analysis");
    const legacy = { resumeData: "{}", originalCurrency: "eur", baseAmountUSD: "5" };
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: legacy })).toBeNull();
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: legacy, total_details: null })).toBeNull();
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: legacy, total_details: { amount_discount: 0 } })).toBeNull();
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: legacy, total_details: { amount_discount: 1 } })).toMatch(/promotion code/);
    expect(fullAnalysisRefusal({ payment_status: "unpaid", metadata: legacy })).toMatch(/payment_status/);
    expect(legacyFullAnalysisRefusal({ metadata: { ...legacy, baseAmountUSD: "25" } })).toMatch(/baseAmountUSD is 25/);
    expect(legacyFullAnalysisRefusal({ metadata: { baseAmountUSD: "5" } })).toMatch(/originalCurrency/);
    expect(legacyFullAnalysisRefusal({ metadata: { ...legacy, product_type: "" } })).toMatch(/carries product_type/);
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: { ...legacy, product_type: "scan_pack" } })).toMatch(/bought scan_pack/);
  });

  it("a claim naming no product: the address says who wrote it", async () => {
    const { priorRedemptionOf } = await import("../../supabase/functions/_shared/full-analysis");
    expect(priorRedemptionOf(null, { product_type: null, ip_address: null })).toEqual({ state: "none" });
    expect(priorRedemptionOf(null, { product_type: null, ip_address: "unknown" }).state).toBe("refused");
    expect(priorRedemptionOf(null, { product_type: null, ip_address: "203.0.113.7" }).state).toBe("refused");
    expect(priorRedemptionOf(null, { product_type: null }).state, "a claim read without its address must not be admitted").toBe("refused");
    expect(priorRedemptionOf(null, { product_type: "scan_pack", ip_address: null }).state).toBe("refused");
  });
});

describe("the address is a sound witness only while the writers keep their shapes", () => {
  /** Every object inserted into used_stripe_sessions across the functions, by file. */
  function claimInserts(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const [rel, c] of sourcesSpelling("used_stripe_sessions")) {
      for (const m of c.matchAll(/from\(\s*["']used_stripe_sessions["']\s*\)/g)) {
        const rest = c.slice(m.index!, m.index! + 400);
        const ins = /^[^;]*?\.(?:insert|upsert)\(/.exec(rest);
        if (ins) out.push([rel, balanced(rest, ins[0].length)]);
      }
    }
    return out;
  }

  it("analyze-resume, the only thing that redeems an analysis, records its address and the product on every claim", () => {
    const mine = claimInserts().filter(([f]) => f === "analyze-resume/index.ts");
    expect(mine.length, "analyze-resume's claim was not found -- re-anchor this guard").toBeGreaterThanOrEqual(1);
    for (const [, obj] of mine) {
      const keys = entriesOf(obj).map(([k]) => k);
      expect(keys).toEqual(expect.arrayContaining(["session_id", "ip_address", "product_type"]));
    }
  });

  it("and analyze-resume reads the address with the claim", () => {
    const c = code(fnPath("analyze-resume"));
    expect(/from\('used_stripe_sessions'\)\.select\('[^']*\bip_address\b[^']*'\)/.test(c),
      "the claim is read without ip_address, so every unnamed claim would be refused (or, worse, a caller could read it as null)").toBe(true);
  });
});
