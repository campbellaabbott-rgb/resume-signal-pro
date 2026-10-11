// @vitest-environment node
/**
 * AN APPLY KIT SHIPPED AN INVENTED PHONE AND LINKEDIN UNDER A "VERIFIED"
 * BANNER (S11-017).
 *
 * generate-apply-package's tool schema makes all seven contact fields required
 * strings, and its prompt had no copy-only rule for them. validateTailoredResume
 * never looked at resume.contact, so a reply carrying "(512) 555-0142" and
 * "linkedin.com/in/janedoe" for a résumé that has neither answered 200 with
 * verified: true, and the PDF and DOCX exporters printed them; a reply of
 * "N/A" and "Not provided" printed those. The $7 Apply Assistant, the Pro
 * per-job kits and the co-pilot all use this generator.
 *
 * WHAT HOLDS NOW: a contact value the source résumé lacks, or a placeholder,
 * is blanked (and reported), the candidate's own contact values are kept in
 * whatever form the model wrote them, and the prompt carries the copy-only
 * rule. Run against the shipped module and the shipped handler.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { validateTailoredResume, type TailoredResumeShape } from "../../supabase/functions/_shared/resume-grounding";

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | 555-010-0199 | Austin, TX | github.com/janedoe",
  "Senior Software Engineer, Acme Corp, 2019 - Present",
  "- Built the payments platform in TypeScript and Postgres",
  "Software Engineer, Initech, 2015 - 2019",
  "- Maintained billing services",
  "BS Computer Science, University of Texas, 2015",
].join("\n");

const tailored = (contact: Record<string, string>): TailoredResumeShape => ({
  contact,
  summary: "Senior engineer who builds payments platforms.",
  experience: [
    { company: "Acme Corp", title: "Senior Software Engineer", location: "Austin, TX", startDate: "2019", endDate: "Present", bullets: ["Built the payments platform in TypeScript and Postgres"] },
  ],
  education: [{ school: "University of Texas", degree: "BS Computer Science", field: "Computer Science", startDate: "", endDate: "2015", details: "" }],
  skills: ["TypeScript"],
  certifications: [],
});

describe("validateTailoredResume grounds the contact line", () => {
  it("blanks an invented phone, LinkedIn and website, and keeps the candidate's own in the model's formatting", () => {
    const g = validateTailoredResume(RESUME, tailored({
      fullName: "Jane Doe", title: "Senior Software Engineer", email: "jane.doe@example.com",
      phone: "(512) 555-0142", location: "Austin, TX", linkedIn: "https://www.linkedin.com/in/janedoe", website: "janedoe.dev",
    }));
    expect(g.ok).toBe(true);
    expect(g.cleaned.contact.phone, "an invented phone number shipped").toBe("");
    expect(g.cleaned.contact.linkedIn, "a stranger's LinkedIn shipped").toBe("");
    expect(g.cleaned.contact.website, "an invented website shipped").toBe("");
    expect(g.cleaned.contact).toMatchObject({ fullName: "Jane Doe", email: "jane.doe@example.com", location: "Austin, TX", title: "Senior Software Engineer" });
    expect(g.removedContact).toEqual(expect.arrayContaining([expect.stringContaining("555-0142"), expect.stringContaining("linkedin.com/in/janedoe")]));
  });

  it("keeps the candidate's phone and profile however they were punctuated", () => {
    const g = validateTailoredResume(RESUME, tailored({
      fullName: "Jane Doe", title: "", email: "Jane.Doe@example.com", phone: "(555) 010-0199", location: "Austin, Texas", linkedIn: "", website: "https://github.com/janedoe/",
    }));
    expect(g.cleaned.contact.phone).toBe("(555) 010-0199");
    expect(g.cleaned.contact.website).toBe("https://github.com/janedoe/");
    expect(g.cleaned.contact.email).toBe("Jane.Doe@example.com");
    expect(g.removedContact).toEqual([]);
  });

  it("blanks a placeholder whatever the field", () => {
    const g = validateTailoredResume(RESUME, tailored({
      fullName: "Jane Doe", title: "Engineer", email: "jane.doe@example.com", phone: "N/A", location: "Austin, TX", linkedIn: "Not provided", website: "[Website]",
    }));
    expect(g.cleaned.contact).toMatchObject({ phone: "", linkedIn: "", website: "" });
  });
});

describe("generate-apply-package ships the grounded contact line", () => {
  let handler: EdgeHandler;
  let prompts: string[] = [];
  const TOOL_ARGS = {
    jobMetadata: { company: "Globex", roleTitle: "Senior Engineer", applyMethodHint: "" },
    tailoredResume: tailored({
      fullName: "Jane Doe", title: "Senior Software Engineer", email: "jane.doe@example.com",
      phone: "(512) 555-0142", location: "Austin, TX", linkedIn: "linkedin.com/in/janedoe", website: "N/A",
    }),
    skillGaps: [],
    checklist: ["Review the resume", "Submit it on the employer's site"],
  };

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test_harness", LOVABLE_API_KEY: "lovable_harness", SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    db.rpcs.purchase_spend_take = () => ({ data: true, error: null });
    g.__contactDb = db;
    g.__contactStripe = async (id: string) => ({ id, payment_status: "paid", metadata: { product_type: "apply_assistant" } });
    g.fetch = async (url: string, init?: RequestInit) => {
      if (String(url).includes("ai.gateway.lovable.dev")) {
        prompts.push(JSON.parse(String(init?.body ?? "{}")).messages?.[0]?.content ?? "");
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_apply_package", arguments: JSON.stringify(TOOL_ARGS) } }] } }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    handler = await loadEdgeHandler("generate-apply-package", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: (id) => globalThis.__contactStripe(id) } }; } }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
      "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__contactDb;",
    });
  }, 60_000);

  it("a reply that invents a phone and a LinkedIn, or writes N/A, ships none of them", async () => {
    prompts = [];
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-apply-package", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ resumeText: RESUME, jobPostingText: "Globex is hiring a senior engineer to own payments end to end.", sessionId: "cs_live_contact_kit" }),
    }));
    const body = await res.json() as { tailoredResume?: TailoredResumeShape; groundingReport?: { verified: boolean; removedContact?: string[] } };
    expect(res.status, JSON.stringify(body).slice(0, 200)).toBe(200);
    expect(body.tailoredResume?.contact).toMatchObject({ phone: "", linkedIn: "", website: "", email: "jane.doe@example.com", fullName: "Jane Doe" });
    expect(body.groundingReport?.removedContact?.length).toBe(3);
    expect(prompts[0], "the prompt carries no copy-only rule for the contact line").toMatch(/CONTACT LINE — COPY ONLY, NEVER ADD/);
  });
});
