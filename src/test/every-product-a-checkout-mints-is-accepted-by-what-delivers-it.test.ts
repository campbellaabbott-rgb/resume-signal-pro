/**
 * EVERY PRODUCT A CHECKOUT MINTS IS ACCEPTED BY WHAT DELIVERS IT.
 *
 * WHAT WAS WRONG. create-product-checkout writes product_type in snake_case
 * (`apply_assistant`); generate-apply-package accepted a list written in the
 * frontend's camelCase product keys (`applyAssistant`, `premiumPackage`,
 * `transitionPro`). The intersection was empty, and on top of that the three
 * server-side callers (webhook, success-page verify, retry sweep) sent no
 * session at all -- so the $7 Apply Assistant was refused on every path, for
 * every buyer, from the day it went on sale. Beside it: the $5 analysis was
 * refused by a stale amount floor; ATS Defense ($15) re-claimed a session its
 * own callers had already claimed and answered 409; the keyword fix's
 * server-side generation sent no session to a generator that requires one;
 * and three writers recorded a claim with NO product, which the purchase gate
 * accepts as a purchase of anything.
 *
 * Each of those is the same shape: the string one runtime mints and the
 * string another runtime accepts were never compared by anything. The 08-06
 * audit wrote "every product_type the catalogue can emit has a handler" in a
 * migration header -- a sentence, checked by reading, and wrong for two of
 * them.
 *
 * THE PROPERTY. The product types are DERIVED from every function that mints
 * a live Stripe Checkout session (the minter guard's own rule), and for each
 * one the thing that delivers it is asked whether it accepts it: its gate's
 * allow-list resolved through imports, its server-side callers' request
 * bodies, its claim handling. A new product type fails here until somebody
 * declares who delivers it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const FN = resolve(ROOT, "supabase/functions");
const read = (abs: string) => readFileSync(abs, "utf8");
const fnPath = (fn: string) => resolve(FN, fn, "index.ts");
const code = (fn: string) => codeOf(read(fnPath(fn)));

// ---------------------------------------------------------------------------
// Readers. Each one throws or reports rather than returning "nothing found",
// because a reader that finds nothing makes every check below pass.
// ---------------------------------------------------------------------------

/** Text from `start` to the bracket that closes the first opener at/after it. */
function balanced(src: string, start: number): string {
  const open = src.slice(start).search(/[[({]/);
  if (open < 0) return "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + open; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === "\\") { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch) && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** The string members of an array literal, or the single string of a string literal. */
function literalValues(text: string): string[] | null {
  const t = text.trim();
  if (/^["']/.test(t)) return [t.slice(1, t.search(/["'](?=[^"']*$)/) || undefined)].map((s) => s.replace(/^["']|["']$/g, ""));
  if (t.startsWith("[")) return [...t.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return null;
}

/**
 * The value of identifier `name` as seen from file `abs`: a local
 * `const name = ...`, else the same export in the file it is imported from.
 */
function resolveConst(abs: string, name: string, depth = 0): string[] | null {
  if (depth > 3 || !existsSync(abs)) return null;
  const src = codeOf(read(abs));
  const local = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*`).exec(src);
  if (local) {
    const rest = src.slice(local.index + local[0].length);
    const lit = rest.startsWith("[") ? balanced(rest, 0) : (/^["'][^"']*["']/.exec(rest)?.[0] ?? "");
    const vals = literalValues(lit);
    if (vals) return vals;
  }
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    if (names.includes(name) && m[2].startsWith(".")) return resolveConst(resolve(dirname(abs), m[2]), name, depth + 1);
  }
  return null;
}

/** A list written either as a literal or as an identifier, resolved from `abs`. */
function listAt(abs: string, text: string): string[] | null {
  return literalValues(text) ?? (/^[A-Za-z_]\w*$/.test(text.trim()) ? resolveConst(abs, text.trim()) : null);
}

/** Every request body a file sends to `endpoint` over functions/v1. */
function bodiesSentTo(src: string, endpoint: string): string[] {
  const out: string[] = [];
  let at = src.indexOf(`/functions/v1/${endpoint}\``);
  while (at >= 0) {
    const b = src.indexOf("body: JSON.stringify(", at);
    if (b >= 0) out.push(balanced(src, b + "body: JSON.stringify".length));
    at = src.indexOf(`/functions/v1/${endpoint}\``, at + 1);
  }
  return out;
}

/** Functions that mint a live Stripe Checkout session -- the minter guard's rule. */
const MINTERS = readdirSync(FN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(fnPath(d.name)))
  .map((d) => d.name)
  .filter((n) => { const c = code(n); return c.includes("checkout.sessions.create(") && !c.includes("STRIPE_TEST_SECRET_KEY"); })
  .sort();

/** product_type values a minter writes into session metadata. */
function mintedBy(fn: string): string[] {
  const c = code(fn);
  const out = new Set<string>();
  for (const m of c.matchAll(/\bproduct_type:\s*(["'][a-z_]+["']|[A-Z][A-Z0-9_]*\b|product\.productType)/g)) {
    const v = m[1];
    if (v === "product.productType") {
      // From the initialiser, not the type annotation: `Record<string, {...}>`
      // opens a brace before the table does.
      const decl = c.indexOf("const PRODUCTS");
      const table = balanced(c, c.indexOf("= {", decl) + 2);
      for (const p of table.matchAll(/productType:\s*"([a-z_]+)"/g)) out.add(p[1]);
    } else {
      for (const x of listAt(fnPath(fn), v) ?? [`<unresolved ${v}>`]) out.add(x);
    }
  }
  return [...out];
}

const MINTED = new Map<string, string>(); // product_type -> minter
for (const fn of MINTERS) for (const t of mintedBy(fn)) MINTED.set(t, fn);

// ---------------------------------------------------------------------------
// The deliverers.
// ---------------------------------------------------------------------------

const WEBHOOK = code("stripe-webhook");
const VERIFY = code("verify-product-purchase");
const RETRY = code("retry-failed-deliveries");
const DELIVERY = WEBHOOK.slice(WEBHOOK.indexOf("async function triggerProductDelivery("), WEBHOOK.indexOf("serve(async"));

/** product_type -> endpoint, from each dispatcher's own syntax. */
const route = {
  webhook: new Map([...WEBHOOK.matchAll(/case\s+'([a-z_]+)':\s*endpoint\s*=\s*'([a-z-]+)'/g)].map((m) => [m[1], m[2]])),
  retry: new Map([...RETRY.matchAll(/product_type === '([a-z_]+)'\)\s*\{\s*endpoint = '([a-z-]+)'/g)].map((m) => [m[1], m[2]])),
  verify: new Map([...VERIFY.matchAll(/case '([a-z_]+)':\s*return \{ endpoint: '([a-z-]+)', body: (\{[^}]*\})/g)].map((m) => [m[1], m[2]])),
  verifyBody: new Map([...VERIFY.matchAll(/case '([a-z_]+)':\s*return \{ endpoint: '([a-z-]+)', body: (\{[^}]*\})/g)].map((m) => [m[1], m[3]])),
};

/** How a generator decides to serve `t`: null when it does, else why not. */
function generatorRefuses(endpoint: string, t: string): string | null {
  const abs = fnPath(endpoint);
  if (!existsSync(abs)) return `${endpoint} does not exist`;
  const c = codeOf(read(abs));
  const gate = /assertPaidSession\(\s*\w+\s*,\s*\w+\s*(?:,\s*(\[[^\]]*\]|[A-Za-z_]\w*))?\s*\)/.exec(c);
  if (gate) {
    if (!gate[1]) return null; // no allow-list: any paid session
    const list = listAt(abs, gate[1]);
    if (!list) return `${endpoint}: cannot resolve the allow-list ${gate[1]}`;
    return list.includes(t) ? null : `${endpoint} accepts only [${list.join(", ")}], not ${t}`;
  }
  const own = /metadata\??\.product_type !== ([A-Za-z_]\w*|'[a-z_]+'|"[a-z_]+")/.exec(c);
  if (own) {
    const list = listAt(abs, own[1]);
    return list?.includes(t) ? null : `${endpoint} checks the session is ${own[1]}, not ${t}`;
  }
  if (/payment_status|checkout\.sessions\.retrieve/.test(c)) return `${endpoint} verifies payment in a shape this guard cannot read -- teach it`;
  return null; // ungated: the dual-use generators in paid-generators-are-gated.test.ts
}

/** A generator that inserts a claim must not refuse a session its callers already claimed. */
function refusesAClaimedSession(endpoint: string): string | null {
  const c = codeOf(read(fnPath(endpoint)));
  const at = c.search(/from\(['"]used_stripe_sessions['"]\)\s*\.insert\(/);
  if (at < 0) return null;
  const region = c.slice(at, at + 1800);
  return /status:\s*409/.test(region)
    ? `${endpoint} answers 409 when the session is already claimed -- but every caller claims it first`
    : null;
}

const SHARED_BODY = (() => {
  const i = DELIVERY.indexOf("const body: Record<string, unknown> = {");
  return i < 0 ? "" : balanced(DELIVERY, i + "const body: Record<string, unknown> = ".length);
})();
const RETRY_BODY = (() => {
  const i = RETRY.indexOf("const body: Record<string, unknown> = {");
  return i < 0 ? "" : balanced(RETRY, i + "const body: Record<string, unknown> = ".length);
})();

/** The per-product checks. Each returns the list of things wrong. */
const DELIVERERS: Record<string, (t: string) => Promise<string[]> | string[]> = {
  full_analysis: async (t) => {
    const out: string[] = [];
    const az = code("analyze-resume");
    const shared = resolve(FN, "_shared/full-analysis.ts");
    if (!/import \{[^}]*\bfullAnalysisRefusal\b[^}]*\} from "\.\.\/_shared\/full-analysis\.ts"/.test(az) || !/fullAnalysisRefusal\(session\)/.test(az)) {
      out.push("analyze-resume does not judge the session by the product create-checkout mints");
    }
    if (existsSync(shared)) {
      const mod = await import(shared) as { fullAnalysisRefusal: (s: unknown) => string | null; FULL_ANALYSIS_PRODUCT_TYPE: string };
      const refusal = mod.fullAnalysisRefusal({ payment_status: "paid", metadata: { product_type: t } });
      if (refusal !== null) out.push(`analyze-resume's predicate refuses a paid ${t} session: ${refusal}`);
      if (mod.FULL_ANALYSIS_PRODUCT_TYPE !== t) out.push(`the shared constant is ${mod.FULL_ANALYSIS_PRODUCT_TYPE}, create-checkout mints ${t}`);
    } else {
      out.push("there is no shared full-analysis module for the fulfilment path to agree with");
    }
    // The webhook and the sweep have nothing to generate for it; each must
    // say so before it reaches a branch that records the purchase as failed.
    // An `if` on the shared constant that leaves (return / continue) -- not
    // merely a mention of it, which a ternary elsewhere would satisfy.
    const exits = /if \((?:productType|delivery\.product_type) === FULL_ANALYSIS_PRODUCT_TYPE\) \{[\s\S]{0,700}?\b(?:return|continue)\b/;
    for (const [who, src, anchor] of [["stripe-webhook", DELIVERY, "if (!resumeSessionId)"], ["retry-failed-deliveries", RETRY, "if (!resumeSessionId)"]] as const) {
      const m = exits.exec(src);
      if (!m || m.index > src.indexOf(anchor)) out.push(`${who} has no explicit branch for ${t} ahead of its "no resume session" failure`);
    }
    return out;
  },

  apply_assistant: (t) => {
    const out: string[] = [];
    const abs = fnPath("generate-apply-package");
    const c = codeOf(read(abs));
    // 'paid' spelled out, or the shared settlement rule (2026-10-05, L6-10).
    const m = /(?:payment_status === "paid"|checkoutSessionSettled\(session\)) && (\[[^\]]*\]|[A-Za-z_]\w*)\.includes\(productType\)/.exec(c);
    const list = m ? listAt(abs, m[1]) : null;
    if (!list) out.push("generate-apply-package's Stripe gate could not be read");
    else if (!list.includes(t)) out.push(`generate-apply-package accepts [${list.join(", ")}] -- none of which any checkout mints -- not ${t}`);
    for (const [who, src] of [["stripe-webhook", DELIVERY], ["verify-product-purchase", VERIFY], ["retry-failed-deliveries", RETRY]] as const) {
      const bodies = bodiesSentTo(src, "generate-apply-package");
      if (bodies.length === 0) out.push(`${who} no longer calls generate-apply-package -- who delivers ${t}?`);
      for (const b of bodies) if (!/\bsessionId\b/.test(b)) out.push(`${who} calls generate-apply-package with no session: ${b.replace(/\s+/g, " ").slice(0, 90)}`);
    }
    return out;
  },

  scan_pack: (t) => {
    const out: string[] = [];
    if (!new RegExp(`productType === '${t}'`).test(DELIVERY)) out.push(`the webhook has no credits branch for ${t}`);
    if (!code("verify-scan-pack-purchase").includes(`'${t}'`)) out.push(`verify-scan-pack-purchase does not accept ${t}`);
    return out;
  },

  freelance_boost: (t) => freelance(t),
  freelance_transition_pro: (t) => freelance(t),

  agent_pass: (t) => {
    const pass = resolveConst(fnPath("stripe-webhook"), "PASS_PRODUCT_TYPE");
    const out: string[] = [];
    if (!pass?.includes(t)) out.push(`the webhook's PASS_PRODUCT_TYPE resolves to ${pass}, not ${t}`);
    if (!/productType === PASS_PRODUCT_TYPE/.test(DELIVERY)) out.push("triggerProductDelivery has no pass branch");
    return out;
  },

  apply_agent: (t) => (new RegExp(`product_type === "${t}"`).test(WEBHOOK) ? [] : [`the webhook does not seed the agent entitlement for ${t}`]),

  // Entitlement, not content: the subscription is read back from Stripe by
  // the shared Pro reader, at the price the checkout charged.
  pro_subscription: () => {
    const out: string[] = [];
    if (!/import \{[^}]*\bcheckProByEmail\b[^}]*\} from "\.\.\/_shared\/pro\.ts"/.test(code("check-subscription"))) out.push("check-subscription no longer reads Pro through _shared/pro.ts");
    if (!/import \{[^}]*\bPRO_PRICE_CENTS\b[^}]*\} from "\.\.\/_shared\/pro\.ts"/.test(code("create-subscription-checkout"))) out.push("the Pro checkout no longer charges the shared price");
    return out;
  },
};

function freelance(t: string): string[] {
  const out: string[] = [];
  if (!new RegExp(`productType === '${t}'`).test(DELIVERY)) out.push(`the webhook does not defer ${t} to the intake page`);
  const valid = resolveConst(fnPath("generate-freelance-boost"), "VALID_TYPES");
  if (!valid?.includes(t)) out.push(`generate-freelance-boost accepts [${valid}], not ${t}`);
  return out;
}

/** The content products the webhook routes to a generator. */
function routed(t: string): string[] {
  const out: string[] = [];
  const ep = route.webhook.get(t)!;
  const refusal = generatorRefuses(ep, t);
  if (refusal) out.push(refusal);
  const reclaim = refusesAClaimedSession(ep);
  if (reclaim) out.push(reclaim);
  if (!/\bsessionId\b/.test(SHARED_BODY)) out.push("the webhook's shared generator body carries no session");
  if (route.retry.get(t) !== ep) out.push(`retry-failed-deliveries routes ${t} to ${route.retry.get(t)}, the webhook to ${ep}`);
  else if (!/sessionId: delivery\.stripe_session_id/.test(RETRY_BODY)) out.push("the retry sweep's generator body carries no session");
  if (route.verify.get(t) !== ep) out.push(`verify-product-purchase routes ${t} to ${route.verify.get(t)}, the webhook to ${ep}`);
  const gated = generatorRefuses(ep, "__nothing_buys_this__") !== null;
  if (gated && !/\bsessionId\b/.test(route.verifyBody.get(t) ?? "")) out.push(`verify-product-purchase calls the gated ${ep} with no session`);
  return out;
}

describe("the product types are derived, not listed", () => {
  it("from every live minter, and they are the ones this file knows how to check", () => {
    expect(MINTERS).toEqual(expect.arrayContaining(["create-checkout", "create-product-checkout", "create-scan-pack-checkout", "create-pass-checkout"]));
    const minted = [...MINTED.keys()].sort();
    expect(minted.filter((t) => t.startsWith("<unresolved")), "a minted product type could not be resolved").toEqual([]);
    const undeclared = minted.filter((t) => !DELIVERERS[t] && !route.webhook.has(t));
    expect(undeclared, "a checkout mints a product nobody here has declared a deliverer for").toEqual([]);
    expect(minted.length, "the derivation found too little to be reading the tree").toBeGreaterThanOrEqual(15);
    expect(MINTED.get("full_analysis")).toBe("create-checkout");
    expect(MINTED.get("apply_assistant")).toBe("create-product-checkout");
  });
});

describe("each minted product is accepted by what delivers it", () => {
  for (const [t, minter] of [...MINTED.entries()].sort()) {
    it(`${t} (minted by ${minter})`, async () => {
      const problems = DELIVERERS[t] ? await DELIVERERS[t](t) : routed(t);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

describe("a claim always names the product it paid for", () => {
  // assertPaidSession accepts a claim with no product as grandfathered -- so a
  // writer that omits it mints a receipt every paid generator honours.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith(".ts") && !d.name.endsWith("_test.ts")) files.push(p);
    }
  };
  walk(FN);

  it("every insert into used_stripe_sessions carries product_type", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of files) {
      const c = codeOf(read(f));
      for (const m of c.matchAll(/from\(['"]used_stripe_sessions['"]\)\s*(?:\/\/[^\n]*\n\s*)*\.insert\(/g)) {
        seen++;
        const obj = balanced(c, m.index! + m[0].length - 1);
        if (!/\bproduct_type\b/.test(obj)) bad.push(`${f.slice(FN.length + 1)}: ${obj.replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    expect(seen, "found no claim writers at all -- the matcher broke").toBeGreaterThanOrEqual(4);
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
