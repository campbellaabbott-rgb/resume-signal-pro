// @vitest-environment node
/**
 * ONE FEED IS READ ONCE, AND A POOLING SITE RANKS LAST.
 *
 * Trust round 3 (the round-2 plan, items 2 and 5; evidence in
 * ~/.config/resumebooster/trust-round-2/icims and oracle, read 2026-10-26).
 *
 * iCIMS. Seven catalogued host pairs read one feed twice (the Reyes pair was
 * scoped in .95). The Exelon pair reads one brand a board (&brand=, as Reyes);
 * the Chick-fil-A and YNV pairs, whose feeds filter by nothing, keep one
 * hiring_organization a board (`org`, icimsOrgScope); four duplicate hosts whose
 * feed is one employer's give their catalogue places to four Exelon brand
 * boards, so no other index moves. Migration 20261026110000 moves the rows that
 * leave a scoped board as untracked exits, only once .96 serves.
 *
 * Oracle. LCS's "All" and "All Community" sites list nearly every community's
 * postings and name no hirer; R+L's "Default" is exactly two other sites'
 * requisitions. ORACLE_POOL_SITES ranks such a site after every other site of
 * its tenant, and LCS's corporate site is its canonical, so the dedupe stores
 * each requisition under the community's (or carrier's) own board.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_SOURCES, ORACLE_CANONICAL_SITES, ORACLE_POOL_SITES } from "../../supabase/functions/job-board/sources";
import { JOB_SOURCES as COPY } from "../../supabase/functions/layoff-filings/board-sources";
import { icimsOrgRefusal, icimsOrgScope, oracleReqKey, planOracleSubsiteVisit, rankOracleSites } from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";
import * as L from "../../scripts/deploy-ledger.mjs";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
type Src = (typeof JOB_SOURCES)[number] & { brand?: string; org?: string };
const at = (t: string) => JOB_SOURCES.findIndex((s) => s.token === t);
const entry = (t: string) => JOB_SOURCES.find((s) => s.token === t) as Src | undefined;

describe("iCIMS: each feed is read once, one brand or one hirer a board", () => {
  it("the Exelon pair reads one brand each, in place, with its name and place kept", () => {
    expect(entry("careers.delmarva.com")).toMatchObject({ source: "icims", name: "Exelon", brand: "Exelon" });
    expect(entry("careers.comed.com")).toMatchObject({ source: "icims", name: "ComEd", brand: "ComEd" });
    expect([at("careers.delmarva.com"), at("careers.comed.com")]).toEqual([28141, 38775]);
  });

  it("the Chick-fil-A and YNV pairs keep one hiring organization each, as the feed spells it", () => {
    expect(entry("careers.baycenterfoods.com")).toMatchObject({ name: "Chick-fil-A", org: "Chick-fil-A, Inc." });
    expect(entry("careers.chick-fil-a.com")).toMatchObject({ name: "Chick-fil-A Supply LLC", org: "Chick-fil-A Supply LLC" });
    expect(entry("careers.ynvgroup.com")).toMatchObject({ name: "YNV Group", org: "YNV Group" });
    expect(entry("careers.monifai.com")).toMatchObject({ name: "Teknowledge", org: "Teknowledge" });
    const withOrg = (JOB_SOURCES as Src[]).filter((s) => s.org !== undefined).map((s) => s.token).sort();
    expect(withOrg).toEqual(["careers.baycenterfoods.com", "careers.chick-fil-a.com", "careers.monifai.com", "careers.ynvgroup.com"]);
    for (const s of JOB_SOURCES as Src[]) if (s.org !== undefined) expect([s.source, s.brand], s.token).toEqual(["icims", undefined]);
  });

  it("the four duplicate hosts are gone and their places hold the Exelon brand boards, each reading its brand as the feed spells it", () => {
    for (const t of ["careers.bpas.com", "careers.keysight.com", "careers.goldennugget.com", "talent.lla.com"]) expect(at(t), t).toBe(-1);
    const placed: Array<[number, string, string, string]> = [
      [38669, "careers.bge.com", "Baltimore Gas and Electric Company", "Baltimore Gas and Electric Company"],
      [38698, "careers.peco.com", "PECO", "PECO"],
      // "Pepco" is also PEPCO Germany GmbH's board (personio pepco, the discount retailer), and the bake keys a page on
      // the lowercased name, so the utility prints the legal name its own careers site files it under (tags3, read
      // 2026-10-26 on careers.pepco.com) while the feed is still asked for brand PEPCO.
      [38760, "careers.pepco.com", "Potomac Electric Power Co", "PEPCO"],
      [41040, "careers.atlanticcityelectric.com", "Atlantic City Electric", "Atlantic City Electric"],
    ];
    for (const [i, t, n, b] of placed) expect(JOB_SOURCES[i], t).toMatchObject({ source: "icims", token: t, name: n, brand: b });
    expect(JOB_SOURCES.length).toBe(44_523);
  });

  it("no Exelon brand board shares its printed name with another employer's board", () => {
    for (const t of ["careers.bge.com", "careers.peco.com", "careers.pepco.com", "careers.atlanticcityelectric.com", "careers.delmarva.com", "careers.comed.com"]) {
      const n = entry(t)!.name.toLowerCase();
      expect(JOB_SOURCES.filter((s) => s.token !== t && s.name.toLowerCase() === n).map((s) => `${s.source}:${s.token}`), t).toEqual([]);
    }
  });

  it("no two unscoped entries read one of the measured shared feeds", () => {
    // The feed each host serves, measured 2026-10-26 (icims/pairs.json, hosts.json): hosts in one group answer the same /api/jobs.
    const FEEDS: string[][] = [
      ["careers.delmarva.com", "careers.comed.com", "careers.bge.com", "careers.peco.com", "careers.pepco.com", "careers.atlanticcityelectric.com"],
      ["careers.baycenterfoods.com", "careers.chick-fil-a.com"],
      ["careers.ynvgroup.com", "careers.monifai.com"],
      ["careers.cbna.com", "careers.bpas.com"],
      ["jobs.keysight.com", "careers.keysight.com"],
      ["careers.lla.com", "talent.lla.com"],
      ["careers.landrysinc.com", "careers.goldennugget.com"],
      ["talent.reyesholdings.com", "jobportal.martinbrower.com"],
    ];
    for (const g of FEEDS) {
      const carried = g.map(entry).filter(Boolean) as Src[];
      const scopes = carried.map((s) => s.brand ?? s.org ?? "(whole feed)");
      expect(new Set(scopes).size, g.join(" / ")).toBe(carried.length);
      expect(scopes.filter((x) => x === "(whole feed)").length, g.join(" / ")).toBeLessThanOrEqual(1);
    }
  });

  it("layoff-filings' copy carries the same entries, field for field, byte for byte", () => {
    const pick = (l: Src[]) => l.filter((s) => s.brand || s.org).map((s) => JSON.stringify(s));
    expect(pick(COPY as Src[])).toEqual(pick(JOB_SOURCES as Src[]));
    expect(readFileSync(resolve(ROOT, "supabase/functions/layoff-filings/board-sources.ts"), "utf8")).toBe(readFileSync(resolve(ROOT, "supabase/functions/job-board/sources.ts"), "utf8"));
  });

  it("icimsOrgScope keeps only the board's hiring organization, and everything when the board names none", () => {
    const feed = [
      { data: { req_id: "1", hiring_organization: "Chick-fil-A, Inc." } },
      { data: { req_id: "2", hiring_organization: "Chick-fil-A Supply LLC" } },
      { data: { req_id: "3", hiring_organization: "Chick-fil-A, Inc." } },
      { data: { req_id: "4" } },
      null,
    ];
    expect(icimsOrgScope(feed, "Chick-fil-A, Inc.").map((j) => j?.data.req_id)).toEqual(["1", "3"]);
    expect(icimsOrgScope(feed, "Chick-fil-A Supply LLC").map((j) => j?.data.req_id)).toEqual(["2"]);
    expect(icimsOrgScope(feed, "chick-fil-a, inc."), "the feed's own spelling, exactly").toEqual([]);
    expect(icimsOrgScope(feed, undefined)).toBe(feed);
  });

  it("an org-scoped read is judged only whole: the feed read in one visit from the top, keeping some of a feed that had rows", () => {
    // A board with no org is never refused here.
    expect(icimsOrgRefusal(undefined, false, 250, 0)).toBeNull();
    expect(icimsOrgRefusal("YNV Group", true, 40, 2)).toBeNull();
    expect(icimsOrgRefusal("YNV Group", true, 0, 0), "an empty feed is the empty-page rule's to judge").toBeNull();
    // A feed larger than one visit: the last window's kept count can never prove a lap against the raw total.
    expect(icimsOrgRefusal("Chick-fil-A, Inc.", false, 250, 120)).toMatch(/larger than one visit/);
    // The hirer's spelling drifted (or it has no roles left in a feed that has others): nothing to close on.
    expect(icimsOrgRefusal("YNV Group", true, 40, 0)).toMatch(/kept none of 40/);
  });

  it("fetchIcims scopes after the walk: offsets and the empty-page refusal read the raw feed, an org read that is not whole is refused, and a whole one reports its kept count", () => {
    const code = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    const fn = /async function fetchIcims\([\s\S]*?\n\}/.exec(code)?.[0] ?? "";
    expect(fn).toContain("const empty = emptyFirstPage(base, all.length, feedTotal);");
    expect(fn).toContain("const advancedIc = base + all.length;");
    expect(fn).toContain("const items = icimsOrgScope(all, s.org);");
    expect(fn).toContain("const whole = exhausted && startOffset === 0;");
    expect(fn).toContain("const orgRefused = icimsOrgRefusal(s.org, whole, all.length, items.length);");
    expect(fn).toContain("if (orgRefused) throw new Error(orgRefused);");
    expect(fn).toContain("return { items, windowed: !whole, feedTotal: s.org ? items.length : feedTotal, nextOffset, feedEnded: exhausted, endOffset: advancedIc };");
    expect(fn.indexOf("icimsOrgScope(all, s.org)")).toBeGreaterThan(fn.indexOf("const advancedIc"));
    expect(fn.indexOf("throw new Error(orgRefused)")).toBeLessThan(fn.indexOf("return { items"));
  });
});

describe("Oracle: a site that pools the others ranks last", () => {
  const ranks = rankOracleSites(JOB_SOURCES, ORACLE_CANONICAL_SITES, ORACLE_POOL_SITES);
  const tenantSites = (t: string) => JOB_SOURCES.filter((s) => s.source === "oracle" && s.token.startsWith(`${t}~`)).map((s) => s.token);

  it("every pool site is catalogued and ranks after every other site of its tenant", () => {
    for (const p of ORACLE_POOL_SITES) {
      expect(at(p), p).toBeGreaterThan(-1);
      const t = p.split("~")[0];
      const others = tenantSites(t).filter((x) => !ORACLE_POOL_SITES.has(x));
      for (const o of others) expect(ranks.get(o)!, `${o} before ${p}`).toBeLessThan(ranks.get(p)!);
    }
  });

  it("LCS's corporate site is rank 0, its communities follow in catalogue order, the four pool sites last; R+L Carriers leads erhk", () => {
    expect(ORACLE_CANONICAL_SITES.eexs).toBe("eexs~us2~CX_1");
    expect(ranks.get("eexs~us2~CX_1")).toBe(0);
    const eexs = tenantSites("eexs");
    expect(eexs.length).toBe(109);
    expect([...ORACLE_POOL_SITES].filter((p) => p.startsWith("eexs~")).map((p) => ranks.get(p)).sort((a, b) => a! - b!)).toEqual([105, 106, 107, 108]);
    const communities = eexs.filter((x) => x !== "eexs~us2~CX_1" && !ORACLE_POOL_SITES.has(x));
    expect(communities.map((x) => ranks.get(x))).toEqual(communities.map((_, i) => i + 1));
    expect(["erhk~us2~CX_1", "erhk~us2~CX_4", "erhk~us2~CX_2001", "erhk~us2~CX_7", "erhk~us2~CX_1001"].map((x) => ranks.get(x))).toEqual([0, 1, 2, 3, 4]);
  });

  it("every multi-site tenant still has exactly one rank-0 site, and only eexs and erhk changed", () => {
    const zero = new Map<string, number>();
    for (const [t, r] of ranks) if (r === 0) zero.set(t.split("~")[0], (zero.get(t.split("~")[0]) ?? 0) + 1);
    const tenants = new Set([...ranks.keys()].map((t) => t.split("~")[0]));
    expect([...tenants].filter((t) => zero.get(t) !== 1)).toEqual([]);
    const withoutPool = rankOracleSites(JOB_SOURCES, { ...ORACLE_CANONICAL_SITES, eexs: "" });
    const moved = new Set([...ranks.keys()].filter((t) => ranks.get(t) !== withoutPool.get(t)).map((t) => t.split("~")[0]));
    expect([...moved].sort()).toEqual(["eexs", "erhk"]);
    expect(ranks.get("fa-espx-saasfaprod1~ocs~CX_1006")).toBe(0);
  });

  it("the dedupe moves a community's requisition off \"All\": the community stores it and sheds the pool copy", () => {
    const ALL = "eexs~us2~CX_3001", COMM = "eexs~us2~CX_10013"; // Sedgebrook
    const key = oracleReqKey(COMM, "41168")!;
    const holders = new Map([[key, [{ id: `oracle:${ALL}:41168`, token: ALL, rank: ranks.get(ALL)! }]]]);
    const comm = planOracleSubsiteVisit({ token: COMM, rank: ranks.get(COMM)!, fetched: ["41168"], stored: new Map(), holders });
    expect(comm.dropReqIds.size).toBe(0);
    expect(comm.shedSiblingIds).toEqual([`oracle:${ALL}:41168`]);
    // And "All", visited after, drops it while the community holds it.
    const all = planOracleSubsiteVisit({
      token: ALL, rank: ranks.get(ALL)!, fetched: ["41168"], stored: new Map([["41168", `oracle:${ALL}:41168`]]),
      holders: new Map([[key, [{ id: `oracle:${COMM}:41168`, token: COMM, rank: ranks.get(COMM)! }, { id: `oracle:${ALL}:41168`, token: ALL, rank: ranks.get(ALL)! }]]]),
    });
    expect([...all.dropReqIds]).toEqual(["41168"]);
    expect(all.shedMineIds).toEqual([`oracle:${ALL}:41168`]);
  });

  it("a requisition only a pool site lists stays on it (R+L's Default is never the only holder once R+L Carriers is read)", () => {
    const ALL = "eexs~us2~CX_3001";
    const solo = planOracleSubsiteVisit({ token: ALL, rank: ranks.get(ALL)!, fetched: ["40001"], stored: new Map(), holders: new Map() });
    expect(solo.dropReqIds.size).toBe(0);
  });
});

const MIG = "20261026110000_six_icims_boards_keep_only_their_own_brand_or_hirer.sql";
describe("migration 20261026110000 on a real Postgres", () => {
  let db: PGlite;
  const sql = () => readFileSync(resolve(ROOT, "supabase/migrations", MIG), "utf8");
  const SINCE = "2026-10-27T10:00:00Z";
  const post = (token: string, req: number, host: string) =>
    `('icims:${token}:${req}', 'icims', '${token}', 'X', 'Role ${req}', 'other', 'https://${host}/jobs/${req}/job', now() - interval '3 days', NULL, NULL)`;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.job_board_postings (
        id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text, title text, category text,
        apply_url text, first_seen timestamptz, location text, country text, posted_at timestamptz, department text, region_code text,
        work_mode text, employment_type text, experience_band text, min_years int, salary_min_annual numeric,
        salary_max_annual numeric, salary_period text, salary_currency text, missing_since timestamptz);
      CREATE TABLE public.job_board_exits (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text, company_token text, company text,
        title text, category text, exit_reason text NOT NULL CHECK (exit_reason IN ('removed', 'aged_out', 'backdated', 'untracked', 'board_dormant')),
        posted_at timestamptz, days_on_board numeric, origin_basis text, exited_at timestamptz, department text, country text,
        region_code text, work_mode text, employment_type text, experience_band text, min_years int,
        salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text);
      CREATE TABLE public.job_board_closures (
        event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, source text NOT NULL,
        company_token text NOT NULL, company text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '', closed_at timestamptz NOT NULL DEFAULT now(),
        suspect boolean NOT NULL DEFAULT false, batch_removed int, batch_live_before int);
      CREATE TABLE public.job_board_closure_repairs (event_id bigint PRIMARY KEY, repair text NOT NULL, marked_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build":"2026-09-09.96","buildSince":"${SINCE}"}');
      INSERT INTO public.job_board_postings (id, source, company_token, company, title, category, apply_url, first_seen, location, country) VALUES
        ${post("careers.delmarva.com", 1, "careers-exeloncorp.icims.com")},
        ${post("careers.delmarva.com", 2, "careers-comed.icims.com")},
        ${post("careers.delmarva.com", 3, "careers-delmarva.icims.com")},
        ${post("careers.delmarva.com", 4, "careers-bge.icims.com")},
        ${post("careers.delmarva.com", 6, "careers-comed.icims.com")},
        ${post("careers.comed.com", 2, "careers-comed.icims.com")},
        ${post("careers.comed.com", 1, "careers-exeloncorp.icims.com")},
        ${post("careers.comed.com", 5, "careers-peco.icims.com")},
        ${post("careers.baycenterfoods.com", 10, "careers-chickfila.icims.com")},
        ${post("careers.baycenterfoods.com", 11, "canadacareers-chickfila.icims.com")},
        ${post("careers.baycenterfoods.com", 12, "careers-cfasupply.icims.com")},
        ${post("careers.baycenterfoods.com", 50, "careers-chickfila.icims.com")},
        ${post("careers.baycenterfoods.com", 51, "canadacareers-chickfila.icims.com")},
        ${post("careers.chick-fil-a.com", 10, "careers-chickfila.icims.com")},
        ${post("careers.chick-fil-a.com", 12, "careers-cfasupply.icims.com")},
        ${post("careers.ynvgroup.com", 20, "careers-ynvgroup.icims.com")},
        ${post("careers.ynvgroup.com", 21, "careers-teknowledge.icims.com")},
        ${post("careers.ynvgroup.com", 40, "careers-ynvgroup.icims.com")},
        ${post("careers.ynvgroup.com", 41, "careers-ynvgroup.icims.com")},
        ${post("careers.monifai.com", 20, "careers-ynvgroup.icims.com")},
        ${post("careers.monifai.com", 21, "careers-teknowledge.icims.com")},
        ${post("careers.monifai.com", 22, "elsewhere.example.com")},
        ${post("careers.monifai.com", 23, "careers-teknowledge.icims.com")},
        ${post("careers.monifai.com", 42, "careers-ynvgroup.icims.com")},
        ${post("careers.bge.com", 4, "careers-bge.icims.com")},
        ${post("careers.example.com", 9, "careers-comed.icims.com")},
        ('workday:kohls~wd504~kohlscareers:R504030', 'workday', 'kohls~wd504~kohlscareers', 'Kohl''s', 'Advisor', 'retail', 'https://kohls.wd504.myworkdayjobs.com/x', now(), 'Lake Wales (1250)', 'GB'),
        ('workday:kohls~wd504~kohlscareers:R503656', 'workday', 'kohls~wd504~kohlscareers', 'Kohl''s', 'Associate', 'retail', 'https://kohls.wd504.myworkdayjobs.com/z', now(), 'Lake Wales (1250)', 'GB'),
        ('workday:kohls~wd504~kohlscareers:R1', 'workday', 'kohls~wd504~kohlscareers', 'Kohl''s', 'Other', 'retail', 'https://kohls.wd504.myworkdayjobs.com/y', now(), 'Cardiff, Wales', 'GB'),
        ('workday:other~wd1~x:R9', 'workday', 'other~wd1~x', 'Other', 'Other', 'retail', 'https://other.wd1.myworkdayjobs.com/y', now(), 'Lake Wales (1250)', 'GB');
      -- Race closures since .96's first slice, each judged by its requisition (stored on a board of the same feed, on
      -- another portal) and, only on the Exelon pair and only for a requisition no board of the feed stores, by its batch.
      INSERT INTO public.job_board_closures (posting_id, source, company_token, closed_at, batch_removed, batch_live_before) VALUES
        ('icims:careers.comed.com:30', 'icims', 'careers.comed.com', '2026-10-27T12:00:00Z', 50, 100),
        ('icims:careers.ynvgroup.com:23', 'icims', 'careers.ynvgroup.com', '2026-10-27T12:00:00Z', 7, 9),
        ('icims:careers.comed.com:32', 'icims', 'careers.comed.com', '2026-10-27T13:00:00Z', 2, 56),
        ('icims:careers.comed.com:33', 'icims', 'careers.comed.com', '2026-10-20T12:00:00Z', 60, 100),
        ('icims:careers.example.com:34', 'icims', 'careers.example.com', '2026-10-27T12:00:00Z', 300, 400),
        ('icims:careers.monifai.com:40', 'icims', 'careers.monifai.com', '2026-10-27T12:00:00Z', 2, 9),
        ('icims:careers.monifai.com:41', 'icims', 'careers.monifai.com', '2026-10-27T12:00:00Z', 2, 9),
        ('icims:careers.chick-fil-a.com:50', 'icims', 'careers.chick-fil-a.com', '2026-10-27T12:00:00Z', 8, 27),
        ('icims:careers.chick-fil-a.com:51', 'icims', 'careers.chick-fil-a.com', '2026-10-27T12:00:00Z', 8, 27),
        ('icims:careers.ynvgroup.com:42', 'icims', 'careers.ynvgroup.com', '2026-10-27T14:00:00Z', 1, 2),
        ('icims:careers.comed.com:6', 'icims', 'careers.comed.com', '2026-10-27T14:00:00Z', 1, 40);
    `);
    await db.exec(sql());
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });
  const ids = async (token: string) => (await db.query<{ id: string }>(`SELECT id FROM public.job_board_postings WHERE company_token = $1 ORDER BY id`, [token])).rows.map((r) => r.id.split(":").pop());

  it("each scoped board keeps its own portal's rows, and a row on a portal the feed does not name stays", async () => {
    expect(await ids("careers.delmarva.com")).toEqual(["1"]);
    expect(await ids("careers.comed.com")).toEqual(["2"]);
    expect(await ids("careers.baycenterfoods.com")).toEqual(["10", "11", "50", "51"]);
    expect(await ids("careers.chick-fil-a.com")).toEqual(["12"]);
    expect(await ids("careers.ynvgroup.com")).toEqual(["20", "40", "41"]);
    expect(await ids("careers.monifai.com")).toEqual(["21", "22", "23"]);
  });

  it("every row it moves is an untracked exit, never a closure, and no other board is touched", async () => {
    const ex = (await db.query<{ posting_id: string; exit_reason: string }>(`SELECT posting_id, exit_reason FROM public.job_board_exits ORDER BY posting_id`)).rows;
    expect(ex.map((r) => r.posting_id.split(":").slice(1).join(":"))).toEqual([
      "careers.baycenterfoods.com:12", "careers.chick-fil-a.com:10", "careers.comed.com:1", "careers.comed.com:5",
      "careers.delmarva.com:2", "careers.delmarva.com:3", "careers.delmarva.com:4", "careers.delmarva.com:6",
      "careers.monifai.com:20", "careers.monifai.com:42", "careers.ynvgroup.com:21",
    ]);
    expect(new Set(ex.map((r) => r.exit_reason))).toEqual(new Set(["untracked"]));
    expect(await ids("careers.bge.com")).toEqual(["4"]);
    expect(await ids("careers.example.com")).toEqual(["9"]);
  });

  it("a closure since .96's first slice of a requisition a board of the same feed stores on another portal is marked suspect and listed, whatever the batch", async () => {
    const c = new Map((await db.query<{ posting_id: string; suspect: boolean }>(`SELECT posting_id, suspect FROM public.job_board_closures`)).rows.map((r) => [r.posting_id.split(":").slice(1).join(":"), r.suspect]));
    // Teknowledge's two of nine (22%) are YNV Group's postings; Chick-fil-A Supply's eight of 27 (30%) are Chick-fil-A's.
    expect([c.get("careers.monifai.com:40"), c.get("careers.monifai.com:41")]).toEqual([true, true]);
    expect([c.get("careers.chick-fil-a.com:50"), c.get("careers.chick-fil-a.com:51")]).toEqual([true, true]);
    expect(c.get("careers.ynvgroup.com:23"), "YNV Group closing a Teknowledge posting").toBe(true);
  });

  it("a real takedown is never marked: one of YNV Group's two rows, or ComEd's own posting, though a stale copy sits on the other board", async () => {
    const c = new Map((await db.query<{ posting_id: string; suspect: boolean }>(`SELECT posting_id, suspect FROM public.job_board_closures`)).rows.map((r) => [r.posting_id.split(":").slice(1).join(":"), r.suspect]));
    expect(c.get("careers.ynvgroup.com:42"), "1 of 2 is 50%, and still YNV Group's own").toBe(false);
    expect(c.get("careers.comed.com:6"), "ComEd's own posting, its copy on the Exelon board applying on careers-comed").toBe(false);
  });

  it("on the Exelon pair alone, a requisition no board of the feed stores (Delmarva Power's) is judged by its batch: over 30% is marked; nothing before the first slice or off the six", async () => {
    const c = new Map((await db.query<{ posting_id: string; suspect: boolean }>(`SELECT posting_id, suspect FROM public.job_board_closures`)).rows.map((r) => [r.posting_id.split(":").slice(1).join(":"), r.suspect]));
    expect(c.get("careers.comed.com:30"), "50 of 100").toBe(true);
    expect(c.get("careers.comed.com:32"), "2 of 56").toBe(false);
    expect(c.get("careers.comed.com:33"), "before the first slice").toBe(false);
    expect(c.get("careers.example.com:34"), "not one of the six").toBe(false);
    const listed = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_closure_repairs WHERE repair = 'icims_scope_trust_round_3'`)).rows[0].n;
    expect(listed).toBe(6);
  });

  it("files every Kohl's row at its Lake Wales store (1250) US, from Workday's own alpha2Code, and no other row", async () => {
    const k = (await db.query<{ id: string; country: string }>(`SELECT id, country FROM public.job_board_postings WHERE source = 'workday' ORDER BY id`)).rows;
    expect(k.map((r) => [r.id.split(":").pop(), r.country])).toEqual([["R1", "GB"], ["R503656", "US"], ["R504030", "US"], ["R9", "GB"]]);
  });

  it("is safe to run again", async () => {
    await db.exec(sql());
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_exits`)).rows[0].n).toBe(11);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_closure_repairs`)).rows[0].n).toBe(6);
    expect(await ids("careers.delmarva.com")).toEqual(["1"]);
  });

  it("refuses to run while an older build serves, since its unscoped read would put the rows back", async () => {
    await db.exec(`UPDATE public.job_board_meta SET v = '{"build":"2026-09-09.95","buildSince":"2026-10-26T00:00:00Z"}' WHERE k = 'slice_stats'`);
    await expect(db.exec(sql())).rejects.toThrow(/20261026110000.*2026-09-09\.96/);
    // What a runner reads when it refuses: wait for the first slice, then apply this same file unedited.
    await expect(db.exec(sql())).rejects.toThrow(/sliceStats\.build.*the same file again, unedited/);
    await db.exec(`UPDATE public.job_board_meta SET v = '{"build":"2026-09-09.96","buildSince":"${SINCE}"}' WHERE k = 'slice_stats'`);
  });
});

describe("the deploy: trust/round3 is its own reservation, and the order holds", () => {
  const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
  it("trust/round3 belongs to trust-round-3 (job-board .96, 20261026*), and trust/pages still to oracle-regionless", () => {
    expect(L.workstreamOf(policy, "trust/round3")).toBe("trust-round-3");
    expect(L.workstreamOf(policy, "origin/trust/round3")).toBe("trust-round-3");
    expect(L.workstreamOf(policy, "trust/pages")).toBe("oracle-regionless");
    expect(policy.reservations["trust-round-3"]).toMatchObject({ jobBoard: "2026-09-09.96", migrations: expect.stringMatching(/^20261026\*/), fnBuildDate: "2026-10-26" });
    expect(policy.reservations["company-profiles-phase3"].jobBoard).toBe("2026-09-09.97");
  });
  it("the scope migration waits for .96 to serve, and the names migration goes before it", () => {
    // A slice rule since the land/all recheck: the file waits for .96's first slice, which comes after its OPTIONS answer.
    expect(policy.migrationOrder["20261026110000"]?.after).toBe("slice:job-board@2026-09-09.96");
    expect(policy.migrationOrder["20261026100000"]?.before).toEqual(["fn:job-board"]);
  });
});
