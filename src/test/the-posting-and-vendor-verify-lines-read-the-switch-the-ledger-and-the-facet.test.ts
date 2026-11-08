// @vitest-environment node
/**
 * THE POSTING AND VENDOR VERIFY LINES READ THE SWITCH, THE LEDGER AND THE
 * FACET (the fix round of 2026-11-08).
 *
 * Two lines of scripts/verify-deploy.sh would have read a correct publish as
 * a broken one:
 *   - 5v demanded a JobPosting block on each sampled posting page and a
 *     jobLocation on the first. It did not read the owner's STOP switch, so
 *     the publish the STOP rule prescribes (JOB_POSTING_MARKUP false) FAILed
 *     every page; it did not read the ledger, so a page the bake withholds
 *     markup from FAILed; and a fully remote page, which carries
 *     applicantLocationRequirements and no town, FAILed the entity check.
 *   - 5w FAILed whenever the served /jobs document held the word USAJOBS
 *     anywhere. The #org description every page carries now names it (the
 *     board's per-source facet counts its rows), so 5w FAILed a page that
 *     offers no USAJOBS to anyone.
 * Each section is cut out of the script and run in bash against a fake curl,
 * in a working directory holding the two config files they read.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const VENDORS = readFileSync(resolve(ROOT, "src/config/ats-vendors.ts"), "utf8");
const TITLE_FN = /^title\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const SITE = "https://site.test";
const B = "https://p.supabase.co";
const between = (from: string, to: string) => {
  const a = SCRIPT.indexOf(from), b = SCRIPT.indexOf(to);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return SCRIPT.slice(a, b);
};
const S5V = between('echo "== 5v.', 'echo "== 5w.');
const S5W = between('echo "== 5w.', 'echo "== 5x.');

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; body: string };
const CURL = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const url=process.argv.slice(2).find((a)=>/^https?:/.test(a))||"";
const r=routes.find((x)=>new RegExp(x.match).test(url));
process.stdout.write(r?r.body:"");
`;

/** Run one section in bash, with curl answering from `routes`, in a directory holding the switch and the vendor list. */
function run(section: string, routes: Route[], opts: { markup?: "true" | "false"; vendors?: string } = {}): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-5vw-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "tmp"));
  mkdirSync(join(dir, "cwd/src/config"), { recursive: true });
  writeFileSync(join(dir, "cwd/src/config/seo-switches.ts"), `export const JOB_POSTING_MARKUP = ${opts.markup ?? "true"};\n`);
  writeFileSync(join(dir, "cwd/src/config/ats-vendors.ts"), opts.vendors ?? VENDORS);
  writeFileSync(join(dir, "bin/curl.cjs"), CURL);
  writeFileSync(join(dir, "bin/curl"), `#!/bin/sh\nexec node "${join(dir, "bin/curl.cjs")}" "$@"\n`);
  chmodSync(join(dir, "bin/curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  const body = section.split("/tmp/").join(`${join(dir, "tmp")}/`);
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; RB=; B=${B}; SITE=${SITE}; UA=ua\n${TITLE_FN}\n${body}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: join(dir, "cwd"), env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const at = (path: string, body: string): Route => ({ match: `^${esc(SITE + path)}$`, body });
const has = (lines: string[], level: string, re: RegExp) => lines.some((l) => l.startsWith(level) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

// ── 5v ──────────────────────────────────────────────────────────────────────
const A = "/jobs/posting/workday/acme~wd1~Ext/R1";
const C = "/jobs/posting/workday/acme~wd1~Ext/R2";
const N = "/jobs/posting/workday/acme~wd1~Ext/R3";
const OFFICE = { "@type": "JobPosting", title: "Nurse", description: "d", datePosted: "2026-11-01", validThrough: "2026-11-30T23:59:59+00:00", hiringOrganization: { name: "Acme" }, jobLocation: { "@type": "Place", address: { addressCountry: "US", addressLocality: "Austin" } } };
const REMOTE = { "@type": "JobPosting", title: "Engineer", description: "d", datePosted: "2026-11-01", validThrough: "2026-11-30T23:59:59+00:00", hiringOrganization: { name: "Acme" }, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "US" } };
const page = (title: string, ld: object | null) =>
  `<html><head><title>${title}</title><link rel="canonical" href="${SITE}/x" />${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ""}</head><body></body></html>`;
const postingSite = (pages: Record<string, string>, ledger: Record<string, object>): Route[] => [
  at("/sitemap.xml", `<urlset>${Object.keys(pages).map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`),
  at("/prerender-ledger.json", JSON.stringify({ postings: ledger })),
  at("/", "<html><head><title>Resume Booster</title></head></html>"),
  ...Object.entries(pages).map(([p, b]) => at(p, b)),
];

describe("5v reads the STOP switch, the ledger's withheld pages and a remote page's location", () => {
  it("switch on: a page with markup passes, a page the ledger withholds passes with none, and a remote page's entity passes on its applicant country", () => {
    const lines = run(S5V, postingSite(
      { [C]: page("Engineer at Acme", REMOTE), [A]: page("Nurse at Acme", OFFICE), [N]: page("Clerk at Acme", null) },
      { [C]: { state: "live" }, [A]: { state: "live" }, [N]: { state: "live", markupWithheld: "name" } },
    ));
    expect(has(lines, "FAIL", /./), show(lines)).toBe(false);
    expect(has(lines, "PASS", /R3 .*JobPosting blocks 0, want 0: the ledger withholds its markup \(name\)/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /exactly one parseable JobPosting entity with every required property/), show(lines)).toBe(true);
  });

  it("switch off: pages with no markup pass, and the entity check says it has nothing to read", () => {
    const lines = run(S5V, postingSite({ [A]: page("Nurse at Acme", null), [C]: page("Engineer at Acme", null) }, {}), { markup: "false" });
    expect(has(lines, "FAIL", /./), show(lines)).toBe(false);
    expect(has(lines, "PASS", /R1 .*JobPosting blocks 0, want 0: the STOP switch is off/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /no sampled posting page is meant to carry markup/), show(lines)).toBe(true);
  });

  it("FAILs markup the switch or the ledger withholds, and a live page without it", () => {
    const off = run(S5V, postingSite({ [A]: page("Nurse at Acme", OFFICE) }, {}), { markup: "false" });
    expect(has(off, "FAIL", /R1 .*jobposting=1 \(want 0: the STOP switch is off\)/), show(off)).toBe(true);
    const withheld = run(S5V, postingSite({ [N]: page("Clerk at Acme", OFFICE) }, { [N]: { state: "live", markupWithheld: "name" } }));
    expect(has(withheld, "FAIL", /R3 .*jobposting=1 \(want 0: the ledger withholds its markup \(name\)\)/), show(withheld)).toBe(true);
    const bare = run(S5V, postingSite({ [A]: page("Nurse at Acme", null) }, { [A]: { state: "live", markupWithheld: "switch" } }));
    expect(has(bare, "FAIL", /R1 .*jobposting=0 \(want at least 1: the STOP switch is on\)/), show(bare)).toBe(true);
  });

  it("FAILs an entity with neither a place nor, on a remote page, an applicant country", () => {
    const { applicantLocationRequirements: _drop, ...noCountry } = REMOTE;
    const lines = run(S5V, postingSite({ [C]: page("Engineer at Acme", noCountry) }, {}));
    expect(has(lines, "FAIL", /exactly one parseable JobPosting entity with every required property.* \(entities 1, problems 1\)/), show(lines)).toBe(true);
  });
});

// ── 5w ──────────────────────────────────────────────────────────────────────
const DIGITS = `<html><body>${"1234567890 ".repeat(4)}</body></html>`;
const FACET_RE = `^${esc(`${B}/rest/v1/rpc/get_board_vendor_counts`)}`;
const vendorSite = (jobs: string, facet: object | string): Route[] => [
  ...["/ghost-job-index", "/pay-transparency", "/hiring-trends", "/entry-level-index"].map((p) => at(p, DIGITS)),
  at("/jobs", jobs),
  { match: FACET_RE, body: typeof facet === "string" ? facet : JSON.stringify(facet) },
];
const ORG_NAMING = `<html><head><script type="application/ld+json">{"@type":"Organization","description":"read from employers' own hiring systems and USAJOBS"}</script></head><body><select><option>Workday</option><option>Greenhouse</option></select></body></html>`;
const MENU_OFFERING = `<html><head></head><body><select><option>Workday</option><option>USAJOBS</option></select></body></html>`;
const SERVING_MARKED = VENDORS.replace(/\{ key: "usajobs", label: "USAJOBS", serving: false \}/, '{ key: "usajobs", label: "USAJOBS" }');

describe("5w judges what a reader of /jobs sees against the board's own per-source facet", () => {
  it("the dormancy marker this test edits is in the vendor list as the test spells it", () => {
    expect(SERVING_MARKED).not.toBe(VENDORS);
  });

  it("passes a /jobs whose only USAJOBS is the #org description, while the facet counts its rows", () => {
    const lines = run(S5W, vendorSite(ORG_NAMING, { sourcesFacet: { workday: 444534, usajobs: 17744 } }));
    expect(has(lines, "FAIL", /./), show(lines)).toBe(false);
    expect(has(lines, "INFO", /the facet counts 17744 USAJOBS rows/), show(lines)).toBe(true);
  });

  it("FAILs a /jobs that offers USAJOBS to a reader while the facet counts none", () => {
    const lines = run(S5W, vendorSite(MENU_OFFERING, { sourcesFacet: { workday: 444534 } }));
    expect(has(lines, "FAIL", /the facet counts 0 USAJOBS rows and \/jobs offers USAJOBS in its visible text/), show(lines)).toBe(true);
    const quiet = run(S5W, vendorSite(ORG_NAMING, { sourcesFacet: { workday: 444534 } }));
    expect(has(quiet, "PASS", /the facet counts 0 USAJOBS rows and \/jobs does not offer it/), show(quiet)).toBe(true);
  });

  it("reports a dormancy marker that disagrees with the facet, in either direction", () => {
    const dormant = run(S5W, vendorSite(ORG_NAMING, { sourcesFacet: { usajobs: 17744 } }));
    expect(has(dormant, "INFO", /marks usajobs dormant \(serving: false\) while the facet counts 17744 rows/), show(dormant)).toBe(true);
    const serving = run(S5W, vendorSite(ORG_NAMING, { sourcesFacet: { workday: 1 } }), { vendors: SERVING_MARKED });
    expect(has(serving, "FAIL", /marks usajobs as serving while the facet counts 0 rows/), show(serving)).toBe(true);
  });

  it("says it cannot judge when the facet does not answer", () => {
    const lines = run(S5W, vendorSite(MENU_OFFERING, "<html>gateway</html>"));
    expect(has(lines, "INFO", /the board.s per-source facet could not be read/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /USAJOBS/), show(lines)).toBe(false);
  });
});
