// @vitest-environment node
/**
 * THE API HANDS ON THE FORM AND LEAVES THE FACTS TO THE PERSON (owner
 * decisions 2026-10-11: the apply pivot, and R2).
 *
 * GET /v1/jobs/{id}/application is the /v1 twin of the MCP apply_myself flow:
 * the employer's own application form for a live posting, every question
 * marked with who answers it under the shared DEFAULT-DENY rule, and nothing
 * filled or submitted.
 *
 * Before: the route did not exist. The path fell into the /v1/jobs/ prefix,
 * was metered as a posting lookup, and answered 404 for the id
 * "<id>/application".
 *
 * Run against the shipped handler with only its network faked: the database,
 * the employer's hiring system and nothing else. The form reader and the
 * who-answers rule are the real shared modules.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { FORM_READER_VENDORS } from "../../supabase/functions/_shared/application-form";
import { isFreeText } from "../../supabase/functions/_shared/self-apply";
import { routeFor, V1_FORM_VENDORS } from "../../supabase/functions/public-api/application";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const GH_ID = "greenhouse:acme:4012345";
const POSTING = {
  id: GH_ID, source: "greenhouse", company_token: "acme", company: "Acme", title: "Platform Engineer",
  location: "London", country: "GB", remote: false, work_mode: "hybrid", department: "Engineering", category: "software",
  posted_at: new Date(Date.now() - 2 * 864e5).toISOString(), first_seen: new Date(Date.now() - 2 * 864e5).toISOString(),
  last_seen: new Date().toISOString(), apply_url: "https://boards.greenhouse.io/acme/jobs/4012345",
  salary: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
  experience_band: "mid", min_years: 3, agency: false,
  description: "We run Kubernetes and Terraform on AWS. You will own our CI/CD pipelines and Python tooling.",
};

const q = (label: string, type: string, extra: Record<string, unknown> = {}) => ({ label, required: true, fields: [{ name: "x", type, ...extra }] });
const GREENHOUSE_FORM = {
  questions: [
    q("First Name", "input_text"),
    q("Email", "input_text"),
    q("Resume/CV", "input_file"),
    q("Will you now or in the future require visa sponsorship?", "multi_value_single_select", { values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }),
    q("Have you ever been terminated from a job?", "textarea"),
    q("Please list two professional references", "textarea"),
    q("What are your salary expectations?", "input_text"),
    q("Why do you want to work at Acme?", "textarea"),
    q("Describe your experience with Kubernetes in production", "textarea"),
  ],
  compliance: [{ type: "eeoc" }],
};

let handler: EdgeHandler;
let posting: Record<string, unknown> | null;
let cacheRow: Record<string, unknown> | null;
let vendor: { status: number; body: unknown } | "throw";
let rpcs: Array<{ name: string; args: Record<string, unknown> }>;
let tables: string[];
let fetched: string[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async (url: string) => {
    fetched.push(String(url));
    if (vendor === "throw") throw new Error("network down");
    return new Response(JSON.stringify(vendor.body), { status: vendor.status });
  };
  handler = await loadEdgeHandler("public-api", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__formDb; }",
  });
}, 120_000);

beforeEach(() => {
  posting = { ...POSTING };
  cacheRow = null;
  vendor = { status: 200, body: GREENHOUSE_FORM };
  rpcs = [];
  tables = [];
  fetched = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve({ data: table === "job_board_postings" ? posting : table === "application_form_cache" ? cacheRow : null, error: null });
        }
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        return () => chain;
      },
    });
    return chain;
  };
  (globalThis as Record<string, unknown>).__formDb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      const r = Promise.resolve(
        name === "api_key_check"
          ? { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null }
          : { data: null, error: null },
      );
      return Object.assign(r, { maybeSingle: () => r });
    },
    from: (table: string) => { tables.push(table); return chainFor(table); },
  };
});

const get = async (path: string) => {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api${path}`, {
    headers: { authorization: "Bearer rb_live_harness_key_0123456789" },
  }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as Record<string, any> };
};
const formPath = (id: string) => `/v1/jobs/${encodeURIComponent(id)}/application`;
const byLabel = (questions: Array<Record<string, unknown>>) => Object.fromEntries(questions.map((x) => [x.label as string, x]));

describe("GET /v1/jobs/{id}/application, as shipped", () => {
  it("serves the employer's form, metered as its own endpoint, with who answers each question", async () => {
    const { status, body, headers } = await get(formPath(GH_ID));
    expect(status).toBe(200);
    expect(headers.get("etag")).toBeTruthy();
    expect(rpcs.find((r) => r.name === "api_key_check")?.args).toMatchObject({ p_endpoint: "/v1/jobs/{id}/application" });
    expect(fetched).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345?questions=true"]);
    const d = body.data;
    expect(d).toMatchObject({ id: GH_ID, title: "Platform Engineer", company_token: "acme", apply_url: POSTING.apply_url });
    expect(d.description, "the posting body stays on /v1/jobs/{id}").toBeUndefined();
    expect(d.form).toMatchObject({ source: "employer-published", vendor: "greenhouse" });
    expect(d.form.alsoOnForm).toContain("Voluntary self-identification (EEO) questions");
    expect(d.route).toEqual({ submitter: "you", needsEmployerAccount: false, captchaLikely: true, attachFilesYourself: true });
    expect(d.postingTerms.length).toBeGreaterThan(0);
    expect(d.postingTerms.length).toBeLessThanOrEqual(30);
    expect(Object.keys(body.answeredByMeans).sort()).toEqual(["draft_from_your_cv", "you", "your_details", "your_documents"]);
    expect(body.note).toMatch(/never fills or submits/);
  });

  it("keeps every fact, every history question and every reference with the person; drafts only work done and motivation", async () => {
    const { body } = await get(formPath(GH_ID));
    const qs = byLabel(body.data.form.questions);
    expect(qs["First Name"].answeredBy).toBe("your_details");
    expect(qs["Email"].answeredBy).toBe("your_details");
    expect(qs["Resume/CV"].answeredBy).toBe("your_documents");
    expect(qs["Will you now or in the future require visa sponsorship?"]).toMatchObject({ answeredBy: "you", options: ["Yes", "No"] });
    for (const label of ["Have you ever been terminated from a job?", "Please list two professional references", "What are your salary expectations?"]) {
      expect(qs[label].answeredBy, label).toBe("you");
    }
    expect(qs["Why do you want to work at Acme?"].answeredBy).toBe("draft_from_your_cv");
    expect(qs["Describe your experience with Kubernetes in production"].answeredBy).toBe("draft_from_your_cv");
    // DEFAULT-DENY, over the whole answer: nothing a person chooses from a
    // list, and nothing that is not free text, is ever handed to a drafter.
    for (const x of body.data.form.questions) {
      if (x.answeredBy === "draft_from_your_cv") expect(isFreeText(x.type, x.options), x.label).toBe(true);
    }
  });

  it("writes the read to the 24-hour cache, and a fresh cached read asks the employer nothing", async () => {
    await get(formPath(GH_ID));
    expect(rpcs.find((r) => r.name === "application_form_cache_put")?.args).toMatchObject({ p_posting_id: GH_ID, p_vendor: "greenhouse", p_ok: true });
    rpcs = []; fetched = [];
    cacheRow = { vendor: "greenhouse", ok: true, read_at: new Date(Date.now() - 3600_000).toISOString(),
      form: { questions: [{ label: "Why do you want to work at Acme?", required: false, type: "textarea" }], documents: [], alsoOnForm: [] } };
    const { status, body } = await get(formPath(GH_ID));
    expect(status).toBe(200);
    expect(fetched).toEqual([]);
    expect(body.data.form.readAt).toBe(cacheRow.read_at);
    expect(rpcs.some((r) => r.name === "application_form_cache_put")).toBe(false);
  });

  it("a hiring system with no reader is not-published beside its apply link, and asks nobody", async () => {
    posting = { ...POSTING, id: "workday:acme~wd5~Ext:R123", source: "workday", company_token: "acme~wd5~Ext", apply_url: "https://acme.wd5.myworkdayjobs.com/Ext/job/R123" };
    const { status, body } = await get(formPath("workday:acme~wd5~Ext:R123"));
    expect(status).toBe(200);
    expect(body.data.form).toMatchObject({ source: "not-published", vendor: "workday", reason: "no-reader" });
    expect(body.data.form, "no form read is said, beside empty lists, never served as a form").toMatchObject({ questions: [], documents: [], alsoOnForm: [] });
    expect(body.data.form.note).toMatch(/apply_url/);
    expect(body.data.route.needsEmployerAccount).toBe(true);
    expect(fetched).toEqual([]);
  });

  it("a hiring system that does not answer is a 503 with Retry-After, never a form that asks nothing, and is not cached", async () => {
    vendor = { status: 503, body: {} };
    const r = await get(formPath(GH_ID));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("form_unreachable");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    vendor = "throw";
    expect((await get(formPath(GH_ID))).status).toBe(503);
    expect(rpcs.some((x) => x.name === "application_form_cache_put")).toBe(false);
  });

  it("a withheld hiring system is refused by name before any read", async () => {
    const r = await get(formPath("smartrecruiters:acme:999"));
    expect(r.status).toBe(451);
    expect(r.body.error.code).toBe("source_not_redistributable");
    expect(tables).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("a posting that is gone is a 404; a malformed id or an unknown parameter is a 400", async () => {
    posting = null;
    expect((await get(formPath(GH_ID))).status).toBe(404);
    expect(fetched).toEqual([]);
    posting = { ...POSTING };
    expect((await get("/v1/jobs/%E0%A4%A/application")).body.error.code).toBe("bad_id");
    expect((await get(formPath("not-an-id"))).body.error.code).toBe("bad_id");
    expect((await get(`${formPath(GH_ID)}?format=markdown`)).body.error.code).toBe("unknown_parameter");
  });
});

describe("the /v1 index describes the form route as it behaves", () => {
  it("lists it, names every system whose form it reads, and says what it refuses", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/public-api/v1"));
    const body = await res.json() as { endpoints: string[]; modes: Record<string, string>; restrictions: { note: string } };
    expect(body.endpoints).toContain("/v1/jobs/{id}/application");
    const text = body.modes.applicationForm;
    for (const v of FORM_READER_VENDORS) expect(text.toLowerCase()).toContain(v);
    expect(text).toMatch(/451/);
    expect(text).toMatch(/503 with Retry-After/);
    expect(text).toMatch(/default-deny/);
    expect(text).toMatch(/Nothing is filled or submitted/);
    expect(body.restrictions.note).toContain("/v1/jobs/{id}/application");
  });

  it("R2: /v1 reads every reader's forms, not only the public-API two", () => {
    expect([...V1_FORM_VENDORS].sort()).toEqual([...FORM_READER_VENDORS].sort());
    expect(V1_FORM_VENDORS.length).toBe(5);
  });

  it("the route never claims a vendor it never measured", () => {
    expect(routeFor("someunmeasuredats")).toEqual({ submitter: "you", needsEmployerAccount: null, captchaLikely: null, attachFilesYourself: true });
  });
});
