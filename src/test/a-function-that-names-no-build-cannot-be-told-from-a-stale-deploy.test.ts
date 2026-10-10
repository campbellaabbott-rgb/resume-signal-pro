// @vitest-environment node
/**
 * A FUNCTION THAT NAMES NO BUILD CANNOT BE TOLD FROM A STALE DEPLOY OF ITSELF.
 *
 * The deploy check reads what is live from one header, x-fn-build, on an
 * OPTIONS request (scripts/verify-deploy.sh, scripts/deploy-ledger.mjs). On
 * 2026-10-08, 21 functions sent none (sweep S8-124); on 2026-10-10, eleven
 * still did, among them warm-up, job-fit and layoff-filings, so the ledger
 * could not say whether any change to them had ever been deployed.
 *
 * `_shared/fn-build.ts` wraps a handler so every response it returns names
 * the build. This file runs that wrapper, then checks every function in the
 * tree carries a build the ledger can read and sends it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stamped } from "../../supabase/functions/_shared/fn-build";

const FN = resolve(__dirname, "../../supabase/functions");

describe("stamped(): every response names the build, and nothing else changes", () => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

  it("the preflight carries x-fn-build and exposes it, beside the handler's own CORS headers", async () => {
    const h = stamped("warm-up.2026-10-09.1", (req) => (req.method === "OPTIONS" ? new Response(null, { headers: cors }) : new Response("x")));
    const r = await h(new Request("https://f.test/", { method: "OPTIONS" }));
    expect(r.headers.get("x-fn-build")).toBe("warm-up.2026-10-09.1");
    expect(r.headers.get("access-control-expose-headers")).toBe("x-fn-build");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.status).toBe(200);
  });

  it("status, body and an existing expose list are the handler's; the build is added to the list once", async () => {
    const h = stamped("job-fit.2026-10-09.1", () => new Response(JSON.stringify({ error: "x" }), { status: 429, headers: { "Content-Type": "application/json", "Access-Control-Expose-Headers": "retry-after" } }));
    const r = await h(new Request("https://f.test/", { method: "POST" }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "x" });
    expect(r.headers.get("access-control-expose-headers")).toBe("retry-after, x-fn-build");
    const twice = await stamped("b.2026-10-09.2", () => new Response(null, { headers: r.headers }))(new Request("https://f.test/"));
    expect(twice.headers.get("access-control-expose-headers")).toBe("retry-after, x-fn-build");
    expect(twice.headers.get("x-fn-build")).toBe("b.2026-10-09.2");
  });

  it("a streamed body passes through, chunk by chunk", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode("data: 1\n\n")); c.enqueue(enc.encode("data: 2\n\n")); c.close(); } });
    const r = await stamped("s.2026-10-09.1", () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))(new Request("https://f.test/"));
    expect(await r.text()).toBe("data: 1\n\ndata: 2\n\n");
    expect(r.headers.get("content-type")).toBe("text/event-stream");
  });

  it("a handler that throws still throws: the wrapper never turns a crash into an answer", async () => {
    const h = stamped("t.2026-10-09.1", () => { throw new Error("boom"); });
    await expect(h(new Request("https://f.test/"))).rejects.toThrow("boom");
  });
});

/**
 * Functions still without a stamp on this branch, each owned by another
 * wave-3 group that changes and stamps it in this wave. The excuse lasts only
 * while the function names neither a build nor the header: once its owner
 * stamps it, it is held to the same rule as every other function, whether or
 * not anyone has taken it off this list. (A shrink check that FAILED when a
 * listed function was stamped turned main red the moment the owners' branches
 * merged: all six are stamped on wave3/payments-account, wave3/email-ops and
 * wave3/job-board.) job-fit and application-fit are left to job-board because
 * a second stamp here collided with its own: the same build string on
 * different code, and a clean merge declaring FN_BUILD twice. The list may
 * only shrink.
 */
const STAMPED_BY_ITS_OWNER: Record<string, string> = {
  "application-fit": "job-board",
  "create-test-checkout": "payments-account",
  "delete-account": "payments-account",
  "job-fit": "job-board",
  "recover-purchase": "email-ops",
  "save-lead": "email-ops",
};
const OWNER_LIST_AT_START = ["application-fit", "create-test-checkout", "delete-account", "job-fit", "recover-purchase", "save-lead"];

/** What a function's index.ts says about its build: the two shapes scripts/deploy-ledger.mjs buildOf() reads, and whether it sends the header. */
function stampOf(fn: string, src: string): { build: boolean; sends: boolean } {
  const esc = fn.replace(/-/g, "\\-");
  const build = new RegExp(`["'\`]${esc}\\.\\d{4}-\\d{2}-\\d{2}\\.[A-Za-z0-9-]+["'\`]`).test(src)
    || /\$\{FN_NAME\}\.\d{4}-\d{2}-\d{2}\./.test(src)
    || /const BUILD_VERSION\s*=\s*["']\d{4}-\d{2}-\d{2}\.[A-Za-z0-9-]+["']/.test(src);
  const sends = /["']x-fn-build["']/i.test(src) || /\bstamped\(/.test(src);
  return { build, sends };
}

/** The functions that cannot say which build is deployed. A listed function is excused only while it is wholly unstamped. */
function unstamped(sources: Record<string, string>, excused: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const [fn, src] of Object.entries(sources)) {
    const { build, sends } = stampOf(fn, src);
    if (build && sends) continue;
    if (fn in excused && !build && !sends) continue;
    missing.push(`${fn}${build ? "" : " (no build the ledger can read)"}${sends ? "" : " (sends no x-fn-build)"}`);
  }
  return missing;
}

describe("every edge function names its build, and sends it", () => {
  const fns = readdirSync(FN).filter((d) => !d.startsWith("_") && existsSync(join(FN, d, "index.ts")));

  it("there are functions to check", () => {
    expect(fns.length).toBeGreaterThan(60);
  });

  it("each carries a build string the deploy ledger can read, and an x-fn-build header or the stamped() wrapper", () => {
    const sources = Object.fromEntries(fns.map((fn) => [fn, readFileSync(join(FN, fn, "index.ts"), "utf8")]));
    expect(unstamped(sources, STAMPED_BY_ITS_OWNER), "these functions cannot say which build is deployed").toEqual([]);
  });

  it("an owner stamping a listed function turns nothing red, and from then on it is held to the rule", () => {
    const stampedByOwner = `const FN_BUILD = "save-lead.2026-10-09.1";\nconst h = { "x-fn-build": FN_BUILD };\n`;
    const halfStamped = `const FN_BUILD = "recover-purchase.2026-10-09.1";\n`;
    const bare = `Deno.serve(() => new Response("ok"));\n`;
    expect(unstamped({ "save-lead": stampedByOwner, "delete-account": bare }, STAMPED_BY_ITS_OWNER)).toEqual([]);
    expect(unstamped({ "recover-purchase": halfStamped }, STAMPED_BY_ITS_OWNER)).toEqual(["recover-purchase (sends no x-fn-build)"]);
    // Positive control: an unlisted function with no stamp is reported.
    expect(unstamped({ "warm-up": bare }, STAMPED_BY_ITS_OWNER)).toEqual(["warm-up (no build the ledger can read) (sends no x-fn-build)"]);
  });

  it("the owner list only shrinks, and names functions that exist", () => {
    for (const fn of Object.keys(STAMPED_BY_ITS_OWNER)) {
      expect(OWNER_LIST_AT_START, `${fn} was added to the list: stamp it instead`).toContain(fn);
      expect(fns, `${fn} is listed but no longer exists`).toContain(fn);
    }
    const done = Object.keys(STAMPED_BY_ITS_OWNER).filter((fn) => { const s = stampOf(fn, readFileSync(join(FN, fn, "index.ts"), "utf8")); return s.build && s.sends; });
    if (done.length) console.info(`stamped by their owners, so the excuse no longer applies; take them off STAMPED_BY_ITS_OWNER: ${done.join(", ")}`);
  });
});
