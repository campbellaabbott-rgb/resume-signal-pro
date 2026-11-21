// @vitest-environment node
//
// Node, not jsdom: section 76 runs in bash with a node stub for the network.
/**
 * THE PREVIOUS-PUBLISH LINE JUDGES FROM THE LIVE LEDGER (SEO audit
 * 2026-11-18, CRAWL18B-3).
 *
 * Section 76 F2a judged what became of the previous publish's posting URLs
 * from a sitemap verify-deploy.sh had saved at its last run, which was at
 * least one publish behind and absent on a machine that had not run it: a
 * publish nobody verified was never judged, and the line stood aside as INFO.
 * It now reads the live ledger, which names every posting URL in every state:
 * each live one, each that changed state in the 7 days before the ledger was
 * built, and a hashed sample of older ones must serve a page of its own with
 * the robots its state says. A machine with no saved sitemap judges too.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; status?: number; body?: string };
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url)=>{const u=String(url);
const r=routes.find((x)=>new RegExp(x.match).test(u));
return r?new Response(r.body??"",{status:r.status??200}):new Response("",{status:404});};
`;
function run76(routes: Route[]) {
  const dir = mkdtempSync(join(tmpdir(), "vd-c18b3-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "home"));
  writeFileSync(join(dir, "bin", "curl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=${SITE}; UA=ua\nJ() { echo '{}'; }\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/76-wave3-seo-content.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(dir, "home"),
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const f2a = (lines: string[]) => lines.filter((l) => /F2a/.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const HOME = `<html><head><title>Live Jobs Straight From Employers | Resume Booster</title><link rel="canonical" href="${SITE}/" /></head><body>home</body></html>`;
const page = (robots: string) => `<html><head><title>Supplier Engineer at Insulet</title><meta name="robots" content="${robots}"></head><body>Insulet</body></html>`;
const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const route = (path: string, body: string, status = 200): Route => ({ match: `^${esc(SITE + path)}$`, status, body });
const LIVE = "/jobs/posting/greenhouse/acme/1";
const INSULET = "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-2026-18592";
const OLD_GONE = "/jobs/posting/greenhouse/acme/2";
const LEDGER = { builtAt: "2026-11-21", pages: {}, postings: {
  [LIVE]: { state: "live", since: "2026-11-15" },
  [INSULET]: { state: "retired", since: "2026-11-19", basis: "ceiling" },
  [OLD_GONE]: { state: "gone", since: "2026-10-01" },
} };
const site = (insulet: string, extra: Route[] = [], ledger: unknown = LEDGER) => [
  route("/", HOME),
  route("/sitemap.xml", `<urlset><url><loc>${SITE}${LIVE}</loc><lastmod>2026-11-21</lastmod></url></urlset>`),
  route("/prerender-ledger.json", JSON.stringify(ledger)),
  route(LIVE, page("index, follow")),
  route(INSULET, insulet),
  route(OLD_GONE, page("noindex, follow")),
  ...extra,
];

describe("F2a on a machine that never saved a sitemap", () => {
  it("judges every URL the live ledger names, in every state, and passes when each serves its own page", () => {
    const lines = run76(site(page("noindex, follow")));
    expect(f2a(lines).some((l) => l.startsWith('PASS  3 posting URLs from the live ledger (1 live, 1 that changed state in the 7 days to 2026-11-21, 1 of 1 older ones): 1 live pages, 2 noindex "no longer listed" pages, 0 homepage copies (F2a)')), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO") && /F2a/.test(l)), show(lines)).toBe(false);
  });

  it("fails when a page the ledger retired serves the homepage copy, naming it", () => {
    const lines = run76(site(HOME));
    expect(f2a(lines).some((l) => l.startsWith("FAIL  3 posting URLs from the live ledger") && l.includes(`${INSULET} serves the homepage copy`)), show(lines)).toBe(true);
  });

  it("fails when a page serves robots its ledger state contradicts", () => {
    const lines = run76(site(page("index, follow")));
    expect(f2a(lines).some((l) => l.startsWith("FAIL  F2a: 1 posting URL(s) serve robots their ledger state contradicts") && l.includes(`${INSULET} is retired in the ledger and serves an indexable page`)), show(lines)).toBe(true);
  });

  it("an unreadable ledger is a FAIL, never a line that stands aside", () => {
    const lines = run76([route("/prerender-ledger.json", "", 503), ...site(page("noindex, follow"))]);
    expect(f2a(lines).some((l) => l.startsWith("FAIL  F2a: the live ledger answered 503")), show(lines)).toBe(true);
    expect(lines.some((l) => /F2a cannot judge/.test(l)), show(lines)).toBe(false);
  });
});
