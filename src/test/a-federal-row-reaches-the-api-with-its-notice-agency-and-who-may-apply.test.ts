// @vitest-environment node
//
// Node, not jsdom: this file bundles both edge functions with esbuild.
/**
 * A FEDERAL ROW REACHES THE API WITH ITS NOTICE, ITS AGENCY AND WHO MAY APPLY
 * (OD16, owner 2026-11-18: yes).
 *
 * USAJOBS rows were withheld from /v1 and the Claude connector although OPM's
 * API terms let anyone copy, publish and redistribute the public data. OD16
 * hands them on, on four conditions OPM's terms ask for and three the owner
 * set:
 *   - USAJOBS named as the source, the official announcement linked, the
 *     retrieval date given, and OPM's non-affiliation notice stated
 *     (meta.attribution.federal on /v1, federalAttribution on the connector);
 *   - the hiring agency credited as the employer, on the row and in
 *     /v1/companies (federalAgencies), never "USAJOBS";
 *   - who may apply carried on every row (some announcements are for current
 *     federal staff only), and a row without it not handed on (the other
 *     file, a-federal-row-without-who-may-apply-stays-withheld);
 *   - no age: first_seen is null and our first sighting rides as
 *     federal.on_board_since, and "open" means open until the agency's
 *     closing date (closes_at).
 *
 * Judged on the shipped handlers (public-api through its harness, agent-mcp
 * bundled the same way), never on spellings. The shared module is held
 * byte-identical in both functions here, because neither may import the
 * other's folder.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import {
  FEDERAL_GATE_OR, FEDERAL_OPEN_UNTIL, FEDERAL_PUBLISHER, FEDERAL_SITE, OPM_NOTICE, federalFacts,
} from "../../supabase/functions/public-api/federal-rows";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const DAY = 86_400_000;
const RECENT = new Date(Date.now() - 2 * DAY).toISOString();
const FIRST_SEEN = new Date(Date.now() - 20 * DAY).toISOString();
const CLOSES = new Date(Date.now() + 25 * DAY).toISOString();
const READ_AT = new Date(Date.now() - 3_600_000).toISOString();
const AGENCY = "Transportation Security Administration";
const WHO = "Open to the public";
const FED_ID = "usajobs:usajobs:850123456";

const FED_ROW = {
  id: FED_ID, source: "usajobs", company_token: "usajobs", company: AGENCY, title: "Transportation Security Officer",
  location: "Denver, CO", country: "US", remote: false, work_mode: null, department: "Security", category: "security",
  posted_at: RECENT, first_seen: FIRST_SEEN, apply_url: "https://www.usajobs.gov/job/850123456", salary: null,
  salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null, experience_band: null,
  min_years: null, agency: false, closes_at: CLOSES, who_may_apply: WHO, hiring_paths: ["public", "vet"],
  effective_posted: RECENT, missing_since: null, description: "Screens passengers and baggage.",
};
const GH_ROW = {
  ...FED_ROW, id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", company: "Acme Health", title: "Registered Nurse",
  apply_url: "https://boards.greenhouse.io/acme/jobs/1", first_seen: FIRST_SEEN, closes_at: null, who_may_apply: null, hiring_paths: null,
};

// ── /v1 ─────────────────────────────────────────────────────────────────────

describe("/v1 hands a labelled federal row on, with its credit", () => {
  let handler: EdgeHandler;
  const db = new RecordingDb();
  beforeAll(async () => {
    ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
    db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
    db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
    db.tables.job_board_postings = [FED_ROW, GH_ROW];
    db.tables.job_board_verifications = [
      { company_token: "usajobs:usajobs", verified_at: READ_AT },
      { company_token: "greenhouse:acme", verified_at: READ_AT },
    ];
    db.tables.job_board_meta = [{ k: "refresh", updated_at: READ_AT, v: {
      companiesFacet: [{ token: "acme", name: "Acme Health", count: 40 }, { token: "usajobs", name: "USAJOBS", count: 18_505 }],
      companiesOpen: { acme: 40, usajobs: 18_505 },
    } }];
    useDb(db);
  }, 180_000);

  it("a list page serves the row with who may apply, the closing date, the agency as employer and no age", async () => {
    const r = await callApi(handler, "/v1/jobs?source=usajobs");
    expect(r.status).toBe(200);
    const rows = r.body.data as Array<Record<string, unknown>>;
    expect(rows.map((x) => x.id)).toEqual([FED_ID]);
    const row = rows[0];
    expect(row.who_may_apply).toBe(WHO);
    expect(row.hiring_paths).toEqual(["public", "vet"]);
    expect(row.closes_at).toBe(CLOSES);
    expect(row.company).toBe(AGENCY);
    expect(row.first_seen, "our first sighting is never handed on as a posting field").toBeNull();
    expect(row.federal).toEqual({
      agency: AGENCY, official_url: "https://www.usajobs.gov/job/850123456", on_board_since: FIRST_SEEN,
      open_until: FEDERAL_OPEN_UNTIL, notice: OPM_NOTICE,
    });
    expect(row.last_verified_at).toBe(READ_AT);
    // The SQL half of the gate rides on the row query (the harness records it).
    const listQuery = db.queriesOf("job_board_postings").find((ops) => ops.some(([m, a]) => m === "eq" && a[0] === "source"));
    expect(listQuery?.some(([m, a]) => m === "or" && a[0] === FEDERAL_GATE_OR), "the federal gate is not bound in SQL").toBe(true);
  });

  it("the body carries OPM's credit: USAJOBS named, the official site, the notice and the date we read the feed", async () => {
    const r = await callApi(handler, "/v1/jobs?source=usajobs");
    const meta = r.body.meta as { attribution: Record<string, unknown> & { federal: Record<string, unknown> } };
    expect(meta.attribution.required).toBe(true);
    expect(meta.attribution.url).toBe("https://resumebooster.work");
    expect(meta.attribution.federal).toMatchObject({
      source: "usajobs", publisher: FEDERAL_PUBLISHER, notice: OPM_NOTICE, officialSite: FEDERAL_SITE, retrievedAt: READ_AT,
    });
    expect(String(meta.attribution.federal.note)).toMatch(/who_may_apply/);
  });

  it("the single-posting lookup answers the same row and the same credit", async () => {
    const r = await callApi(handler, `/v1/jobs/${encodeURIComponent(FED_ID)}`);
    expect(r.status).toBe(200);
    const row = r.body.data as Record<string, unknown>;
    expect(row).toMatchObject({ id: FED_ID, company: AGENCY, who_may_apply: WHO, closes_at: CLOSES, first_seen: null });
    expect((row.federal as Record<string, unknown>).on_board_since).toBe(FIRST_SEEN);
    expect(((r.body.meta as Record<string, Record<string, Record<string, unknown>>>).attribution.federal).notice).toBe(OPM_NOTICE);
  });

  it("a row off the federal feed carries the three columns as null, no federal block, and its body no OPM credit", async () => {
    const r = await callApi(handler, "/v1/jobs?source=greenhouse");
    const row = (r.body.data as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ id: "greenhouse:acme:1", closes_at: null, who_may_apply: null, hiring_paths: null });
    expect(row.first_seen).toBe(FIRST_SEEN);
    expect("federal" in row).toBe(false);
    expect(r.body.meta, "a body with no federal row names no federal credit").toBeUndefined();
  });

  it("/v1/companies credits the agency by name and never lists USAJOBS as an employer", async () => {
    const r = await callApi(handler, "/v1/companies?limit=10");
    expect(r.status).toBe(200);
    const tokens = (r.body.data as Array<Record<string, unknown>>).map((c) => c.company_token);
    expect(tokens).toContain("acme");
    expect(tokens, "the feed's one shared token is not an employer").not.toContain("usajobs");
    const fed = r.body.federalAgencies as { agencies: Array<{ company: string; open_postings: number }>; company_token: string; complete: boolean };
    expect(fed.company_token).toBe("usajobs");
    expect(fed.agencies).toEqual([{ company: AGENCY, open_postings: 1 }]);
    expect(fed.complete).toBe(true);
    // A search naming the feed lists every agency; a search naming an agency finds it.
    const named = await callApi(handler, "/v1/companies?q=transportation");
    expect((named.body.federalAgencies as { agencies: unknown[] }).agencies).toHaveLength(1);
  });

  it("the /v1 index says how federal rows are handed on, with OPM's notice", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/public-api/v1"));
    const body = await res.json() as { apiVersion: string; restrictions: { excludedSources: string[] }; federal: Record<string, unknown> };
    expect(body.apiVersion).toBe("2026-11-19.1");
    expect(body.restrictions.excludedSources).toEqual(["smartrecruiters"]);
    expect(body.federal.notice).toBe(OPM_NOTICE);
    expect(String(body.federal.gate)).toMatch(/who_may_apply/);
  });

  it("TEETH: the shaper drops the row when who may apply is missing, and credits no agency named USAJOBS", () => {
    const base = { id: FED_ID, source: "usajobs", company: AGENCY, whoMayApply: WHO, hiringPaths: null, closesAt: CLOSES, firstSeen: FIRST_SEEN, applyUrl: null };
    expect(federalFacts(base)?.agency).toBe(AGENCY);
    expect(federalFacts({ ...base, whoMayApply: null })).toBeNull();
    expect(federalFacts({ ...base, whoMayApply: "  " })).toBeNull();
    expect(federalFacts({ ...base, company: "USAJOBS" })?.agency).toBeNull();
    expect(federalFacts({ ...base, source: "greenhouse" })).toBeNull();
    // The official link is USAJOBS's own page, never another host.
    expect(federalFacts({ ...base, id: "usajobs:usajobs:x", applyUrl: "https://evil.example/job/1" })?.officialUrl).toBeNull();
  });
});

// ── the connector ───────────────────────────────────────────────────────────

describe("the connector hands the same row on, with its credit", () => {
  let m: KeylessMcp;
  const labelReads: string[][] = [];
  beforeAll(async () => {
    m = await bootKeylessMcp();
    m.board = () => new Response(JSON.stringify({
      jobs: [
        { id: FED_ID, source: "usajobs", token: "usajobs", company: AGENCY, title: "Transportation Security Officer", location: "Denver, CO", postedAt: RECENT, applyUrl: FED_ROW.apply_url, recheckedAt: READ_AT },
        { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme Health", title: "Registered Nurse", location: "Denver, CO", postedAt: RECENT },
      ],
      total: 2, hasMore: false,
    }), { status: 200 });
    // The label read answers the stored statement for the ids it is asked
    // about; every other table keeps the harness's empty answer.
    const db = (globalThis as Record<string, unknown>).__keylessMcpDb as { from: (t: string) => unknown };
    const plainFrom = db.from;
    db.from = (table: string) => {
      if (table !== "job_board_postings") return plainFrom(table);
      let ids: string[] = [];
      const chain: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            labelReads.push(ids);
            const data = [FED_ROW].filter((r) => ids.includes(r.id))
              .map(({ id, who_may_apply, hiring_paths, closes_at, first_seen }) => ({ id, who_may_apply, hiring_paths, closes_at, first_seen }));
            return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok, no);
          }
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
          return (...a: unknown[]) => { if (prop === "in" && a[0] === "id") ids = a[1] as string[]; return chain; };
        },
      });
      return chain;
    };
  }, 180_000);

  const search = async () => {
    const r = await m.call({ query: "security officer" });
    expect(r.isError, r.text.slice(0, 400)).toBe(false);
    return JSON.parse(r.text) as Record<string, unknown>;
  };

  it("search_jobs hands the federal card on with the agency, who may apply, the closing date and no posting date", async () => {
    const out = await search();
    const jobs = out.jobs as Array<Record<string, unknown>>;
    expect(jobs.map((j) => j.id)).toEqual([FED_ID, "greenhouse:acme:1"]);
    const card = jobs[0];
    expect(card.company).toBe(AGENCY);
    expect(card.postedAt, "USAJOBS re-dates reposted announcements: no posting date on a federal card").toBeUndefined();
    expect(card.federal).toMatchObject({
      agency: AGENCY, whoMayApply: WHO, hiringPaths: ["public", "vet"], closesAt: CLOSES, onBoardSince: FIRST_SEEN,
      officialUrl: "https://www.usajobs.gov/job/850123456", notice: OPM_NOTICE,
    });
    expect(jobs[1].postedAt, "a card off the federal feed keeps its date").toBe(RECENT);
    expect(jobs[1].federal).toBeUndefined();
    expect(out.withheld).toBeUndefined();
    // The labels were read for the federal id alone.
    expect(labelReads.at(-1)).toEqual([FED_ID]);
  });

  it("the result carries OPM's credit once, with the date the board last read the feed", async () => {
    const out = await search();
    expect(out.federalAttribution).toMatchObject({ publisher: FEDERAL_PUBLISHER, notice: OPM_NOTICE, officialSite: FEDERAL_SITE, retrievedAt: READ_AT });
  });
});

// ── one module, two functions ───────────────────────────────────────────────

describe("the federal module is one file in both functions", () => {
  const IMPORTS = (src: string) => src.split("\n").filter((l) => /^\s*import\b|^\s*export\s+[^=]*\bfrom\s+["']/.test(l));

  it("public-api and agent-mcp carry byte-identical copies that import nothing", () => {
    const api = read("supabase/functions/public-api/federal-rows.ts");
    const mcp = read("supabase/functions/agent-mcp/federal-rows.ts");
    expect(mcp === api, "the two copies differ: copy one over the other").toBe(true);
    expect(IMPORTS(api)).toEqual([]);
  });

  it("TEETH: a copy that drifted by one character, or that imports a sibling, is caught", () => {
    const api = read("supabase/functions/public-api/federal-rows.ts");
    const mcp = read("supabase/functions/agent-mcp/federal-rows.ts");
    const drifted = mcp.replace("endorsed by OPM.", "endorsed by OPM");
    expect(drifted).not.toBe(mcp);
    expect(drifted === api).toBe(false);
    expect(IMPORTS(`import { ATTRIBUTION } from "./source-terms.ts";\n${api}`)).toHaveLength(1);
    expect(IMPORTS(`export { ATTRIBUTION } from "./source-terms.ts";\n${api}`)).toHaveLength(1);
  });
});
