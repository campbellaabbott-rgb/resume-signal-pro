// @vitest-environment node
/**
 * THE DATA API SENDS NOTHING TO ASHBY'S FORM ENDPOINT (OD14-ASHBY-2, owner
 * option "stop").
 *
 * GET /v1/jobs/{id}/application read an Ashby posting's form by POSTing to
 * jobs.ashbyhq.com/api/, a path Ashby's robots file disallows. /v1 now reads
 * every other system's form as before and answers an Ashby posting with
 * form.source "not-read-on-this-surface" beside its apply_url, having sent
 * Ashby nothing; the /v1 index and the note for a system with no reader stop
 * naming Ashby among the forms /v1 reads.
 *
 * Run against the shipped handler: the shared form reader is real, and every
 * request it makes is recorded.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FORM_READER_VENDORS } from "../../supabase/functions/_shared/application-form";
import { selfApplyRoute } from "../../supabase/functions/_shared/self-apply";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Fetched } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ASHBY_ID = "ashby:acme:5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f";
const GH_ID = "greenhouse:acme:4012345";
// A system with no form reader whose note lists the readers: one that needs
// no employer account first (those get a sign-in note instead).
const NO_READER = ["personio", "rippling", "jazzhr", "oracle", "workday"].find((v) => selfApplyRoute(v).needsEmployerAccount !== true);
const NR_ID = `${NO_READER ?? "personio"}:acme:R-1234`;
const posting = (id: string, apply: string) => {
  const [source, token] = id.split(":");
  return {
    id, source, company_token: token, company: "Acme", title: "Platform Engineer", location: "London", country: "GB",
    category: "software", posted_at: hoursAgo(30), first_seen: hoursAgo(30), effective_posted: hoursAgo(30),
    missing_since: null, apply_url: apply, description: "We run Kubernetes on AWS.",
  };
};

let handler: EdgeHandler;
let fetched: Fetched[];
let db: RecordingDb;

beforeAll(async () => {
  ({ handler, fetched } = await loadPublicApi((f) => {
    if (f.url.startsWith("https://boards-api.greenhouse.io/")) {
      return new Response(JSON.stringify({ questions: [{ label: "Why do you want to work at Acme?", required: true, fields: [{ name: "q1", type: "textarea" }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { jobPosting: { applicationForm: { sections: [] } } } }), { status: 200 });
  }));
}, 120_000);

beforeEach(() => {
  fetched.length = 0;
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.application_form_cache_put = () => ({ data: null, error: null });
  db.tables.job_board_postings = [
    posting(ASHBY_ID, "https://jobs.ashbyhq.com/acme/5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f"),
    posting(GH_ID, "https://boards.greenhouse.io/acme/jobs/4012345"),
    posting(NR_ID, "https://acme.example.test/jobs/R-1234"),
  ];
  useDb(db);
});

const formOf = async (id: string) => {
  const r = await callApi(handler, `/v1/jobs/${encodeURIComponent(id)}/application`);
  return { status: r.status, form: (r.body.data as { form: Record<string, unknown>; apply_url: string } | undefined)?.form, data: r.body.data as Record<string, unknown> | undefined };
};

describe("GET /v1/jobs/{id}/application under the Ashby stop", () => {
  it("an Ashby posting is answered from what we hold, and Ashby is sent nothing", async () => {
    const { status, form, data } = await formOf(ASHBY_ID);
    expect(status).toBe(200);
    expect(fetched.map((f) => f.url).filter((u) => /ashbyhq\.com/.test(u)), "a request to Ashby").toEqual([]);
    expect(form).toMatchObject({ source: "not-read-on-this-surface", vendor: "ashby", questions: [] });
    expect(String(form!.note)).toMatch(/apply_url/);
    expect(data!.apply_url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\//);
  });

  it("every other system's form is still read", async () => {
    const { status, form } = await formOf(GH_ID);
    expect(status).toBe(200);
    expect(form).toMatchObject({ source: "employer-published", vendor: "greenhouse" });
    expect(fetched.some((f) => f.url.startsWith("https://boards-api.greenhouse.io/"))).toBe(true);
  });

  it("the note for a system with no reader names the readers /v1 uses, not Ashby", async () => {
    expect(NO_READER, "no unmeasured non-reader left to test the note with: RE-ANCHOR").toBeTruthy();
    const { form } = await formOf(NR_ID);
    expect(form).toMatchObject({ source: "not-published", reason: "no-reader" });
    const note = String(form!.note);
    expect(note).toMatch(/forms are read for .*Greenhouse/);
    expect(note).not.toMatch(/Ashby/);
  });

  it("the /v1 index names every other reader and not Ashby", async () => {
    const r = await callApi(handler, "/v1", { auth: false });
    const text = String((r.body.modes as Record<string, string>).applicationForm);
    expect(text).not.toMatch(/Ashby/i);
    for (const v of FORM_READER_VENDORS.filter((x) => x !== "ashby")) expect(text.toLowerCase(), v).toContain(v);
  });
});
