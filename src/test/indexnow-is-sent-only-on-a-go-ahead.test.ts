// @vitest-environment node
//
// Node, not jsdom: the command-line half runs scripts/indexnow-ping.mjs and a
// cut of scripts/verify-deploy.sh as child processes.
/**
 * INDEXNOW IS SENT ONLY ON A GO-AHEAD (SEO/GEO audit 2026-11-07, IDX-05 / B11).
 *
 * The routine post-publish verify (`npm run verify:deploy`, which runs
 * scripts/post-publish-smoke.mjs) ended every clean pass by POSTing what the
 * publish changed to Bing's IndexNow endpoint unless NO_INDEXNOW was set: on
 * 2026-11-07 that was about 960 URLs, sent with nobody having said go. The
 * owner's rule (2026-11-07) is that every send needs a fresh go-ahead, given as
 * INDEXNOW_SEND=1. Without it every path is a dry run that prints the list
 * and its count: the verifier's step, the command line, and `submit` itself,
 * where the one network send lives. scripts/verify-deploy.sh, which only
 * reads, exports NO_INDEXNOW and drops any go-ahead before it starts anything.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { afterPublishPing, indexNowSendAllowed, INDEXNOW_KEY, submit, submitChanged } from "../../scripts/indexnow-ping.mjs";

vi.setConfig({ testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const BING = "https://www.bing.com/indexnow";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// A live publish of 2026-11-08: two pages dated that day, one posting retired that day.
const SITEMAP = `<urlset>
  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>2026-11-08</lastmod>\n  </url>
  <url>\n    <loc>${SITE}/guides/x</loc>\n    <lastmod>2026-07-06</lastmod>\n  </url>
  <url>\n    <loc>${SITE}/pricing</loc>\n    <lastmod>2026-11-08</lastmod>\n  </url>
</urlset>`;
const LEDGER = JSON.stringify({ builtAt: "2026-11-08", postings: { "/jobs/posting/workday/a~wd1~x/1": { state: "gone", since: "2026-11-08" } }, pages: {} });

type Call = { url: string; method: string };
/** A site and a Bing that answer like the real ones, and remember every request. */
function liveSite() {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    if (url === `${SITE}/sitemap.xml`) return new Response(SITEMAP, { status: 200 });
    if (url === `${SITE}/prerender-ledger.json`) return new Response(LEDGER, { status: 200 });
    if (url === `${SITE}/${INDEXNOW_KEY}.txt`) return new Response(INDEXNOW_KEY, { status: 200 });
    if (url === BING) return new Response("", { status: 202 });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const sent = () => calls.filter((c) => c.url === BING || c.method !== "GET");
  return { calls, fetchImpl, sent };
}

describe("the go-ahead is INDEXNOW_SEND=1 and nothing else", () => {
  it("only the exact value 1 is a go-ahead, and NO_INDEXNOW overrules it", () => {
    expect(indexNowSendAllowed({ INDEXNOW_SEND: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", "TRUE", " 1"]) expect(indexNowSendAllowed({ INDEXNOW_SEND: v }), String(v)).toBe(false);
    expect(indexNowSendAllowed({})).toBe(false);
    expect(indexNowSendAllowed({ INDEXNOW_SEND: "1", NO_INDEXNOW: "1" })).toBe(false);
  });
});

describe("with no go-ahead set, the publish ping lists what changed and sends nothing", () => {
  it("the verifier's step reads the live sitemap and ledger, prints the dry-run list with its count, and never posts", async () => {
    const site = liveSite();
    const ping = await afterPublishPing({ env: {}, clean: true, fetchImpl: site.fetchImpl });
    expect(site.sent()).toEqual([]);
    expect(site.calls.map((c) => c.url)).toEqual([`${SITE}/sitemap.xml`, `${SITE}/prerender-ledger.json`]);
    expect(ping.status).toBe("INFO");
    expect(ping.line).toBe("IndexNow dry run: 3 URL(s), nothing sent (sending needs INDEXNOW_SEND=1, the owner's go-ahead)");
    expect(ping.report).toMatch(/^# IndexNow DRY RUN — what this publish changed: nothing was sent\./);
    for (const u of [`${SITE}/`, `${SITE}/pricing`, `${SITE}/jobs/posting/workday/a~wd1~x/1`]) expect(ping.report.split("\n")).toContain(u);
  });

  it("submitChanged and submit hold the send themselves when the caller asks for one without the go-ahead", async () => {
    const site = liveSite();
    const changed = await submitChanged({ fetchImpl: site.fetchImpl, env: {} });
    expect(changed).toMatchObject({ submitted: 0, dryRun: true, held: true });
    expect(site.sent()).toEqual([]);
    const direct = liveSite();
    const r = await submit([`${SITE}/`], { fetchImpl: direct.fetchImpl, env: { INDEXNOW_SEND: "true" } });
    expect(r).toMatchObject({ submitted: 0, dryRun: true, held: true });
    expect(r.reason).toMatch(/sending needs INDEXNOW_SEND=1/);
    expect(direct.calls).toEqual([]);
  });

  it("a go-ahead on a pass that was not clean still sends nothing", async () => {
    const site = liveSite();
    const ping = await afterPublishPing({ env: { INDEXNOW_SEND: "1" }, clean: false, fetchImpl: site.fetchImpl });
    expect(site.sent()).toEqual([]);
    expect(ping.line).toMatch(/^IndexNow dry run: 3 URL\(s\), nothing sent \(the pass was not clean/);
  });

  it("NO_INDEXNOW skips the step altogether, go-ahead or not", async () => {
    const site = liveSite();
    const ping = await afterPublishPing({ env: { NO_INDEXNOW: "1", INDEXNOW_SEND: "1" }, clean: true, fetchImpl: site.fetchImpl });
    expect(site.calls).toEqual([]);
    expect(ping).toMatchObject({ status: "INFO", report: "" });
  });

  it("positive control: with INDEXNOW_SEND=1 on a clean pass the same step checks the key and posts to Bing", async () => {
    const site = liveSite();
    const ping = await afterPublishPing({ env: { INDEXNOW_SEND: "1" }, clean: true, fetchImpl: site.fetchImpl });
    expect(site.sent()).toEqual([{ url: BING, method: "POST" }]);
    expect(ping).toMatchObject({ status: "PASS", line: "IndexNow told what this publish changed: 3 URL(s), HTTP 202 (accepted)" });
  });
});

describe("the post-publish verifier goes through the gate", () => {
  const smoke = codeOf(readFileSync(resolve(ROOT, "scripts/post-publish-smoke.mjs"), "utf8"));
  it("section 9 hands the gate its whole environment and whether the pass was clean", () => {
    expect(smoke).toMatch(/await afterPublishPing\(\{ env: process\.env, clean: results\.every\(\(r\) => r\.ok\) \}\)/);
    expect(smoke).toMatch(/if \(ping\.report\) process\.stdout\.write\(ping\.report\);/);
  });
  it("and never calls a sender of its own", () => {
    expect(smoke).not.toMatch(/\bsubmitChanged\s*\(/);
    expect(smoke).not.toMatch(/\bsubmit\s*\(/);
    expect(smoke).not.toMatch(/bing\.com/);
  });
});

/** Run scripts/indexnow-ping.mjs with node's fetch replaced by a stub that logs every request. */
function runCli(args: string[], env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "indexnow-cli-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), `const fs=require("fs");
globalThis.fetch=async(url,init)=>{const u=String(url);fs.appendFileSync(process.env.IN_CALLS,((init&&init.method)||"GET")+" "+u+"\\n");
if(u.endsWith(".txt"))return new Response(${JSON.stringify(INDEXNOW_KEY)},{status:200});
return new Response("",{status:202});};
`);
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "urls.txt"), "/privacy\n/jobs/company/dominos\n");
  const out = execFileSync(process.execPath, ["scripts/indexnow-ping.mjs", ...args.map((a) => (a === "URLS" ? join(dir, "urls.txt") : a))], {
    cwd: ROOT, encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH ?? "", HOME: dir, IN_CALLS: join(dir, "calls.log"), NODE_OPTIONS: `--require ${join(dir, "fetch.cjs")}`, ...env },
  });
  return { out, calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}

describe("the command line is a dry run unless it is given the go-ahead", () => {
  it("a --urls run with no INDEXNOW_SEND prints the list and makes no request at all", () => {
    const { out, calls } = runCli(["--urls", "URLS"], {});
    expect(calls).toEqual([]);
    expect(out).toMatch(/# IndexNow DRY RUN — .*urls\.txt: nothing was sent\./);
    expect(out).toMatch(/^https:\/\/resumebooster\.work\/privacy$/m);
    expect(out).toMatch(/IndexNow: nothing submitted \(dry run — 2 URL\(s\) listed, none sent; sending needs INDEXNOW_SEND=1, the owner's go-ahead\)/);
  });

  it("positive control: the same run with INDEXNOW_SEND=1 checks the key and posts", () => {
    const { out, calls } = runCli(["--urls", "URLS"], { INDEXNOW_SEND: "1" });
    expect(calls).toEqual([`GET ${SITE}/${INDEXNOW_KEY}.txt`, `POST ${BING}`]);
    expect(out).toMatch(/Submitted 2 URLs to IndexNow — HTTP 202 \(accepted\)/);
  });
});

describe("scripts/verify-deploy.sh sends nothing, whatever the calling shell holds", () => {
  const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
  const lines = SCRIPT.split("\n");
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  const exportAt = at(/^export NO_INDEXNOW=1$/);
  const unsetAt = at(/^unset INDEXNOW_SEND$/);
  const wrapperAt = at(/^if \[ -z "\$\{VD_INNER:-\}" \]; then$/);

  it("sets NO_INDEXNOW and drops INDEXNOW_SEND before the tally re-runs it, so the inner run inherits both", () => {
    expect(exportAt, "export NO_INDEXNOW=1 is gone from verify-deploy.sh").toBeGreaterThan(0);
    expect(unsetAt, "unset INDEXNOW_SEND is gone from verify-deploy.sh").toBeGreaterThan(0);
    expect(wrapperAt, "the tally wrapper moved").toBeGreaterThan(0);
    expect(exportAt).toBeLessThan(wrapperAt);
    expect(unsetAt).toBeLessThan(wrapperAt);
  });

  it("a go-ahead exported by the caller is no go-ahead inside the run", () => {
    const block = [lines[exportAt], lines[unsetAt]].join("\n");
    // The module's path rides in the environment, not argv: a module named in
    // argv[1] would take itself for the command line and run.
    const ask = `node --input-type=module -e 'const m = await import(process.env.IN_MOD); console.log(String(m.indexNowSendAllowed(process.env)))'`;
    const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`, INDEXNOW_SEND: "1", IN_MOD: resolve(ROOT, "scripts/indexnow-ping.mjs") };
    const out = execFileSync("bash", ["-c", `${block}\n${ask}`], { encoding: "utf8", env });
    expect(out.trim()).toBe("false");
    const without = execFileSync("bash", ["-c", ask], { encoding: "utf8", env });
    expect(without.trim(), "positive control: without the two lines the caller's go-ahead would carry").toBe("true");
  });
});
