// @vitest-environment node
/**
 * A CHECKOUT THAT BEGAN IS RECORDED WHERE THE SESSION IS MINTED.
 *
 * WHAT WAS WRONG. checkout_started was a browser event fired milliseconds
 * before the page left for Stripe, and three mechanisms ate it: the funnel
 * writer's duplicate key (same test, visitor and type inside 24 hours), the
 * navigation that cancels a plain fetch, and a per-address budget of fifty
 * events an hour shared by every hook on the site. Measured 2026-09-27 over
 * 30 days through the cohort reader: 136,087 landing visitors, zero at
 * checkout_started, 26 completed scans in the same window.
 *
 * WHAT THIS FILE GUARDS, each as a PROPERTY over comment-stripped code:
 *
 *   1. EVERY LIVE MINTER RECORDS. The set of functions that call Stripe's
 *      session create with the live key is DERIVED from source, never listed
 *      by hand, so a seventh checkout function that forgets the record fails
 *      here. The test-key sandbox is not a checkout and is excluded by the
 *      key it reads.
 *   2. AT THE MINT SITE, BEFORE THE URL LEAVES. In each minter the record call
 *      sits after the assignment that receives Stripe's session (the create
 *      call itself, or a wrapper whose body contains it) and before the
 *      response that carries session.url; it is awaited, never handed to
 *      waitUntil, so no unload can race it.
 *   3. KEYED ON THE SESSION ID. The call passes Stripe's session.id as the
 *      key, takes the amount from Stripe's answer, names its own function,
 *      and reads the visitor context through the shared reader -- the one
 *      place the 8-to-64 shape is enforced.
 *   4. THE READERS AND THE RECORDER BEHAVE. The shared module has no imports,
 *      so it is imported here and exercised: the visitor shape, the path
 *      reduction, the body reader (and that it leaves the request readable),
 *      and that the recorder hands the session id to record_checkout_start
 *      and never throws.
 *   5. THE JOIN COLUMNS EXIST IN THE LAST DEFINITION. checkout_starts is keyed
 *      on stripe_session_id and carries visitor_id; used_stripe_sessions is
 *      keyed on session_id; product_deliveries carries stripe_session_id. The
 *      writer stores a repeat of the key as nothing, consults no window and
 *      no rate table, and is locked to service_role by name -- as is the
 *      table, which is under RLS with no policy.
 *   6. A BUILD IS PROVABLE. Each minter names itself in a build marker that
 *      every response carries in x-fn-build, so a deploy can be checked with
 *      a CORS preflight and no purchase.
 *
 *   7. THE WAIT IS BOUNDED. The recorder is awaited on the purchase path and
 *      a client library call has no timeout of its own, so a stalled
 *      connection (a hang, not an error) would hold the Stripe url until the
 *      runtime's wall-clock limit. The recorder races the write against a
 *      timer and answers "failed" past it; driven here with a write that
 *      never settles.
 *
 * THE NAMES ARE DERIVED, NOT PINNED. The variable that receives Stripe's
 * session is read off the mint assignment in each minter (whatever it is
 * called), and the writer's signature is parsed from its live definition --
 * so a rename in one minter, or a parameter type that drifts, fails the
 * property and not a spelling.
 *
 * TEETH. Every code property is re-run over a mutated copy of the live
 * source at the foot of the file: the record removed, the key swapped, the
 * call deferred, the call moved past the response; and the SQL properties
 * over a writer with its conflict clause cut and a file with its grants cut.
 * Each mutation must fail the property it targets.
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf, commentsOf, sqlCodeOf } from "./helpers/strip-comments";
import { liveDefinitionOf } from "./helpers/live-sql";
import {
  CHECKOUT_START_TIMEOUT_MS,
  ORIGIN_PATH_MAX,
  VISITOR_ID_MAX,
  VISITOR_ID_MIN,
  checkoutContextFromRequest,
  checkoutContextOf,
  originPathOf,
  recordCheckoutStart,
  visitorIdOf,
} from "../../supabase/functions/_shared/checkout-start";

const ROOT = resolve(__dirname, "../..");
const FN_DIR = resolve(ROOT, "supabase/functions");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const fnSource = (n: string) => read(`supabase/functions/${n}/index.ts`);

const MINT = "checkout.sessions.create(";
const RECORD = "recordCheckoutStart(";
const TABLE = "checkout_starts";
const WRITER = "record_checkout_start";

/** Spelling variants Postgres treats as the same type, so the parsed signature is the catalogue's. */
function canonicalType(t: string): string {
  const k = t.trim().toLowerCase().replace(/\s+/g, " ");
  return ({ int: "integer", int4: "integer", bool: "boolean", "timestamp with time zone": "timestamptz" } as Record<string, string>)[k] ?? k;
}

/** `record_checkout_start(text, text, …)` as the catalogue names it, parsed from the live definition's parameter list. */
function writerSignatureOf(definition: string): string {
  const open = definition.indexOf("(");
  let depth = 0;
  let close = -1;
  for (let i = open; i < definition.length; i++) {
    if (definition[i] === "(") depth++;
    if (definition[i] === ")" && --depth === 0) { close = i; break; }
  }
  if (open < 0 || close < 0) throw new Error("no parameter list in the writer's definition");
  const params = definition.slice(open + 1, close).split(",").map((x) => x.trim()).filter(Boolean);
  const types = params.map((x) => {
    const m = /^[A-Za-z_]\w*\s+([A-Za-z_][\w ]*?)(?:\s+DEFAULT\b[\s\S]*)?$/i.exec(x);
    if (!m) throw new Error(`cannot parse parameter: ${JSON.stringify(x)}`);
    return canonicalType(m[1]);
  });
  return `${WRITER}(${types.join(", ")})`;
}

/** Every function that mints a Stripe Checkout session with the LIVE key. Derived, not listed. */
const MINTERS = readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name)
  .filter((n) => existsSync(resolve(FN_DIR, n, "index.ts")))
  .filter((n) => {
    const c = codeOf(fnSource(n));
    return c.includes(MINT) && !c.includes("STRIPE_TEST_SECRET_KEY");
  })
  .sort();

type Site = {
  /** The name of the variable that receives Stripe's session, as the minter spells it. */
  session: string;
  /** Index of the assignment that receives Stripe's session, or -1. */
  mint: number;
  /** Index of the record call, or -1. */
  record: number;
  /** Index of the response that carries session.url, or -1. */
  url: number;
  /** The record call's text through its closing brace. */
  call: string;
  awaited: boolean;
  deferred: boolean;
};

/** The text of a top-level function declaration, to its closing brace at column zero. */
function declarationOf(code: string, name: string): string {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(code);
  if (!m) return "";
  const end = code.indexOf("\n}\n", m.index);
  return code.slice(m.index, end < 0 ? code.length : end + 2);
}

function siteOf(code: string): Site {
  let mint = -1;
  let session = "session";
  // The assignment that receives the minted session: `const <name> = await
  // <callee>(` where the callee is Stripe's create or a wrapper around it.
  const re = /const ([A-Za-z_$][\w$]*) = await ([A-Za-z_$][\w$.]*)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const callee = m[2];
    if (callee.endsWith("checkout.sessions.create") || declarationOf(code, callee).includes(MINT)) {
      mint = m.index;
      session = m[1];
      break;
    }
  }
  const record = code.indexOf(RECORD);
  const close = record < 0 ? -1 : code.indexOf("});", record);
  const call = record < 0 || close < 0 ? "" : code.slice(record, close + 3);
  const before = record < 0 ? "" : code.slice(Math.max(0, record - 48), record);
  return {
    session,
    mint,
    record,
    url: code.indexOf(`url: ${session}.url`),
    call,
    awaited: /\bawait\s+$/.test(before),
    deferred: /waitUntil\(\s*$/.test(before),
  };
}

/** The properties a minter must hold, as named failures so a teeth case can say which one bit. */
function violations(fn: string, code: string): string[] {
  const s = siteOf(code);
  const out: string[] = [];
  if (s.mint < 0) out.push("no assignment receives a minted session");
  if (s.record < 0) out.push("no record call");
  if (s.url < 0) out.push("no response carries session.url");
  if (s.record >= 0 && s.mint >= 0 && s.record < s.mint) out.push("record before the mint");
  if (s.record >= 0 && s.url >= 0 && s.record > s.url) out.push("record after the url leaves");
  if (s.record >= 0 && !s.awaited) out.push("record not awaited");
  if (s.deferred) out.push("record deferred to waitUntil");
  const v = s.session.replace(/\$/g, "\\$");
  if (!new RegExp(`stripeSessionId:\\s*${v}\\.id\\b`).test(s.call)) out.push("not keyed on session.id");
  if (!s.call.includes(`checkoutFunction: "${fn}"`)) out.push("does not name its own function");
  if (!new RegExp(`amountCents:\\s*${v}\\.amount_total\\b`).test(s.call)) out.push("amount not from Stripe's answer");
  if (!/productType:\s*\S/.test(s.call)) out.push("no product type");
  if (!/context:\s*(?:await\s+checkoutContextFromRequest\(|checkoutContextOf\()/.test(s.call)) out.push("context not through the shared reader");
  if (!code.includes('from "../_shared/checkout-start.ts"')) out.push("shared module not imported");
  return out;
}

/** The FN_BUILD value a minter declares, or null. */
function buildMarkerOf(code: string): string | null {
  const m = /const FN_BUILD = "([^"]+)";/.exec(code);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 1-3, 6: the minters.
// ---------------------------------------------------------------------------

describe("every function that mints a live Stripe Checkout session records the start", () => {
  it("the minter set is derived from source and is not empty", () => {
    expect(MINTERS.length, "at least the main flow, the product map, the two plans, the pass and the scan pack").toBeGreaterThanOrEqual(6);
    expect(MINTERS).toContain("create-checkout");
    expect(MINTERS, "the test-key sandbox is not a checkout").not.toContain("create-test-checkout");
  });

  for (const fn of MINTERS) {
    describe(fn, () => {
      const raw = fnSource(fn);
      const code = codeOf(raw);

      it("records at the mint site, before the url leaves, keyed on the session id", () => {
        expect(violations(fn, code)).toEqual([]);
      });

      it("carries a build marker that names itself, on every response", () => {
        const marker = buildMarkerOf(code);
        expect(marker, "FN_BUILD declared").not.toBeNull();
        expect(marker!.startsWith(`${fn}.`), `the marker names its own function: ${marker}`).toBe(true);
        expect(code).toMatch(/"x-fn-build":\s*FN_BUILD/);
      });

      it("keeps the guarded literals out of its comments", () => {
        const prose = commentsOf(raw);
        expect(prose).not.toContain(RECORD);
        expect(prose).not.toContain("stripeSessionId: session.id");
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 4: the shared readers and the recorder, exercised.
// ---------------------------------------------------------------------------

describe("the shared readers enforce the funnel's shapes", () => {
  it("a visitor id is a string of 8 to 64 printable non-space characters, else unknown", () => {
    expect(VISITOR_ID_MIN).toBe(8);
    expect(VISITOR_ID_MAX).toBe(64);
    expect(visitorIdOf("a".repeat(7))).toBeNull();
    expect(visitorIdOf("a".repeat(8))).toBe("a".repeat(8));
    expect(visitorIdOf("a".repeat(64))).toBe("a".repeat(64));
    expect(visitorIdOf("a".repeat(65))).toBeNull();
    expect(visitorIdOf("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(visitorIdOf("  padded-visitor-id  ")).toBe("padded-visitor-id");
    expect(visitorIdOf("has a space inside")).toBeNull();
    expect(visitorIdOf("unknown")).toBeNull();
    expect(visitorIdOf(12345678)).toBeNull();
    expect(visitorIdOf(null)).toBeNull();
    expect(visitorIdOf(undefined)).toBeNull();
  });

  it("an origin is a pathname only: no query, no fragment, no host, capped", () => {
    expect(originPathOf("/pricing?utm_source=x&plan=pro#top")).toBe("/pricing");
    expect(originPathOf("https://resumebooster.work/agents?pass=1")).toBe("/agents");
    expect(originPathOf("/")).toBe("/");
    expect(originPathOf("/jobs/software-engineer_2")).toBe("/jobs/software-engineer_2");
    expect(originPathOf("pricing")).toBeNull();
    expect(originPathOf("/has a space")).toBeNull();
    expect(originPathOf("/with\nnewline")).toBeNull();
    expect(originPathOf(42)).toBeNull();
    expect(originPathOf(undefined)).toBeNull();
    const long = "/" + "a".repeat(ORIGIN_PATH_MAX * 2);
    expect(originPathOf(long)).toHaveLength(ORIGIN_PATH_MAX);
  });

  it("the body reader takes visitorId and page and nothing else, and tolerates any body", () => {
    expect(checkoutContextOf({ visitorId: "visitor-0001", page: "/pricing?x=1" })).toEqual({ visitorId: "visitor-0001", page: "/pricing" });
    expect(checkoutContextOf({ email: "someone@example.com" })).toEqual({ visitorId: null, page: null });
    expect(checkoutContextOf(null)).toEqual({ visitorId: null, page: null });
    expect(checkoutContextOf("a string")).toEqual({ visitorId: null, page: null });
  });

  it("the request reader reads a clone and leaves the request readable; a non-JSON body is an empty context", async () => {
    const req = new Request("http://localhost/create-pass-checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId: "visitor-0002", page: "/agents/pass?x=1#y", email: "not-identity@example.com" }),
    });
    expect(await checkoutContextFromRequest(req)).toEqual({ visitorId: "visitor-0002", page: "/agents/pass" });
    expect(await req.json(), "the original body is still there for the function").toMatchObject({ visitorId: "visitor-0002" });

    const junk = new Request("http://localhost/create-pass-checkout", { method: "POST", body: "not json" });
    expect(await checkoutContextFromRequest(junk)).toEqual({ visitorId: null, page: null });
  });
});

describe("the recorder hands the session id to the writer and never throws", () => {
  type Answer = { data: unknown; error: { message: string } | null };
  const fakeDb = (answer: Answer | Error) => {
    const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
    const db = {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (answer instanceof Error) throw answer;
        return Promise.resolve(answer);
      },
    };
    return { db, calls };
  };
  const start = {
    stripeSessionId: "cs_test_a1b2c3d4e5f6",
    checkoutFunction: "create-checkout",
    productType: "full_analysis",
    productId: "fullAnalysis",
    amountCents: 500,
    currency: "usd",
    mode: "payment",
    context: { visitorId: "visitor-0003", page: "/" },
    metadata: { promo: false },
  };

  it("calls record_checkout_start with the session id as the key and the context's fields", async () => {
    const { db, calls } = fakeDb({ data: true, error: null });
    expect(await recordCheckoutStart(db, start)).toBe("recorded");
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe(WRITER);
    expect(calls[0].args).toMatchObject({
      p_stripe_session_id: "cs_test_a1b2c3d4e5f6",
      p_checkout_function: "create-checkout",
      p_product_type: "full_analysis",
      p_product_id: "fullAnalysis",
      p_visitor_id: "visitor-0003",
      p_amount_cents: 500,
      p_currency: "usd",
      p_origin_path: "/",
      p_mode: "payment",
    });
  });

  it("a repeat of the same session id is 'already_recorded', not a failure", async () => {
    const { db } = fakeDb({ data: false, error: null });
    expect(await recordCheckoutStart(db, start)).toBe("already_recorded");
  });

  it("a writer error or a thrown client is 'failed' and is swallowed -- the purchase proceeds", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await recordCheckoutStart(fakeDb({ data: null, error: { message: "permission denied" } }).db, start)).toBe("failed");
      expect(await recordCheckoutStart(fakeDb(new Error("network down")).db, start)).toBe("failed");
      expect(quiet).toHaveBeenCalledTimes(2);
    } finally {
      quiet.mockRestore();
    }
  });

  it("an absent visitor is sent as null, never as a placeholder string", async () => {
    const { db, calls } = fakeDb({ data: true, error: null });
    await recordCheckoutStart(db, { ...start, context: { visitorId: null, page: null }, productId: undefined, metadata: undefined });
    expect(calls[0].args).toMatchObject({ p_visitor_id: null, p_origin_path: null, p_product_id: null, p_metadata: {} });
  });

  it("a write that never settles is 'failed' once the cap passes, so a stalled connection cannot hold the Stripe url", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const hung = { rpc: () => new Promise<never>(() => { /* never settles */ }) };
      let outcome: string | null = null;
      const p = recordCheckoutStart(hung, start).then((o) => { outcome = o; });
      await vi.advanceTimersByTimeAsync(CHECKOUT_START_TIMEOUT_MS - 1);
      expect(outcome, "answered before the cap").toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(outcome).toBe("failed");
      expect(quiet).toHaveBeenCalledTimes(1);
      expect(String(quiet.mock.calls[0][0])).toContain(start.stripeSessionId);
      expect(CHECKOUT_START_TIMEOUT_MS, "the cap is under create-checkout's own 5s slow threshold").toBeLessThanOrEqual(5_000);
    } finally {
      vi.useRealTimers();
      quiet.mockRestore();
    }
  });

  it("a write that answers in time is not cut off by the timer, and the timer does not outlive the answer", async () => {
    vi.useFakeTimers();
    try {
      const { db } = fakeDb({ data: true, error: null });
      expect(await recordCheckoutStart(db, start)).toBe("recorded");
      expect(vi.getTimerCount(), "the race's timer is cleared once the write answers").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// 5: the SQL side, read from the last definition.
// ---------------------------------------------------------------------------

const MIGRATIONS = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const migText = (f: string) => readFileSync(resolve(MIG_DIR, f), "utf8");

/** The last migration whose CODE creates the table, and the CREATE TABLE statement from it. */
function lastTableDefinition(table: string): { file: string; body: string } {
  const re = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? public\\.${table}\\s*\\(`);
  const hits = MIGRATIONS.filter((f) => re.test(sqlCodeOf(migText(f))));
  if (!hits.length) throw new Error(`no migration creates ${table}`);
  const file = hits[hits.length - 1];
  const code = sqlCodeOf(migText(file));
  const start = re.exec(code)!.index;
  const end = code.indexOf("\n);", start);
  return { file, body: code.slice(start, end < 0 ? code.length : end + 3) };
}

/** The properties the writer's body must hold, named. */
function writerViolations(body: string): string[] {
  const out: string[] = [];
  if (!body.includes("SECURITY DEFINER")) out.push("not a definer");
  if (!/SET search_path = public/.test(body)) out.push("search_path not pinned");
  if (!/RETURNS boolean/.test(body)) out.push("does not answer whether it wrote");
  if (!new RegExp(`INSERT INTO public\\.${TABLE}`).test(body)) out.push("does not write the table");
  if (!/ON CONFLICT \(stripe_session_id\) DO NOTHING/.test(body)) out.push("a repeat of the key is not stored as nothing");
  if (/rate_limits/.test(body)) out.push("consults a rate table");
  if (/INTERVAL/i.test(body)) out.push("has a time window");
  if (/EXISTS\s*\(/i.test(body)) out.push("has a duplicate check beyond the key");
  if (/DELETE\s+FROM/i.test(body)) out.push("deletes");
  return out;
}

/** The properties the migration file must hold on grants, named. The writer's signature is the parsed one. */
function grantViolations(code: string, writerSig: string): string[] {
  const out: string[] = [];
  const sig = writerSig.replace(/[()]/g, "\\$&");
  for (const who of ["PUBLIC", "anon", "authenticated"]) {
    if (!new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM ${who};`).test(code)) out.push(`writer not revoked from ${who}`);
    if (!new RegExp(`REVOKE ALL ON TABLE public\\.${TABLE} FROM ${who};`).test(code)) out.push(`table not revoked from ${who}`);
  }
  if (!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO service_role;`).test(code)) out.push("writer not granted to service_role");
  if (!new RegExp(`GRANT [A-Z, ]+ ON TABLE public\\.${TABLE} TO service_role;`).test(code)) out.push("table not granted to service_role");
  if (!new RegExp(`ALTER TABLE public\\.${TABLE} ENABLE ROW LEVEL SECURITY;`).test(code)) out.push("RLS not enabled");
  if (new RegExp(`CREATE POLICY[^;]*ON public\\.${TABLE}`).test(code)) out.push("a policy opens the table");
  return out;
}

describe("the join columns exist in the last definition of each table", () => {
  const starts = lastTableDefinition(TABLE);

  it("checkout_starts is keyed on the Stripe session id and carries the visitor id and a path-only origin", () => {
    expect(starts.body).toMatch(/stripe_session_id text PRIMARY KEY/);
    expect(starts.body).toMatch(/\n\s*visitor_id text/);
    expect(starts.body).toMatch(/\n\s*origin_path text/);
    expect(starts.body).toMatch(/\n\s*product_type text NOT NULL/);
    expect(starts.body).toMatch(/\n\s*created_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(starts.body, "a query string can never be stored").toMatch(/position\('\?' in origin_path\) = 0/);
    expect(starts.body, "the stored shape is the funnel's").toMatch(/char_length\(visitor_id\) BETWEEN 8 AND 64/);
  });

  it("the paid side is keyed on the same string", () => {
    expect(lastTableDefinition("used_stripe_sessions").body).toMatch(/session_id TEXT PRIMARY KEY/i);
    expect(lastTableDefinition("product_deliveries").body).toMatch(/stripe_session_id TEXT NOT NULL/i);
  });

  it("the landing side carries the visitor id the start carries", () => {
    expect(lastTableDefinition("ab_test_events").body).toMatch(/visitor_id TEXT NOT NULL/i);
  });
});

describe("the writer stores a repeat of the key as nothing and consults no window and no budget", () => {
  const live = liveDefinitionOf(WRITER);
  const file = migText(live.file);
  const code = sqlCodeOf(file);

  it("is the definer the table's migration defines", () => {
    expect(live.file, "the writer lives beside its table").toBe(lastTableDefinition(TABLE).file);
    expect(writerViolations(live.body)).toEqual([]);
  });

  it("is locked to service_role by name, and so is the table -- under the signature parsed from its own definition", () => {
    const sig = writerSignatureOf(live.body);
    expect(sig).toMatch(new RegExp(`^${WRITER}\\((text|integer|jsonb)(, (text|integer|jsonb))+\\)$`));
    expect(grantViolations(code, sig)).toEqual([]);
  });

  it("keeps the guarded literals out of the file's prose", () => {
    const prose = file.split("\n").filter((l) => /^\s*--/.test(l)).join("\n");
    expect(prose).not.toMatch(/ON CONFLICT/);
    expect(prose).not.toMatch(/REVOKE ALL/);
    expect(prose).not.toMatch(/GRANT EXECUTE/);
  });

  it("carries a non-round stamp that no other migration carries", () => {
    const stamp = live.file.slice(0, 14);
    expect(stamp).toMatch(/^\d{14}$/);
    expect(stamp.slice(12), "seconds are not round").not.toBe("00");
    expect(MIGRATIONS.filter((f) => f.startsWith(stamp))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TEETH: every property above, against a mutation that removes it.
// ---------------------------------------------------------------------------

describe("teeth", () => {
  const fn = "create-checkout";
  const code = codeOf(fnSource(fn));
  const site = siteOf(code);
  const call = site.call;

  it("the live source holds every property, so the mutations below are the only difference", () => {
    expect(violations(fn, code)).toEqual([]);
    expect(call.length).toBeGreaterThan(100);
  });

  it("with the record call removed", () => {
    const bad = code.replace(`await ${call}`, "");
    expect(bad).not.toBe(code);
    expect(violations(fn, bad)).toContain("no record call");
  });

  it("with the key swapped for something that is not the session id", () => {
    const bad = code.replace(/stripeSessionId:\s*session\.id\b/, "stripeSessionId: idempotencyKey");
    expect(bad).not.toBe(code);
    expect(violations(fn, bad)).toContain("not keyed on session.id");
  });

  it("with the call deferred to waitUntil", () => {
    const bad = code.replace(`await ${call}`, `EdgeRuntime.waitUntil(${call.slice(0, -1)}));`);
    expect(bad).not.toBe(code);
    const v = violations(fn, bad);
    expect(v).toContain("record deferred to waitUntil");
    expect(v).toContain("record not awaited");
  });

  it("with the call moved past the response", () => {
    const bad = code.replace(`await ${call}`, "") + `\nasync function late(session: { id: string }) { await ${call} }\n`;
    expect(bad).not.toBe(code);
    expect(violations(fn, bad)).toContain("record after the url leaves");
  });

  it("with the call moved before the mint", () => {
    const early = code.replace(`await ${call}`, "");
    const at = siteOf(early).mint;
    const bad = early.slice(0, at) + `await ${call}\n    ` + early.slice(at);
    expect(violations(fn, bad)).toContain("record before the mint");
  });

  it("with the amount taken from the request instead of Stripe's answer", () => {
    const bad = code.replace(/amountCents:\s*session\.amount_total[^,]*,/, "amountCents: amount,");
    expect(bad).not.toBe(code);
    expect(violations(fn, bad)).toContain("amount not from Stripe's answer");
  });

  it("with the context read raw instead of through the shared reader", () => {
    const bad = code.replace(/context:\s*checkoutContextOf\(requestBody\)/, "context: { visitorId: requestBody.visitorId, page: requestBody.page }");
    expect(bad).not.toBe(code);
    expect(violations(fn, bad)).toContain("context not through the shared reader");
  });

  it("a build marker that names another function fails", () => {
    const bad = code.replace(/const FN_BUILD = "create-checkout\./, 'const FN_BUILD = "create-product-checkout.');
    expect(bad).not.toBe(code);
    expect(buildMarkerOf(bad)!.startsWith(`${fn}.`)).toBe(false);
  });

  it("the SQL writer with its conflict clause cut, and the file with its grants cut", () => {
    const live = liveDefinitionOf(WRITER);
    const noConflict = live.body.replace(/\s*ON CONFLICT \(stripe_session_id\) DO NOTHING/, "");
    expect(noConflict).not.toBe(live.body);
    expect(writerViolations(noConflict)).toContain("a repeat of the key is not stored as nothing");

    const windowed = live.body.replace("GET DIAGNOSTICS", "IF EXISTS (SELECT 1 FROM public.checkout_starts WHERE visitor_id = v_visitor AND created_at > now() - INTERVAL '1 day') THEN RETURN false; END IF;\n  GET DIAGNOSTICS");
    const v = writerViolations(windowed);
    expect(v).toContain("has a time window");
    expect(v).toContain("has a duplicate check beyond the key");

    const code = sqlCodeOf(migText(live.file));
    const sig = writerSignatureOf(live.body);
    const noRevoke = code.replace(/REVOKE ALL ON FUNCTION[^\n]*FROM anon;/, "");
    expect(noRevoke).not.toBe(code);
    expect(grantViolations(noRevoke, sig)).toContain("writer not revoked from anon");
    const opened = code + `\nCREATE POLICY "open" ON public.${TABLE} FOR SELECT TO anon USING (true);\n`;
    expect(grantViolations(opened, sig)).toContain("a policy opens the table");
    // A parameter type that drifts in the definition changes the parsed
    // signature, and the grants -- spelled with the real one -- no longer match.
    const drifted = live.body.replace(/p_amount_cents integer/i, "p_amount_cents bigint");
    expect(drifted).not.toBe(live.body);
    expect(grantViolations(code, writerSignatureOf(drifted))).toContain("writer not revoked from anon");
  });

  it("a minter that renames its session variable still passes -- the name is derived, not pinned", () => {
    const renamed = code.replace(/\bsession\b/g, "minted");
    expect(renamed).not.toBe(code);
    expect(siteOf(renamed).session).toBe("minted");
    expect(violations(fn, renamed)).toEqual([]);
  });
});
