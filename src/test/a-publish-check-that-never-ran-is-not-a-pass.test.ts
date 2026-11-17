// @vitest-environment node
//
// Node, not jsdom: this file runs the post-publish verifier as a child
// process, with fetch replaced before the script starts.
/**
 * A CHECK THAT NEVER RAN WAS RECORDED AS A PASS (S14X-138).
 *
 * scripts/post-publish-smoke.mjs recorded a skipped check (NO_SCAN=1, which
 * is how `npm run verify:deploy` runs it) and an unread one (a rate-limited
 * scan, an engine version nobody saw) as PASS. So the routine run printed
 * "PASS ... SKIPPED", ended "ALL CLEAR — publish verified" without having
 * looked at the report or the engine, and that counted as the clean pass the
 * IndexNow send waits for: with the owner's go-ahead set, a run that checked
 * neither sent Bing the publish's URLs.
 *
 * A check not run is now SKIP: never ok and never a failure. A run with one
 * ends "PARTIAL" naming each, exits 0 as before (nothing failed), and is not
 * a clean pass, so IndexNow lists and sends nothing. Readings that judge
 * nothing (the filed-wage note, the authorization server's document, a
 * prerender the host does not serve) print INFO instead of PASS.
 *
 * Every request the script makes is answered here by a stub loaded before
 * it, which refuses any address it does not know: nothing leaves this machine.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(__dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "smoke-three-states-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ENGINE = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/index.ts"), "utf8").match(/REPORT_ENGINE_VERSION = '([^']+)'/)?.[1] ?? "";
const META = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/as-probe.ts"), "utf8").match(/export const SIGN_IN_META_KEY = "([^"]+)";/)?.[1] ?? "";

const STUB = join(dir, "fetch-stub.mjs");
writeFileSync(STUB, `
import { appendFileSync, readFileSync } from "node:fs";
const E = process.env;
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = String(init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  appendFileSync(E.SMOKE_STUB_LOG, JSON.stringify({ method, url: url.href }) + "\\n");
  const p = url.pathname;
  if (url.hostname === "www.bing.com" && p === "/indexnow" && method === "POST") return new Response("", { status: 202 });
  if (url.hostname === "resumebooster.work") {
    if (p === "/") return new Response("<html></html>", { status: 200 });
    if (p === "/sitemap.xml") return new Response(readFileSync(E.SMOKE_STUB_SITEMAP, "utf8"), { status: 200 });
    if (p === "/industries/healthcare") return new Response(E.SMOKE_STUB_SPA === "1" ? "<div id=root></div>" : "<html><meta name=x-prerendered></html>", { status: 200 });
    if (p === "/prerender-ledger.json") return json(200, { builtAt: "2026-11-17", pages: { "/jobs": { thChanged: "2026-11-17" } }, postings: {} });
    const key = p.match(/^\\/([0-9a-f]{16,})\\.txt$/);
    if (key) return new Response(key[1], { status: 200 });
  }
  if (url.hostname.endsWith(".supabase.co")) {
    if (p.startsWith("/.well-known/")) return json(404, { error_code: "not_found" });
    if (p === "/functions/v1/agent-mcp" && method === "POST") {
      const m = JSON.parse(body);
      if (m.method === "initialize") return json(200, { jsonrpc: "2.0", id: m.id, result: { serverInfo: { version: "stub" }, _meta: { [E.SMOKE_STUB_META]: { state: "off", checkedAt: new Date().toISOString() } } } });
      if (m.method === "tools/call") return json(200, { jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "this tool needs a key" }] } });
    }
    const fn = p.match(/^\\/functions\\/v1\\/([a-z0-9-]+)$/);
    if (fn && method === "OPTIONS") return new Response("ok", { status: 200 });
    if (fn && fn[1] === "create-product-checkout") return E.SMOKE_STUB_CHECKOUT === "sells" ? json(200, { url: "https://checkout.example/x" }) : json(410, { retired: true, cut: true, product: "premium_package" });
    if (fn && fn[1] === "free-keyword-scan") {
      if (E.SMOKE_STUB_SCAN === "429") return json(429, { error: "rate limited" });
      return json(200, { atsScoreEstimate: 71, scoreBand: "good", parseQuality: {}, countryStandards: {}, topStrength: "A written strength that is long enough to be the model's own prose and not a fallback.", reportMeta: { reportId: "r-stub", engineVersion: E.SMOKE_STUB_ENGINE, mailSeal: "v2.1763380000." + "a".repeat(64) } });
    }
    const rpc = p.match(/^\\/rest\\/v1\\/rpc\\/([a-z0-9_]+)$/);
    if (rpc) {
      if (rpc[1] === "get_scan_health_status") return json(200, [{ last_heartbeat_status: "healthy", last_heartbeat_time: new Date(Date.now() - 300000).toISOString(), issues: [] }]);
      if (rpc[1] === "no_such_function_deploy_control") return json(404, { code: "PGRST202" });
      if (rpc[1] === "get_company_hiring_health") return json(200, [{ tracking_days: 30 }]);
      return json(200, []);
    }
    if (p === "/rest/v1/job_board_postings" && url.searchParams.get("select") === "id") return json(401, { code: "42501" });
    if (p.startsWith("/rest/v1/")) return json(200, []);
  }
  throw new Error("the stub knows no " + method + " " + url.href);
};
`);

type Run = { code: number; out: string; lines: string[]; requests: { method: string; url: string }[] };
function smoke(extra: Record<string, string>, name: string): Run {
  const log = join(dir, `${name}.log`);
  writeFileSync(log, "");
  const home = mkdtempSync(join(dir, "home-"));
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(GIT_|NO_SCAN$|NO_INDEXNOW$|INDEXNOW_SEND$|INDEXING_SEND$|HEARTBEAT_SECRET$|SYNTHETIC_SCAN_SECRET$|SITE$|NODE_OPTIONS$)/.test(k)));
  Object.assign(env, {
    HOME: home, SMOKE_STUB_LOG: log, SMOKE_STUB_META: META, SMOKE_STUB_ENGINE: ENGINE,
    SMOKE_STUB_SITEMAP: resolve(ROOT, "public/sitemap.xml"),
    // The owner's go-ahead is SET in every run here, so whether IndexNow sends
    // is decided by the pass alone.
    INDEXNOW_SEND: "1",
    ...extra,
  });
  let code = 0;
  let out = "";
  try {
    out = execFileSync(process.execPath, ["--import", pathToFileURL(STUB).href, resolve(ROOT, "scripts/post-publish-smoke.mjs")], { cwd: ROOT, env, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string };
    code = x.status ?? 1;
    out = `${x.stdout ?? ""}${x.stderr ?? ""}`;
  }
  const requests = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { code, out, lines: out.split("\n").filter(Boolean), requests };
}
const sentToBing = (r: Run) => r.requests.some((q) => q.method === "POST" && q.url.startsWith("https://www.bing.com/"));
const noPassThatDidNotCheck = (r: Run) => r.lines.filter((l) => l.startsWith("PASS") && /SKIPPED|UNVERIFIED|not run|not read|NOT SERVED|SPA fallback|NOT reachable/.test(l));

describe("the post-publish verifier: a check not run is SKIP, and the run is PARTIAL", () => {
  it("the zero-cost run (NO_SCAN=1) skips three checks, ends PARTIAL naming them, exits 0, and sends IndexNow nothing", () => {
    const r = smoke({ NO_SCAN: "1" }, "no-scan");
    expect(r.code, r.out).toBe(0);
    expect(r.lines.filter((l) => l.startsWith("FAIL")), "the stub answers every check the way a healthy deploy does").toEqual([]);
    expect(r.lines.filter((l) => l.startsWith("SKIP")).map((l) => l.split(" — ")[0])).toEqual(["SKIP  free scan end-to-end", "SKIP  AI generation live", "SKIP  engine version fresh"]);
    expect(noPassThatDidNotCheck(r)).toEqual([]);
    expect(r.out).not.toMatch(/ALL CLEAR/);
    expect(r.lines.at(-1)).toBe("PARTIAL — 3 check(s) not run, so this publish is not verified: free scan end-to-end, AI generation live, engine version fresh. Nothing that ran failed.");
    expect(r.out).toMatch(/INFO {2}IndexNow dry run: 1 URL\(s\), nothing sent \(the pass was not clean/);
    expect(sentToBing(r), "a pass that checked neither the report nor the engine told Bing").toBe(false);
  });

  it("a rate-limited scan is not read, so the report, the model and the engine are SKIP too", () => {
    const r = smoke({ SMOKE_STUB_SCAN: "429" }, "rate-limited");
    expect(r.code, r.out).toBe(0);
    expect(r.lines.filter((l) => l.startsWith("SKIP")).map((l) => l.split(" — ")[0])).toEqual(["SKIP  free scan end-to-end", "SKIP  AI generation live", "SKIP  engine version fresh"]);
    expect(noPassThatDidNotCheck(r)).toEqual([]);
    expect(r.lines.at(-1)).toMatch(/^PARTIAL — 3 check\(s\) not run/);
    expect(sentToBing(r)).toBe(false);
  });

  it("positive control: with every check run and passing, the same stub ends ALL CLEAR and the go-ahead sends", () => {
    const r = smoke({}, "clean");
    expect(r.code, r.out).toBe(0);
    expect(r.lines.filter((l) => /^(FAIL|SKIP)/.test(l))).toEqual([]);
    expect(r.lines).toContain(`PASS  engine version fresh — deployed ${ENGINE} == committed`);
    expect(r.lines.at(-1)).toBe("ALL CLEAR — publish verified.");
    expect(r.lines).toContain("PASS  IndexNow told what this publish changed: 1 URL(s), HTTP 202 (accepted)");
    expect(sentToBing(r)).toBe(true);
  });

  it("a reading that judges nothing is INFO, never PASS", () => {
    const r = smoke({ SMOKE_STUB_SPA: "1" }, "readings");
    expect(r.lines.some((l) => l.startsWith("PASS  prerendered pages served")), "the SPA fallback was a PASS").toBe(false);
    expect(r.lines.some((l) => l.startsWith("INFO  prerendered pages served — NOT SERVED"))).toBe(true);
    expect(r.lines.some((l) => l.startsWith("INFO  filed-wage panel: reader present"))).toBe(true);
    expect(r.lines.some((l) => l.startsWith("INFO  authorization server metadata read"))).toBe(true);
    expect(r.lines.some((l) => /^PASS {2}(filed-wage panel|authorization server metadata read)/.test(l))).toBe(false);
  });

  it("a failure still fails, and names the checks that did not run beside it", () => {
    const r = smoke({ NO_SCAN: "1", SMOKE_STUB_CHECKOUT: "sells" }, "failure");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\n1 FAILURE\(S\) — do not walk away:\n {2}- cut product checkout refuses \(410\): HTTP 200/);
    expect(r.out).toMatch(/\(and 3 check\(s\) not run: free scan end-to-end, AI generation live, engine version fresh\)/);
    expect(sentToBing(r)).toBe(false);
  });
});
