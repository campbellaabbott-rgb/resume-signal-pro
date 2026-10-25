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
 * And 81j reads the baked crawler copy (the bake drops facts silently past
 * its 90-second deadline). The recheck of 2026-10-25 found that reading three
 * of the largest pages, which the bake reads first, PASSed a bake that cut
 * its tail; 81j now samples 24 Workday pages from the live sitemap (its last
 * 8 and 16 spread over the rest) and needs 90% of them to state a fact line.
 * On 2026-10-25 none of the 283 did (the recorded fixture).
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

// ── 81j: a sample of the sitemap's baked Workday pages ─────────────────────
// The recheck of 2026-10-25: 81j read three of the largest Workday pages, which
// the bake reads first, so a bake that ran past its 90-second intel deadline
// and dropped the facts of every later page still PASSed. 81j now samples 24
// Workday pages from the live sitemap (its last 8 and 16 spread over the
// rest) and needs at least 90% of them to state a fact line.
const PLACES = "The countries holding the most of its roles on this board:";
const FIELDS = "The fields holding the most of its roles on this board:";
const SITE = "https://resumebooster.work";
const LIVE_81J = JSON.parse(readFileSync(resolve(ROOT, "src/test/fixtures/verify-81j-live-2026-10-25.json"), "utf8"));
const factLine = (marker: string) => `<p>${marker} <a href="/jobs/company/x?country=US">United States</a>.</p>`;
const baked = (token: string, facts: string) =>
  `<html><head><title>${token} jobs: 100 open roles from their own hiring system</title><link rel="canonical" href="${SITE}/jobs/company/${token}" /></head><body>${facts}</body></html>`;
const HOME_SHELL = `<html><head><title>Resume Booster: Live Jobs Straight From Employers</title><link rel="canonical" href="${SITE}/" /></head><body>home</body></html>`;
type BakedPage = { token: string; url: string; pos: number; status: number; body: string };
/** A probe file of `n` sampled pages out of `of` Workday pages; `bare(i)` says which sampled pages lack facts. */
const bakedFile = (n: number, bare: (i: number) => boolean, of = 283, o: Record<string, unknown> = {}) => ({
  at: "2026-10-25T02:00:00Z", site: SITE, sitemapStatus: 200, companyPages: 485, workdayPages: of, home: HOME_SHELL,
  pages: Array.from({ length: n }, (_, i): BakedPage => {
    const token = `t${i}~wd5~Careers`;
    return { token, url: `${SITE}/jobs/company/${token}`, pos: Math.round((i * (of - 1)) / Math.max(1, n - 1)), status: 200, body: baked(token, bare(i) ? "" : factLine(PLACES) + factLine(FIELDS)) };
  }),
  control: { token: "dominos", status: 200, body: baked("dominos", factLine(PLACES)) },
  ...o,
});
const runBaked = (f: object | null) => run(f, bakedJudge, "vd_81_baked.json");

/** Runs 81j's probe block against a fake web: `pages` maps a URL to its body (missing: 404). */
function runBakedProbe(sitemap: string, pages: Record<string, string>): { lines: string[]; file: { pages: BakedPage[]; workdayPages: number } } {
  const dir = mkdtempSync(join(tmpdir(), "vd-81j-"));
  const fake = `globalThis.fetch = async (u) => { const W = ${JSON.stringify({ [`${SITE}/sitemap.xml`]: sitemap, ...pages })}; const b = W[String(u)]; return { status: b === undefined ? 404 : 200, text: async () => b ?? "" }; };\n`;
  const code = fake + bakedProbe.split("/tmp/vd_81_").join(join(dir, "vd_81_"));
  const lines = execFileSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...process.env, SITE, UA: "Googlebot" } }).split("\n").filter(Boolean);
  return { lines, file: JSON.parse(readFileSync(join(dir, "vd_81_baked.json"), "utf8")) };
}
const sitemapOf = (tokens: string[]) => `<?xml version="1.0"?><urlset>${["/", "/pricing", ...tokens.map((t) => `/jobs/company/${t}`)].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`;

describe("81j: at least 90% of a sitemap sample of baked Workday company pages state a fact line", () => {
  it("both blocks were found; the probe is read-only GETs with the crawler's UA and reads the live sitemap", () => {
    expect(bakedProbe.length).toBeGreaterThan(500);
    expect(bakedProbe).not.toMatch(/method\s*:/);
    expect(bakedProbe).toMatch(/"User-Agent": UA/);
    expect(bakedProbe).toContain("/sitemap.xml");
    expect(bakedProbe).toMatch(/~wd\\d\+~/);
    expect(bakedJudge.length).toBeGreaterThan(500);
  });

  it("names the fact lines exactly as the bake writes them (scripts/prerender-pages.mjs)", () => {
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-pages.mjs"), "utf8");
    for (const marker of [PLACES, FIELDS]) {
      expect(bake, marker).toContain(`<p>${marker} `);
      expect(bakedJudge, marker).toContain(`"${marker}"`);
    }
  });

  it("the sample is the sitemap's last 8 Workday pages and 16 spread over the rest, in sitemap order, the same every run", () => {
    const wd = Array.from({ length: 283 }, (_, i) => `w${i}~wd${(i % 5) + 1}~Site`);
    const others = ["dominos", "eexs~us2~CX_3001", "careers.ulta.com/"];
    const sm = sitemapOf([...others.slice(0, 2), ...wd.slice(0, 100), others[2], ...wd.slice(100)]);
    const a = runBakedProbe(sm, {});
    const b = runBakedProbe(sm, {});
    const pos = a.file.pages.map((p) => p.pos);
    expect(a.file.workdayPages).toBe(283);
    expect(pos.length).toBe(24);
    expect(pos.slice(-8), "the tail a deadline cuts first").toEqual([275, 276, 277, 278, 279, 280, 281, 282]);
    expect(pos[0], "the largest Workday page").toBe(0);
    expect(new Set(pos).size).toBe(24);
    expect(pos).toEqual([...pos].sort((x, y) => x - y));
    expect(a.file.pages.map((p) => p.token)).toEqual(b.file.pages.map((p) => p.token));
    expect(a.file.pages.every((p) => /~wd\d+~/.test(p.token)), "only Workday pages are sampled").toBe(true);
    const few = runBakedProbe(sitemapOf(wd.slice(0, 12)), {});
    expect(few.file.pages.map((p) => p.pos), "fewer than 24: every Workday page").toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it("FAILs on what production served on 2026-10-25 (0 of 24; none of the 283 Workday pages states a fact line)", () => {
    expect(LIVE_81J.pages.length).toBe(24);
    const lines = runBaked(LIVE_81J);
    expect(lines[0], show(lines)).toMatch(/^FAIL {2}81j 0 of 24 sampled Workday company pages \(sitemap positions 1 to 283 of 283; the last 8: 0\) state a fact line/);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines.some((l) => l.startsWith("INFO  81j control dominos (SmartRecruiters): HTTP 200, 2 fact line(s)")), show(lines)).toBe(true);
  });

  it("PASSes on a bake that wrote every sampled page's facts, and at 22 of 24 (91.7%)", () => {
    const all = runBaked(bakedFile(24, () => false));
    expect(all[0], show(all)).toMatch(/^PASS {2}81j 24 of 24 sampled Workday company pages .* 100%, at least 90%/);
    expect(all.filter((l) => l.startsWith("FAIL")), show(all)).toEqual([]);
    const two = runBaked(bakedFile(24, (i) => i === 3 || i === 9));
    expect(two[0], show(two)).toMatch(/^PASS {2}81j 22 of 24 .*: 91\.7%, at least 90%/);
  });

  it("FAILs at 21 of 24 (87.5%), and on the recheck's tail cut: the spread pages carry facts, the last 8 do not", () => {
    const three = runBaked(bakedFile(24, (i) => i < 3));
    expect(three[0], show(three)).toMatch(/^FAIL {2}81j 21 of 24 .*: 87\.5%, want at least 90%/);
    const cut = runBaked(bakedFile(24, (i) => i >= 16));
    expect(cut[0], show(cut)).toMatch(/^FAIL {2}81j 16 of 24 .*the last 8: 0\) state a fact line/);
    // The pages the old 81j read (three of the largest) carry facts in this bake, so it PASSed.
    const largest = bakedFile(24, (i) => i >= 16).pages.slice(0, 3);
    expect(largest.every((p) => p.body.includes(PLACES)), "the head of the bake order kept its facts").toBe(true);
  });

  it("a homepage shell (by title or by a canonical that is not the page's own), an HTTP error, or neither line counts against the share", () => {
    const shellByTitle = bakedFile(24, () => false);
    shellByTitle.pages[0].body = HOME_SHELL;
    shellByTitle.pages[1].body = baked("other", factLine(PLACES)).replace(`${SITE}/jobs/company/other`, `${SITE}/`);
    shellByTitle.pages[2].status = 503;
    const lines = runBaked(shellByTitle);
    expect(lines[0], show(lines)).toMatch(/^FAIL {2}81j 21 of 24 /);
    expect(lines.some((l) => /^INFO {2}81j t0~wd5~Careers .*: the homepage shell/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO {2}81j t1~wd5~Careers .*: the homepage shell .*canonical "https:\/\/resumebooster\.work\/"/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO {2}81j t2~wd5~Careers .*: HTTP 503/.test(l)), show(lines)).toBe(true);
  });

  it("an empty sample, too few Workday pages, an unreadable sitemap or no probe file FAILs outright", () => {
    expect(runBaked(bakedFile(0, () => false, 0))[0]).toMatch(/^FAIL {2}81j the live sitemap lists 0 Workday company page\(s\) among 485 company pages: the sample is empty/);
    expect(runBaked(bakedFile(12, () => false, 12))[0]).toMatch(/^FAIL {2}81j the live sitemap lists only 12 Workday company page\(s\), fewer than the 20/);
    expect(runBaked(bakedFile(24, () => false, 283, { sitemapStatus: 503 }))).toEqual(["FAIL  81j the live sitemap answered HTTP 503: no Workday company page to sample"]);
    expect(runBaked(null)).toEqual(["FAIL  81j the baked Workday company pages: not probed"]);
  });

  it("the probe fed the live sitemap's shape with every page baked writes a file the judge PASSes; with the homepage everywhere it FAILs", () => {
    const wd = Array.from({ length: 40 }, (_, i) => `w${i}~wd1~Site`);
    const sm = sitemapOf(["dominos", ...wd]);
    const good = Object.fromEntries(wd.map((t) => [`${SITE}/jobs/company/${t}`, baked(t, factLine(FIELDS))]));
    const g = runBakedProbe(sm, { ...good, [`${SITE}/`]: HOME_SHELL, [`${SITE}/jobs/company/dominos`]: baked("dominos", factLine(PLACES)) });
    expect(g.file.pages.length).toBe(24);
    expect(runBaked(g.file)[0]).toMatch(/^PASS {2}81j 24 of 24 /);
    const shells = Object.fromEntries(wd.map((t) => [`${SITE}/jobs/company/${t}`, HOME_SHELL]));
    const s = runBakedProbe(sm, { ...shells, [`${SITE}/`]: HOME_SHELL });
    expect(runBaked(s.file)[0]).toMatch(/^FAIL {2}81j 0 of 24 /);
  });
});
