// @vitest-environment node
//
// Node, not jsdom: this file bundles public-api with esbuild.
/**
 * A FEDERAL CLOSURE IS CREDITED, AND THE CHANGE FEED NAMES WHAT IT CANNOT
 * OPEN (OD16 review, 2026-11-19).
 *
 * The first cut of OD16 took usajobs off the redistribution list, which let
 * /v1/changes hand on federal closures with no condition OPM's terms ask for:
 *   - closed[] served each federal closure raw (company, title, category,
 *     first_seen, posted_at, closed_at), with no federal block, no notice and
 *     our first sighting as first_seen;
 *   - the credit was built from opened[] alone, so a page holding only
 *     federal closures carried no meta.attribution.federal at all;
 *   - where opened federal rows were present, retrievedAt was always null:
 *     the opened select carries no read stamp and the feed never read one;
 *   - opened[] is keyed on first_seen, so a federal announcement labelled
 *     after a sync's cursor passed its first_seen (the whole ~18,500 backlog)
 *     never opens there while its closure does close there, and no part of
 *     the body said so.
 * And /v1/jobs still promised every row was "still live in the employer's
 * own feed", which the more-good-jobs report measured false for federal rows.
 *
 * Each is held on the shipped handler, against a database that answers the
 * reads. TEETH: every assertion below fails on the first cut (fdd56d5e2):
 * the closure had no federal block and kept first_seen, the closure-only body
 * had no meta, retrievedAt was null, federalCoverage did not exist, and the
 * coverage note had no federal clause.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
import { OPM_NOTICE } from "../../supabase/functions/public-api/federal-rows";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const RECENT = ago(2 * DAY);
const READ_AT = ago(3_600_000);

const LABELLED_ID = "usajobs:usajobs:850123456";
const UNLABELLED_ID = "usajobs:usajobs:881700001";
const GH_ID = "greenhouse:acme:1";

const posting = (o: Record<string, unknown>): Record<string, unknown> => ({
  location: "Denver, CO", country: "US", remote: false, work_mode: null, department: null, category: "security",
  posted_at: RECENT, salary: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
  experience_band: null, min_years: null, agency: false, closes_at: null, who_may_apply: null, hiring_paths: null,
  effective_posted: RECENT, missing_since: null, ...o,
});
const LABELLED = posting({
  id: LABELLED_ID, source: "usajobs", company_token: "usajobs", company: "Transportation Security Administration",
  title: "Transportation Security Officer", apply_url: "https://www.usajobs.gov/job/850123456", first_seen: ago(5 * DAY),
  closes_at: new Date(Date.now() + 20 * DAY).toISOString(), who_may_apply: "Open to the public", hiring_paths: ["public"],
});
const UNLABELLED = posting({
  id: UNLABELLED_ID, source: "usajobs", company_token: "usajobs", company: "Air National Guard Units",
  title: "Security Officer (Title 32)", apply_url: "https://www.usajobs.gov/job/881700001", first_seen: ago(6 * DAY),
});
const GH = posting({
  id: GH_ID, source: "greenhouse", company_token: "acme", company: "Acme Health", title: "Security Officer",
  apply_url: "https://boards.greenhouse.io/acme/jobs/1", first_seen: ago(4 * DAY),
});

const FED_CLOSURE_FIRST_SEEN = ago(9 * DAY);
const closure = (o: Record<string, unknown>): Record<string, unknown> => ({
  category: "security", posted_at: RECENT, closed_at: ago(DAY), superseded: false, absence_basis: null,
  suspect: false, batch_live_before: 40, ...o,
});
const FED_CLOSURE = closure({
  event_id: 7001, posting_id: "usajobs:usajobs:881700002", source: "usajobs", company_token: "usajobs",
  company: "Veterans Health Administration", title: "Police Officer", first_seen: FED_CLOSURE_FIRST_SEEN,
});
const GH_CLOSURE = closure({
  event_id: 7002, posting_id: "greenhouse:acme:9", source: "greenhouse", company_token: "acme",
  company: "Acme Health", title: "Nurse", first_seen: ago(12 * DAY), closed_at: ago(DAY - 5 * MIN),
});

function freshDb(opts: { postings?: Array<Record<string, unknown>>; closures?: Array<Record<string, unknown>>; tier?: string } = {}): RecordingDb {
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: { ...ALLOWED, key_tier: opts.tier ?? "free" }, error: null });
  db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
  db.tables.job_board_postings = (opts.postings ?? [LABELLED, UNLABELLED, GH]).map((r) => ({ ...r }));
  db.tables.job_board_closures = (opts.closures ?? [FED_CLOSURE, GH_CLOSURE]).map((r) => ({ ...r }));
  db.tables.job_board_verifications = [
    { company_token: "usajobs:usajobs", verified_at: READ_AT },
    { company_token: "greenhouse:acme", verified_at: READ_AT },
  ];
  return db;
}

const SINCE = encodeURIComponent(ago(25 * DAY));
type Row = Record<string, unknown>;
const federalCredit = (body: Record<string, unknown>) =>
  ((body.meta as Row | undefined)?.attribution as Row | undefined)?.federal as Row | undefined;

/** The board's ranked answer: its own field names, no statement on any row. */
const BOARD_PAGE = {
  jobs: [GH].map((r) => ({ id: r.id, source: r.source, token: r.company_token, company: r.company, title: r.title, location: r.location, country: r.country, postedAt: r.posted_at, applyUrl: r.apply_url, recheckedAt: READ_AT })),
  total: 1, hasMore: false,
};

let handler: EdgeHandler;
beforeAll(async () => {
  ({ handler } = await loadPublicApi((f) =>
    f.url.endsWith("/functions/v1/job-board")
      ? new Response(JSON.stringify(BOARD_PAGE), { status: 200 })
      : new Response("{}", { status: 404 })));
}, 180_000);

describe("/v1/changes shapes and credits a federal closure as it does a federal row", () => {
  it("a federal closure names its agency, links the official announcement, carries OPM's notice, and moves our first sighting off first_seen", async () => {
    useDb(freshDb());
    const r = await callApi(handler, `/v1/changes?since=${SINCE}`);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const closed = r.body.closed as Row[];
    const fed = closed.find((c) => c.posting_id === FED_CLOSURE.posting_id)!;
    expect(fed, "the federal closure is served (a closure suggests no job, so it is not gated)").toBeDefined();
    expect(fed.company).toBe("Veterans Health Administration");
    expect(fed.first_seen, "our first sighting is not an age, so it is not first_seen on a federal row").toBeNull();
    expect(fed.federal).toEqual({
      agency: "Veterans Health Administration",
      official_url: "https://www.usajobs.gov/job/881700002",
      on_board_since: FED_CLOSURE_FIRST_SEEN,
      notice: OPM_NOTICE,
    });
    expect(fed.outcome).toBe("closed");
  });

  it("a closure off the federal feed is served exactly as before: first_seen kept, no federal block", async () => {
    useDb(freshDb());
    const r = await callApi(handler, `/v1/changes?since=${SINCE}`);
    const gh = (r.body.closed as Row[]).find((c) => c.posting_id === GH_CLOSURE.posting_id)!;
    expect(gh.first_seen).toBe(GH_CLOSURE.first_seen);
    expect("federal" in gh).toBe(false);
  });

  it("a page whose only federal row is a closure still carries OPM's credit, with the date our board read the feed", async () => {
    // opened[] holds the Greenhouse row alone: the federal announcement in the
    // table has no who-may-apply statement, so the gate keeps it out.
    useDb(freshDb({ postings: [UNLABELLED, GH] }));
    const r = await callApi(handler, `/v1/changes?since=${SINCE}`);
    expect(r.status).toBe(200);
    expect((r.body.opened as Row[]).map((x) => x.id)).toEqual([GH_ID]);
    expect((r.body.closed as Row[]).some((c) => c.source === "usajobs")).toBe(true);
    const credit = federalCredit(r.body);
    expect(credit, "a body carrying a federal closure carried no meta.attribution.federal").toBeDefined();
    expect(credit!.notice).toBe(OPM_NOTICE);
    expect(credit!.officialSite).toBe("https://www.usajobs.gov");
    expect(credit!.retrievedAt).toBe(READ_AT);
  });

  it("with opened federal rows present, the credit names the date we read the feed, never null", async () => {
    useDb(freshDb({ closures: [GH_CLOSURE] }));
    const r = await callApi(handler, `/v1/changes?since=${SINCE}`);
    expect((r.body.opened as Row[]).map((x) => x.id)).toContain(LABELLED_ID);
    expect(federalCredit(r.body)?.retrievedAt, "an opened federal row's body named no retrieval date").toBe(READ_AT);
  });

  it("a body with no federal row carries no federal credit", async () => {
    useDb(freshDb({ postings: [GH], closures: [GH_CLOSURE] }));
    const r = await callApi(handler, `/v1/changes?since=${SINCE}`);
    expect(r.status).toBe(200);
    expect(r.body.meta).toBeUndefined();
  });

  it("every change-feed body says which federal announcements opened[] can never show, and where to read them", async () => {
    useDb(freshDb({ postings: [GH], closures: [GH_CLOSURE] }));
    const r = await callApi(handler, `/v1/changes?since=${SINCE}`);
    const cov = r.body.federalCoverage as { opened?: string; closed?: string } | undefined;
    expect(cov, "the change feed did not state the federal backlog it cannot open").toBeDefined();
    expect(cov!.opened).toMatch(/keyed on first_seen/);
    expect(cov!.opened).toMatch(/never appears in opened\[\]/);
    expect(cov!.opened).toMatch(/18,500/);
    expect(cov!.opened).toContain("/v1/jobs?source=usajobs");
    expect(cov!.closed).toMatch(/every U\.S\. federal closure/);
    expect(String(r.body.note)).toMatch(/federalCoverage/);
    // The withheld list is still SmartRecruiters alone: the federal feed is covered in part, not withheld.
    expect((r.body.excludedSources as { sources: string[] }).sources).toEqual(["smartrecruiters"]);
  });

  it("the keyless /v1 index says the same, and no longer says an unlabelled announcement is absent from every row endpoint", async () => {
    useDb(freshDb());
    const feed = await callApi(handler, `/v1/changes?since=${SINCE}`);
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/public-api/v1"));
    expect(res.status).toBe(200);
    const fed = ((await res.json()) as { federal: { gate: string; changes: unknown } }).federal;
    expect(fed.changes).toEqual(feed.body.federalCoverage);
    // A closure of an announcement never served is in closed[]: "absent from every row endpoint" was false of it.
    expect(fed.gate).not.toMatch(/absent from every row endpoint/);
    expect(fed.gate).toMatch(/closed\[\] of \/v1\/changes whether or not it was ever served/);
    expect(fed.gate).toMatch(/who_may_apply/);
  });
});

describe("/v1/jobs no longer promises a federal row is in the feed's last read", () => {
  const judge = (note: unknown) => {
    const n = String(note ?? "");
    expect(n).toMatch(/except U\.S\. federal announcements \(source usajobs\)/);
    expect(n).toMatch(/at most 10,000/);
    expect(n).toMatch(/open until the agency's closing date \(closes_at\)/);
  };

  it("the listed page's coverage note says a federal row is open until the agency's closing date", async () => {
    useDb(freshDb());
    const r = await callApi(handler, "/v1/jobs?source=usajobs");
    expect(r.status).toBe(200);
    expect((r.body.data as Row[]).map((x) => x.id)).toEqual([LABELLED_ID]);
    judge((r.body.coverage as Row).note);
    expect(String((r.body.coverage as Row).note)).toMatch(/Withdrawn postings are excluded, never re-dated\.$/);
  });

  it("the ranked page's coverage note says the same", async () => {
    useDb(freshDb({ tier: "builder" }));
    const r = await callApi(handler, "/v1/jobs?engine=ranked&q=security");
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    judge((r.body.coverage as Row).note);
  });
});
