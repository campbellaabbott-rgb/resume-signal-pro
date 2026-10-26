/**
 * A WATCH ON A WORKDAY SITE WHOSE TENANT HAS ANOTHER SITE PROMISES NOTHING
 * (profiles+design hotfix, round 4; the final recheck of 2026-10-25).
 *
 * Round 3 made the zero page's watch promise ("Watch this board and your
 * account will count its new postings when they appear", and the toast's
 * "We'll email you when they post new roles") only where a watch on the token
 * can count the board's new postings, and withheld it on Oracle sites, which
 * the sub-site dedupe empties. The final recheck found job-board's second
 * dedupe that empties sites: the Workday cross-site dedupe skips a new
 * requisition copy (an id with a one- or two-digit suffix after three digits,
 * R31339-1) on any site of a tenant whenever a stored row of another site
 * holds the base id (R31339). strayer~wd1~CU_Careers listed 9 roles dated this
 * month and served none; 7 were copies of requisitions strayer~wd1~SEI serves.
 * The corpus's sibling check matched exact ids, so it read 0 there and on five
 * more Workday rows; it now matches a Workday copy by its base id.
 *
 * THE SAFE DEFAULT: the promise is also withheld on a Workday token whose
 * tenant has more than one catalogued site (withholding is never false). The
 * model cannot see the catalogue, so the smallest honest input is a generated
 * list of those tenants (src/lib/company/workday-multi-site-tenants.ts, from
 * scripts/workday-multi-site-tenants.ts), recomputed here from sources.ts. On
 * the 12,564-page corpus the promise drops from 10,200 pages to 10,178: the 22
 * Workday zero pages 474dca30 promised on whose tenant has another site
 * (boeing~wd1~PRIDE, seven gn~wd3 sites, ...) are withheld, and the 16 on
 * single-site tenants keep it.
 *
 * A single-site tenant keeps the promise because the copy dedupe groups by
 * tenant: with one site it can only skip a copy against that same site's own
 * stored rows, and a promised page's board stated no total at a complete read
 * (job-board never writes 0), so it carries no live base for a copy.
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOG } from "./helpers/catalog";
import { codeOf } from "./helpers/strip-comments";
import { loadCompanyShard } from "./helpers/company-shard";
import { buildLanderModel, siteDedupedToken, watchPromiseOf, type BoardTotalInput, type LanderInput } from "@/lib/company/lander-model";
import { WORKDAY_MULTI_SITE_TENANT_LIST, WORKDAY_MULTI_SITE_TENANTS } from "@/lib/company/workday-multi-site-tenants";
import { CompanyEmptyState } from "@/components/jobs/company/CompanyEmptyState";

const ROOT = resolve(__dirname, "../..");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOB_BOARD = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const MAPPING = /boardTotal: curveAnsweredAt === null \? undefined : hiringCurve\s*\?\s*(\{[^{}]*\})\s*:\s*null,/;
const fromRow = (() => {
  const m = MAPPING.exec(JOBS);
  if (!m) throw new Error("the lander's boardTotal input moved: RE-ANCHOR this test on it");
  return new Function("hiringCurve", `return (${m[1]});`) as (row: unknown) => BoardTotalInput;
})();

type CorpusRow = [token: string, vendor: string, bucket: string | null, tracking: number | null, total: number | null, readAt: string | null,
  state: string | null, capped: boolean | null, feed: string, inWindow: number | null, siblingServed: number | null];
const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/zero-page-corpus-2026-10-25.json"), "utf8")) as {
  at: string; rows: CorpusRow[];
  round4: { workday_copy_held: Record<string, { held: number; of: number; by: string[]; ids: string[] }>; multi_site_promised_474dca30: string[]; single_site_promised: string[] };
};
const CORPUS_AT = Date.parse(CORPUS.at);
const curveRow = (r: CorpusRow) => ({
  company_token: r[0], open_roles: 0, observability_bucket: r[2], tracking_days: r[3],
  feed_total: r[4], feed_read_at: r[5], feed_state: r[6], feed_capped: r[7],
});
const rowOf = (token: string) => {
  const r = CORPUS.rows.find((x) => x[0] === token);
  if (!r) throw new Error(`${token} is not in the corpus`);
  return r;
};
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "bassabatherapy", storedName: "Example Employer", bakedName: null, cachedName: null,
  listTotal: 0, listFloor: false, feedTotal: 0, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: null, agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], now: CORPUS_AT, ...o,
});
const zeroPage = (r: CorpusRow) => buildLanderModel(input({ token: r[0], boardTotal: fromRow(curveRow(r)) }));
const tenantOf = (token: string) => token.split("~")[0];
const isWorkdayShape = (token: string) => /^[^~]+~wd\d+~[^~]+$/.test(token);
/** A full read with no stated total: the only inputs on which a watch is promised at all. */
const OPEN = { total: null, readAt: null, state: null, capped: null, bucket: "full_read", trackingDays: 40 };
const WATCH_BODY = "Watch this board and your account will count its new postings when they appear.";

/** The six Workday rows the final recheck named, each with a copy whose base a sibling site serves. */
const NAMED = ["strayer~wd1~CU_Careers", "akumincorp~wd5~adgcareers", "agf~wd3~AGF_Careers", "anaheimducks~wd5~ocViBE", "integritymarketing~wd1~RitterInsuranceMarketing", "tcsedsystem~wd1~SaybrookUniversityCareers"];

beforeAll(() => { loadCompanyShard(); });

describe("the multi-site Workday tenants are the catalogue's, grouped as job-board's copy dedupe groups them", () => {
  const workday = CATALOG.filter((e) => e.source === "workday");

  it("job-board's Workday cross-site dedupe still groups by the token's first segment and skips suffixed copies by base id", () => {
    expect(JOB_BOARD).toMatch(/if \(s\.source === "workday" && r\.jobs\.length > 0\) \{\s*const tenant = s\.token\.split\("~"\)\[0\];/);
    expect(JOB_BOARD).toMatch(/\.like\("company_token", `\$\{tenant\}~%`\)/);
    expect(JOB_BOARD).toMatch(/const m = \/-\\d\{1,2\}\$\/\.exec\(req\);\s*return !!m && \/\\d\{3\}\/\.test\(req\.slice\(0, m\.index\)\);/);
    expect(JOB_BOARD).toMatch(/return !held\.has\(req\.replace\(\/-\\d\{1,2\}\$\/, ""\)\);/);
  });

  it("every Workday token is tenant~wdN~site, no other token has that shape, and every tenant is plain lower-case letters and digits (so the dedupe's LIKE matches exactly its first segment)", () => {
    expect(workday.length, "the catalogue held 3,698 Workday tokens on 2026-10-25").toBeGreaterThan(3000);
    for (const e of workday) expect(isWorkdayShape(e.token), e.token).toBe(true);
    for (const e of CATALOG) if (e.source !== "workday") expect(isWorkdayShape(e.token), `${e.source}:${e.token}`).toBe(false);
    for (const e of workday) expect(tenantOf(e.token), e.token).toMatch(/^[a-z0-9]+$/);
  });

  it("the generated list is every tenant with more than one catalogued Workday site, and only those", () => {
    const sites = new Map<string, number>();
    for (const e of workday) sites.set(tenantOf(e.token), (sites.get(tenantOf(e.token)) ?? 0) + 1);
    const want = [...sites].filter(([, n]) => n > 1).map(([t]) => t).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(want.length, "511 multi-site Workday tenants on 2026-10-25").toBeGreaterThan(400);
    expect(JSON.stringify(WORKDAY_MULTI_SITE_TENANT_LIST), "src/lib/company/workday-multi-site-tenants.ts has drifted from the catalogue: run npx tsx scripts/workday-multi-site-tenants.ts").toBe(JSON.stringify(want));
    for (const t of ["strayer", "akumincorp", "agf", "anaheimducks", "integritymarketing", "tcsedsystem", "boeing", "gn"]) expect(WORKDAY_MULTI_SITE_TENANTS.has(t), t).toBe(true);
    expect(WORKDAY_MULTI_SITE_TENANTS.has("exactsciences"), "a single-site tenant").toBe(false);
  });
});

describe("the corpus's sibling check matches a Workday copy by its base id (round 4)", () => {
  it("the six named rows now count the copies a sibling serves under the base id, and all six state a feed total", () => {
    const held = CORPUS.round4.workday_copy_held;
    expect(Object.keys(held).sort()).toEqual([...NAMED].sort());
    for (const tok of NAMED) {
      const r = rowOf(tok);
      expect(r[1], tok).toBe("workday");
      expect(r[10], `${tok}: sibling_served counts its base-held copies`).toBe(held[tok].held);
      expect(r[10], tok).toBeGreaterThan(0);
      expect(r[4], `${tok}: states a feed total`).not.toBeNull();
      for (const id of held[tok].ids) expect(id, tok).toMatch(/-\d{1,2}$/);
      for (const by of held[tok].by) expect(tenantOf(by), `${tok}: held by a site of its own tenant`).toBe(tenantOf(tok));
    }
    expect(held["strayer~wd1~CU_Careers"]).toMatchObject({ held: 7, of: 9, by: ["strayer~wd1~SEI"] });
  });

  it("the named rows promise nothing, and each is a site the copy dedupe can empty", () => {
    for (const tok of NAMED) {
      expect(siteDedupedToken(tok), tok).toBe(true);
      expect(zeroPage(rowOf(tok)).watchPromise, tok).toBe(false);
      // Their stated totals withhold it already; the tenant rule withholds it with no total too.
      expect(watchPromiseOf({ token: tok, boardTotal: OPEN }), `${tok} with no stated total`).toBe(false);
    }
  });
});

describe("the watch promise on every corpus row (round 4)", () => {
  it("never on a row a sibling site serves (by exact or base id), a stated total, an Oracle site or a multi-site Workday tenant; on every other full read: 10,178 of 12,564", () => {
    const tally = { promise: 0, siblingRows: 0, workdayPromise: 0 };
    for (const r of CORPUS.rows) {
      const m = zeroPage(r);
      const multi = r[1] === "workday" && WORKDAY_MULTI_SITE_TENANTS.has(tenantOf(r[0]));
      if ((r[10] ?? 0) > 0) {
        tally.siblingRows++;
        expect(m.watchPromise, `${r[0]}: a sibling site serves its roles`).toBe(false);
      }
      expect(m.watchPromise, r[0]).toBe(r[4] === null && r[2] === "full_read" && r[1] !== "oracle" && !multi);
      if (m.watchPromise) {
        tally.promise++;
        if (r[1] === "workday") tally.workdayPromise++;
      }
    }
    expect(tally).toEqual({ promise: 10178, siblingRows: 332, workdayPromise: 16 });
  });

  it("the 22 Workday pages 474dca30 promised on whose tenant has another site are withheld (boeing~wd1~PRIDE among them); the 16 single-site ones keep it", () => {
    const multi = CORPUS.round4.multi_site_promised_474dca30;
    const single = CORPUS.round4.single_site_promised;
    expect([multi.length, single.length]).toEqual([22, 16]);
    expect(multi).toContain("boeing~wd1~PRIDE");
    for (const tok of multi) {
      const r = rowOf(tok);
      expect([r[1], r[2], r[4]], tok).toEqual(["workday", "full_read", null]);
      expect(WORKDAY_MULTI_SITE_TENANTS.has(tenantOf(tok)), tok).toBe(true);
      expect(zeroPage(r).watchPromise, `${tok}: a sibling site of its tenant can hold its copies`).toBe(false);
    }
    for (const tok of single) {
      const r = rowOf(tok);
      expect(WORKDAY_MULTI_SITE_TENANTS.has(tenantOf(tok)), tok).toBe(false);
      expect(zeroPage(r).watchPromise, `${tok}: a single-site tenant, read in full with no stated total`).toBe(true);
    }
  });

  it("boeing~wd1~PRIDE-shape tokens of any multi-site tenant are withheld; a single-site Workday tenant with no stated total is promised; Oracle stays withheld; a non-Workday token is promised", () => {
    for (const tok of ["boeing~wd1~PRIDE", "boeing~wd1~EXTERNAL_CAREERS", "gn~wd3~JabraCareers", "nphosting~wd5~CERICareers", "tcsedsystem~wd1~TCSES"]) {
      expect(watchPromiseOf({ token: tok, boardTotal: OPEN }), tok).toBe(false);
    }
    for (const tok of ["exactsciences~wd1~Exact_Sciences", "ibotta~wd1~Ibotta", "andela~wd1~External"]) {
      expect(WORKDAY_MULTI_SITE_TENANTS.has(tenantOf(tok)), tok).toBe(false);
      expect(watchPromiseOf({ token: tok, boardTotal: OPEN }), tok).toBe(true);
    }
    expect(watchPromiseOf({ token: "eexs~us2~CX_19005", boardTotal: OPEN })).toBe(false);
    expect(watchPromiseOf({ token: "bassabatherapy", boardTotal: OPEN })).toBe(true);
    // Off the zero page too, a site whose copies a sibling can hold is
    // promised nothing; a single-site tenant keeps the promise (the SEO
    // round's merge review, 2026-10-25).
    const standard = (tok: string) => buildLanderModel(input({ token: tok, listTotal: 40, boardTotal: OPEN })).watchPromise;
    for (const tok of ["boeing~wd1~PRIDE", "akumincorp~wd5~adgcareers", "strayer~wd1~CU_Careers"]) expect(standard(tok), tok).toBe(false);
    for (const tok of ["exactsciences~wd1~Exact_Sciences", "ibotta~wd1~Ibotta", "bassabatherapy"]) expect(standard(tok), tok).toBe(true);
    // A tenant's name that only looks like a multi-site one is its own tenant.
    expect(siteDedupedToken("boeingx~wd1~PRIDE")).toBe(false);
    expect(siteDedupedToken("boeing")).toBe(false);
  });
});

describe("the rendered empty column", () => {
  it("prints the promise on a single-site Workday zero page and not on boeing~wd1~PRIDE", () => {
    const col = (tok: string) => {
      const r = rowOf(tok);
      const { container, unmount } = render(<MemoryRouter><CompanyEmptyState model={zeroPage(r)} token={tok} boardReadAt={null} underHeader /></MemoryRouter>);
      const text = container.textContent ?? "";
      unmount();
      return text;
    };
    expect(col("exactsciences~wd1~Exact_Sciences")).toContain(WATCH_BODY);
    expect(col("boeing~wd1~PRIDE")).not.toContain(WATCH_BODY);
  });
});
