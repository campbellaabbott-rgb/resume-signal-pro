// @vitest-environment node
/**
 * PD HOTFIX 2026-10-24: VERIFY 81i TIMES THE COMPANY READER ON WORKDAY TOKENS.
 *
 * 81g asked get_company_intel one question, about stripe, and stayed green
 * while every Workday token answered 500 57014 after 15 seconds. 81i asks it
 * about three Workday company pages the sitemap listed and one made-up
 * Workday token, and passes only a 200 carrying the reader object within
 * 3 seconds. Its judging block runs here against fixture files (the
 * /tmp/vd_81_ prefix pointed at a temp dir), the way
 * the-accuracy-verifier-can-fail-every-claim-it-makes.test.ts runs 81a-81h:
 * every line FAILs on what production answered on 2026-10-24 at 22:21Z and
 * PASSes on a fixture of what the fix serves, and each way to half-pass
 * (slow, wrong shape, not probed) is its own FAIL.
 *
 * The fix round (2026-10-24 review): a fast 200 carrying an EMPTY reader
 * object passed 81i, so a migration that answered quickly with no facts would
 * have verified. The three real tokens now also need a Workday source with
 * open roles and places or fields; the made-up token keeps the shape rule.
 * And 81j reads the baked crawler copy of the same three pages (the bake
 * drops facts silently past its 90-second deadline), with Domino's as the
 * positive control: on 2026-10-24 none of the three carried a fact line and
 * Domino's carried two.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SH = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/81-profiles-design-accuracy.sh"), "utf8");
const blocks = [...SH.matchAll(/node -e '([^']*)'/g)].map((m) => m[1]);
const probe = blocks.find((b) => b.includes("/tmp/vd_81_workday.json") && b.includes("writeFileSync")) ?? "";
const judge = blocks.find((b) => b.includes("/tmp/vd_81_workday.json") && b.includes("const out = ")) ?? "";
const bakedProbe = blocks.find((b) => b.includes("/tmp/vd_81_baked.json") && b.includes("writeFileSync")) ?? "";
const bakedJudge = blocks.find((b) => b.includes("/tmp/vd_81_baked.json") && b.includes("const out = ")) ?? "";

const REAL = ["cat~wd5~caterpillarcareers", "nvidia~wd5~NVIDIAExternalCareerSite", "dollartree~wd5~dollartreeus"];
const MADE_UP = "zzzz-none~wd1~Careers";
const TIMEOUT = `{"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}`;
// The reader object in its live shape (stripe, 2026-10-24): open_by_source is an array of { source, open_roles }.
const READER = (usd: number) =>
  JSON.stringify({ usd_n: usd, net_7d: usd ? -3 : null, countries: usd ? [{ n: usd, country: "US" }] : [], categories: [], open_by_source: usd ? [{ source: "workday", open_roles: usd }] : [] });
/** A fast 200 that carries the reader object and reads nothing: what a quick but wrong body answers. */
const EMPTY_READER = JSON.stringify({ usd_n: 0, net_7d: null, countries: [], categories: [], open_by_source: [] });

type Probe = { token: string; madeUp: boolean; status: number; ms: number; body: string; inSitemap: boolean | null };
const probeOf = (token: string, status: number, ms: number, body: string, inSitemap: boolean | null = true): Probe =>
  ({ token, madeUp: token === MADE_UP, status, ms, body, inSitemap: token === MADE_UP ? null : inSitemap });

function run(file: object | null, block = judge, name = "vd_81_workday.json"): string[] {
  expect(block.length, "the judging block was not found").toBeGreaterThan(500);
  const dir = mkdtempSync(join(tmpdir(), "vd-81i-"));
  if (file) writeFileSync(join(dir, name), JSON.stringify(file));
  const code = block.split("/tmp/vd_81_").join(join(dir, "vd_81_"));
  return execFileSync(process.execPath, ["-e", code], { encoding: "utf8" }).split("\n").filter(Boolean);
}
const show = (lines: string[]) => lines.join("\n");

// What production answered on 2026-10-24 at 22:21Z (the 81i probe, run live).
const BEFORE = {
  at: "2026-10-24T22:21:55Z",
  probes: [
    probeOf(REAL[0], 500, 15190, TIMEOUT), probeOf(REAL[1], 500, 15300, TIMEOUT),
    probeOf(REAL[2], 500, 15130, TIMEOUT), probeOf(MADE_UP, 500, 15120, TIMEOUT),
  ],
};
const AFTER = {
  at: "2026-10-25T00:00:00Z",
  probes: [
    probeOf(REAL[0], 200, 640, READER(212)), probeOf(REAL[1], 200, 410, READER(1800)),
    probeOf(REAL[2], 200, 520, READER(95)), probeOf(MADE_UP, 200, 300, READER(0)),
  ],
};

describe("81i: get_company_intel answers Workday tokens within 3 seconds", () => {
  it("both blocks were found, and the probe is read-only (GETs: no method, no request body)", () => {
    expect(probe.length).toBeGreaterThan(500);
    expect(probe).not.toMatch(/method\s*:/);
    const fetchOptions = [...probe.matchAll(/fetch\([^,]+,\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(fetchOptions.length, "the sitemap GET and the reader GET").toBe(2);
    for (const o of fetchOptions) expect(o.replace(/\s+/g, " ").trim(), "fetch options carry headers and a timeout only").toMatch(/^(headers: H, )?signal: AbortSignal\.timeout\(\d+\)$/);
    expect(probe).toMatch(/rpc\/get_company_intel\?p_token=\$\{encodeURIComponent\(token\)\}/);
    for (const t of [...REAL, MADE_UP]) expect(probe, t).toContain(`"${t}"`);
    expect(probe, "a reply slower than the 15 s statement cap is still timed").toMatch(/AbortSignal\.timeout\(30000\)/);
  });

  it("FAILs on what production answered on 2026-10-24: each line names the token, the status, the code and the time", () => {
    const lines = run(BEFORE);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines.filter((l) => l.startsWith("FAIL")).length, show(lines)).toBe(4);
    expect(lines, show(lines)).toContain(
      "FAIL  81i cat~wd5~caterpillarcareers: get_company_intel answered HTTP 500 57014 in 15.19 s, want 200 within 3 s: a statement timeout, the hosting-tenant test running once per row (is 20261012137000 applied?)",
    );
    expect(lines.some((l) => l.startsWith("FAIL") && l.includes(`${MADE_UP} (made up`) && l.includes("HTTP 500 57014 in 15.12 s")), show(lines)).toBe(true);
  });

  it("PASSes on what the fix serves, printing what each reply read", () => {
    const lines = run(AFTER);
    expect(lines.filter((l) => !l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe("PASS  81i cat~wd5~caterpillarcareers: get_company_intel answered 200 in 0.64 s, within 3 s, with facts [usd_n 212, 1 countries, 0 fields, net_7d -3, workday open 212]");
    expect(lines[3]).toMatch(/^PASS {2}81i zzzz-none~wd1~Careers \(made up: no postings, no override\): get_company_intel answered 200 in 0\.30 s/);
  });

  it("a fast 200 with an empty reader object FAILs on a real Workday page (the review's case), and the made-up token keeps the shape rule", () => {
    const real = run({ ...AFTER, probes: [probeOf(REAL[0], 200, 400, EMPTY_READER)] });
    expect(real, show(real)).toEqual(["FAIL  81i cat~wd5~caterpillarcareers: get_company_intel answered 200 in 0.40 s but read no facts: no Workday source with open roles in open_by_source, 0 countries, 0 fields (the page would print none)"]);
    const madeUp = run({ ...AFTER, probes: [probeOf(MADE_UP, 200, 300, EMPTY_READER)] });
    expect(madeUp[0], show(madeUp)).toMatch(/^PASS {2}81i zzzz-none~wd1~Careers \(made up/);
  });

  it("a real page whose reply names only a non-Workday source, or Workday with no open roles, or no places and no fields, FAILs", () => {
    const body = (o: object) => JSON.stringify({ usd_n: 5, net_7d: 1, countries: [{ n: 5, country: "US" }], categories: [{ n: 5, category: "retail" }], open_by_source: [{ source: "workday", open_roles: 5 }], ...o });
    for (const b of [
      body({ open_by_source: [{ source: "greenhouse", open_roles: 5 }] }),
      body({ open_by_source: [{ source: "workday", open_roles: 0 }] }),
      body({ countries: [], categories: [] }),
    ]) {
      const lines = run({ ...AFTER, probes: [probeOf(REAL[1], 200, 500, b)] });
      expect(lines[0], b).toMatch(/^FAIL {2}81i nvidia~wd5~NVIDIAExternalCareerSite: get_company_intel answered 200 in 0\.50 s but read no facts/);
    }
    const ok = run({ ...AFTER, probes: [probeOf(REAL[1], 200, 500, body({ countries: [] }))] });
    expect(ok[0], "fields alone are a fact the page prints").toMatch(/^PASS/);
  });

  it("a 200 slower than 3 seconds FAILs (the reader answered, but a reader waits that long for it)", () => {
    const lines = run({ ...AFTER, probes: [probeOf(REAL[1], 200, 3400, READER(1800))] });
    expect(lines, show(lines)).toEqual(["FAIL  81i nvidia~wd5~NVIDIAExternalCareerSite: get_company_intel answered HTTP 200 in 3.40 s, want 200 within 3 s"]);
  });

  it("a fast 200 without the reader object FAILs (an empty array or an error body is not the panel)", () => {
    for (const body of ["[]", "null", `{"message":"ok"}`]) {
      const lines = run({ ...AFTER, probes: [probeOf(REAL[2], 200, 200, body)] });
      expect(lines.length, body).toBe(1);
      expect(lines[0], body).toMatch(/^FAIL {2}81i dollartree~wd5~dollartreeus: get_company_intel answered 200 in 0\.20 s but not with the reader object/);
    }
  });

  it("a probe that never answered FAILs with status 0, and no probe file at all FAILs as not probed", () => {
    const lines = run({ ...AFTER, probes: [probeOf(REAL[0], 0, 30010, "TimeoutError")] });
    expect(lines, show(lines)).toEqual(["FAIL  81i cat~wd5~caterpillarcareers: get_company_intel answered HTTP 0 in 30.01 s, want 200 within 3 s"]);
    expect(run(null)).toEqual(["FAIL  81i get_company_intel on Workday tokens: not probed"]);
    expect(run({ at: "x", probes: [] })).toEqual(["FAIL  81i get_company_intel on Workday tokens: not probed"]);
  });

  it("a token the sitemap no longer lists is still judged, and the section says to swap it", () => {
    const lines = run({ ...AFTER, probes: [probeOf(REAL[0], 200, 500, READER(10), false)] });
    expect(lines[0]).toMatch(/^PASS/);
    expect(lines[1]).toMatch(/^INFO {2}81i cat~wd5~caterpillarcareers is no longer in the live sitemap/);
  });
});

// ── 81j: the baked crawler copy of the same Workday pages ──────────────────
const FACT_LINE = (what: "countries" | "fields") =>
  `<h2>Where its open roles are</h2><p>The ${what} holding the most of its roles on this board: <a href="/jobs/company/x?country=US">United States</a>.</p>`;
const page = (name: string, facts: string) =>
  `<html><head><title>${name} jobs: 100 open roles from their own hiring system</title><link rel="canonical" href="https://resumebooster.work/jobs/company/x" /></head><body><h1>${name}</h1>${facts}</body></html>`;
const HOME_SHELL = `<html><head><title>Resume Booster — 900,000+ Live Jobs Straight From Employers</title></head><body>home</body></html>`;
type Baked = { token: string; control: boolean; status: number; body: string };
const bakedOf = (token: string, status: number, body: string): Baked => ({ token, control: token === "dominos", status, body });
const BAKED_BEFORE = {
  at: "2026-10-24T23:30:00Z",
  home: HOME_SHELL,
  pages: [
    bakedOf(REAL[0], 200, page("Caterpillar", "")), bakedOf(REAL[1], 200, page("NVIDIA", "")),
    bakedOf(REAL[2], 200, page("Dollar Tree", "")), bakedOf("dominos", 200, page("Domino's", FACT_LINE("countries") + FACT_LINE("fields"))),
  ],
};
const BAKED_AFTER = {
  ...BAKED_BEFORE,
  pages: [
    bakedOf(REAL[0], 200, page("Caterpillar", FACT_LINE("countries") + FACT_LINE("fields"))), bakedOf(REAL[1], 200, page("NVIDIA", FACT_LINE("fields"))),
    bakedOf(REAL[2], 200, page("Dollar Tree", FACT_LINE("countries"))), bakedOf("dominos", 200, page("Domino's", FACT_LINE("countries") + FACT_LINE("fields"))),
  ],
};
const runBaked = (f: object | null) => run(f, bakedJudge, "vd_81_baked.json");

describe("81j: the baked Workday company pages state their places or fields", () => {
  it("both blocks were found, and the probe is read-only GETs with the crawler's UA", () => {
    expect(bakedProbe.length).toBeGreaterThan(300);
    expect(bakedProbe).not.toMatch(/method\s*:/);
    expect(bakedProbe).toMatch(/"User-Agent": UA/);
    for (const t of [...REAL, "dominos"]) expect(bakedProbe, t).toContain(`"${t}"`);
    expect(bakedProbe).toMatch(/\/jobs\/company\/\$\{encodeURIComponent\(token\)\}/);
  });

  it("FAILs on what production served on 2026-10-24 (no Workday page carries a fact line; Domino's carries two)", () => {
    const lines = runBaked(BAKED_BEFORE);
    expect(lines.filter((l) => l.startsWith("PASS") && REAL.some((r) => l.includes(r))), show(lines)).toEqual([]);
    for (const t of REAL) expect(lines.some((l) => l.startsWith(`FAIL  81j ${t}: the baked page states neither where its roles are nor in which fields`)), show(lines)).toBe(true);
    expect(lines.some((l) => /^PASS {2}81j dominos \(positive control\): the baked page states 2 fact line/.test(l)), show(lines)).toBe(true);
  });

  it("PASSes when each Workday page states places or fields", () => {
    const lines = runBaked(BAKED_AFTER);
    expect(lines.filter((l) => !l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines).toContain("PASS  81j cat~wd5~caterpillarcareers: the baked page states where its roles are and in which fields (2 fact lines)");
    expect(lines.length).toBe(4);
  });

  it("a page served as the homepage shell, an error, or no probe at all FAILs; a control without facts says the bake wrote none anywhere", () => {
    const shell = runBaked({ ...BAKED_AFTER, pages: [bakedOf(REAL[2], 200, HOME_SHELL)] });
    expect(shell[0], show(shell)).toMatch(/^FAIL {2}81j dollartree~wd5~dollartreeus: served the homepage shell to a crawler/);
    const err = runBaked({ ...BAKED_AFTER, pages: [bakedOf(REAL[0], 503, "")] });
    expect(err[0], show(err)).toMatch(/^FAIL {2}81j cat~wd5~caterpillarcareers: HTTP 503/);
    expect(runBaked(null)).toEqual(["FAIL  81j the baked Workday company pages: not probed"]);
    const noControl = runBaked({ ...BAKED_BEFORE, pages: [bakedOf("dominos", 200, page("Domino's", ""))] });
    expect(noControl[0], show(noControl)).toMatch(/^FAIL {2}81j dominos \(positive control\): the baked page states no fact line either: this bake wrote no places or fields on any page/);
  });
});
