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
 * Functions still without a stamp, each owned by another wave-3 group that is
 * changing it in this wave (and so bumps its build by the house rule). The
 * list may only shrink.
 */
const STAMPED_BY_ITS_OWNER: Record<string, string> = {
  "create-test-checkout": "payments-account",
  "delete-account": "payments-account",
  "recover-purchase": "email-ops",
  "save-lead": "email-ops",
};

describe("every edge function names its build, and sends it", () => {
  const fns = readdirSync(FN).filter((d) => !d.startsWith("_") && existsSync(join(FN, d, "index.ts")));

  it("there are functions to check", () => {
    expect(fns.length).toBeGreaterThan(60);
  });

  it("each carries a build string the deploy ledger can read, and an x-fn-build header or the stamped() wrapper", () => {
    const missing: string[] = [];
    for (const fn of fns) {
      if (fn in STAMPED_BY_ITS_OWNER) continue;
      const src = readFileSync(join(FN, fn, "index.ts"), "utf8");
      // The two shapes scripts/deploy-ledger.mjs buildOf() reads: a literal
      // "<fn>.YYYY-MM-DD.N" (or a FN_NAME template), or a BUILD_VERSION.
      const esc = fn.replace(/-/g, "\\-");
      const build = new RegExp(`["'\`]${esc}\\.\\d{4}-\\d{2}-\\d{2}\\.[A-Za-z0-9-]+["'\`]`).test(src)
        || /\$\{FN_NAME\}\.\d{4}-\d{2}-\d{2}\./.test(src)
        || /const BUILD_VERSION\s*=\s*["']\d{4}-\d{2}-\d{2}\.[A-Za-z0-9-]+["']/.test(src);
      const sends = /["']x-fn-build["']/i.test(src) || /\bstamped\(/.test(src);
      if (!build || !sends) missing.push(`${fn}${build ? "" : " (no build the ledger can read)"}${sends ? "" : " (sends no x-fn-build)"}`);
    }
    expect(missing, "these functions cannot say which build is deployed").toEqual([]);
  });

  it("an owner-stamped function that is stamped now is taken off the list", () => {
    const done = Object.keys(STAMPED_BY_ITS_OWNER).filter((fn) => {
      const p = join(FN, fn, "index.ts");
      if (!existsSync(p)) return true;
      const src = readFileSync(p, "utf8");
      return /["']x-fn-build["']/i.test(src) || /\bstamped\(/.test(src);
    });
    expect(done, "remove these from STAMPED_BY_ITS_OWNER: they name their build now").toEqual([]);
  });
});
