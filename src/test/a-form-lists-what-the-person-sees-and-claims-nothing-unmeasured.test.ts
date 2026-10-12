/**
 * A FORM LISTS WHAT THE PERSON SEES, AND CLAIMS NOTHING NOBODY MEASURED.
 *
 * Sweep S12-173, read live on an xAI Greenhouse posting: the location
 * question's Latitude and Longitude arrive as required `input_hidden` fields,
 * which the page fills itself, and apply_myself listed both as required
 * questions for the person. And Greenhouse puts a data_compliance entry on
 * every posting, with flags saying whether the form asks for consent; the
 * reader printed "Data-protection consent (GDPR)" for all of them.
 *
 * Sweep S12-174: apply_myself's route said needsEmployerAccount false and
 * captchaLikely false for a hiring system nobody measured (Taleo, say), which
 * is "no account, no CAPTCHA" as a claim. /v1 already answered null.
 *
 * The real reader with an injected fetch and cache, and the real answer and
 * packet builders.
 */
import { describe, expect, it } from "vitest";
import { readApplicationForm, type FormCache, type FormCacheRow, type PostingRef } from "../../supabase/functions/_shared/application-form";
import { applyMyselfAnswer, applyMyselfMarkdown, routeFor } from "../../supabase/functions/agent-mcp/apply-myself";
import { routeFor as v1RouteFor } from "../../supabase/functions/public-api/application";
import { automationFor } from "../../supabase/functions/_shared/apply-automation";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const ref = (id: string): PostingRef => {
  const [source, token] = id.split(":");
  return { id, source, token, applyUrl: null };
};
const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

/** The shape Greenhouse's board API serves with ?questions=true for a posting with a location question. */
const LIVE_SHAPE = {
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Resume/CV", required: true, fields: [{ name: "resume", type: "input_file" }] },
  ],
  location_questions: [
    { label: "Location (City)", required: true, fields: [{ name: "job_application[location]", type: "input_text" }] },
    { label: "Latitude", required: true, fields: [{ name: "job_application[latitude]", type: "input_hidden" }] },
    { label: "Longitude", required: true, fields: [{ name: "job_application[longitude]", type: "input_hidden" }] },
  ],
  data_compliance: [{ type: "gdpr", requires_consent: false, requires_processing_consent: false, requires_retention_consent: false, retention_period: null, demographic_data_consent_applies: false }],
};

describe("Greenhouse: what the person fills in, and only the consent the form asks for (S12-173)", () => {
  it("hidden fields are not questions", async () => {
    const r = await readApplicationForm(ref("greenhouse:xai:4567"), { fetch: answer(LIVE_SHAPE), now: () => NOW });
    if (r.kind !== "read") throw new Error(r.kind);
    expect(r.form.questions.map((q) => q.label)).toEqual(["First Name", "Resume/CV", "Location (City)"]);
  });

  it("a data_compliance entry whose flags ask nothing is not a consent on the form", async () => {
    const r = await readApplicationForm(ref("greenhouse:xai:4567"), { fetch: answer(LIVE_SHAPE), now: () => NOW });
    if (r.kind !== "read") throw new Error(r.kind);
    expect(r.form.alsoOnForm).toEqual([]);
  });

  it.each(["requires_consent", "requires_processing_consent", "requires_retention_consent", "demographic_data_consent_applies"])(
    "one that sets %s is named",
    async (flag) => {
      const body = { ...LIVE_SHAPE, data_compliance: [{ ...LIVE_SHAPE.data_compliance[0], [flag]: true }] };
      const r = await readApplicationForm(ref("greenhouse:xai:4567"), { fetch: answer(body), now: () => NOW });
      if (r.kind !== "read") throw new Error(r.kind);
      expect(r.form.alsoOnForm).toEqual(["Data-protection consent (GDPR)"]);
    },
  );

  it("a form cached before the fix is served without its hidden fields", async () => {
    const form = { questions: [{ label: "Location (City)", required: true, type: "input_text" }, { label: "Latitude", required: true, type: "input_hidden" }], documents: [], alsoOnForm: [] };
    const rows: Record<string, FormCacheRow> = { "greenhouse:xai:4567": { vendor: "greenhouse", ok: true, form, read_at: new Date(NOW - 3600_000).toISOString() } };
    const cache: FormCache = { get: async (id) => rows[id] ?? null, put: async () => {} };
    const r = await readApplicationForm(ref("greenhouse:xai:4567"), { fetch: answer({}), cache, now: () => NOW });
    expect(r).toMatchObject({ kind: "read", cached: true });
    if (r.kind !== "read") return;
    expect(r.form.questions.map((q) => q.label)).toEqual(["Location (City)"]);
  });
});

describe("a hiring system nobody measured is not said to have no account and no CAPTCHA (S12-174)", () => {
  it("Taleo answers null for both, in the JSON and in the packet", () => {
    expect(automationFor("taleo").tier).toBe("unknown");
    expect(routeFor("taleo")).toEqual({ submitter: "you", needsEmployerAccount: null, captchaLikely: null, attachFilesYourself: true });
    const posting = { id: "taleo:acme:1", title: "Analyst", company: "Acme", location: null, pay: null, postedAt: null, applyUrl: "https://acme.taleo.net/careersection/1", siteUrl: "https://resumebooster.work/jobs?job=taleo:acme:1" };
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting, { kind: "no-reader", vendor: "taleo" }, []));
    expect(md).toMatch(/We have not measured whether this hiring system asks for an account or a CAPTCHA\./);
  });

  it("the connector and /v1 say the same for every measured system and for an unmeasured one", () => {
    for (const v of ["greenhouse", "ashby", "lever", "workday", "bamboohr", "recruitee", "breezy", "pinpoint", "icims", "taleo", "someunmeasuredats"]) {
      expect(routeFor(v), v).toEqual(v1RouteFor(v));
    }
  });

  it("a measured system keeps its measured answer", () => {
    expect(routeFor("lever")).toMatchObject({ needsEmployerAccount: false, captchaLikely: true });
    expect(routeFor("workday")).toMatchObject({ needsEmployerAccount: true, captchaLikely: false });
  });
});
