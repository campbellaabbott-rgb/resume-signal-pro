// @vitest-environment node
/**
 * THE TAILOR READS THE WHOLE POSTING, AND THE URL READER LEAVES ROOM FOR THE
 * HEADER THE UPLOADER PUTS ABOVE IT (S14X-270).
 *
 * The tailor cut every posting at 5,000 characters without a word, so a long
 * posting's required skills (usually near its end) never reached the model.
 * It now reads up to the shared 20,000-character cap and says when it cut.
 *
 * The job-link reader clipped at 20,000 too, but the scanner puts a header
 * (title, company, the source link) above the text, so a long posting arrived
 * over the cap the scan refuses. It now clips at 17,000, which leaves room for
 * the largest header, and says when it cut.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JOB_DESCRIPTION_LENGTH } from "../../supabase/functions/_shared/input-limits";
import { MAX_DESCRIPTION_CHARS, jobPostingFromHtml } from "../../supabase/functions/fetch-job-posting/extract";
import { handleFetchJobPosting, type HandlerDeps } from "../../supabase/functions/fetch-job-posting/handler";
import { WritingWorld, loadWriter, post, toolReply, tokenFor, FREE_USER } from "./helpers/writing-harness";
import { KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let tailor: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  tailor = await loadWriter("generate-tailored-resume");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const FILLER = "The team owns checkout and payments services end to end and works closely with finance. ";
/** A posting of `length` characters with `marker` starting at `at`. */
function longPosting(length: number, marker: string, at: number): string {
  const head = FILLER.repeat(Math.ceil(at / FILLER.length)).slice(0, at);
  const tail = FILLER.repeat(Math.ceil(length / FILLER.length));
  return (head + marker + tail).slice(0, length);
}
const REPLY = {
  professionalSummary: "Senior software engineer who led a payments team.",
  keySkills: ["TypeScript"], experienceHighlights: [], keywordsRequired: [], keywordGaps: [],
  matchScoreDelta: 5, suggestedJobTitle: "Senior Engineer", coverLetterOpening: "", applicationTips: [],
};

describe("the tailor", () => {
  it("reads a 12,000-character posting to its end: a skill at character 9,000 reaches the model", async () => {
    world.reply = () => toolReply("submit_tailored_resume", REPLY);
    const marker = " Required: production experience with Elixir and Phoenix LiveView. ";
    const jobDescription = longPosting(12_000, marker, 9_000);
    const r = await post(tailor, "generate-tailored-resume", { resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription }, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.prompts()).toContain("Elixir and Phoenix LiveView");
    expect(r.body.postingTruncated).toBeUndefined();
  });

  it("says when a posting was longer than it reads", async () => {
    world.reply = () => toolReply("submit_tailored_resume", REPLY);
    const jobDescription = longPosting(25_000, " Required: Elixir. ", 100);
    const r = await post(tailor, "generate-tailored-resume", { resumeText: KIT_RESUME, jobTitle: "Senior Engineer", jobCompany: "Hooli", jobDescription }, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.postingTruncated).toBe(true);
  });
});

describe("the job-link reader", () => {
  const description = longPosting(30_000, "", 0);
  const page = `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "T".repeat(300), hiringOrganization: { "@type": "Organization", name: "C".repeat(300) }, description })}</script></head><body></body></html>`;

  it("clips a 30,000-character description at 17,000 and says so", () => {
    const p = jobPostingFromHtml(page)!;
    expect(p.text.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1);
    expect(MAX_DESCRIPTION_CHARS).toBe(17_000);
    expect(p.truncated).toBe(true);
    expect(jobPostingFromHtml(page.replace(description, description.slice(0, 2_000)))?.truncated).toBeUndefined();
  });

  it("leaves room for the scanner's header: title, company and a 2,048-character link stay under the scan's cap", () => {
    const p = jobPostingFromHtml(page)!;
    const link = `https://acme.recruitee.com/o/${"x".repeat(2_048 - 29)}`;
    // The header the scanner composes above a read posting (ResumeUploader).
    const head = [`Job Title: ${"T".repeat(300)}`, `Company: ${"C".repeat(300)}`, `Source: ${link}`].join("\n");
    const composed = `${head}\n\nJob Description:\n${p.text.trim()}`;
    expect(link.length).toBe(2_048);
    expect(composed.length).toBeLessThanOrEqual(MAX_JOB_DESCRIPTION_LENGTH);
  });

  it("tells the page when the posting it returns was cut", async () => {
    const hd: HandlerDeps = {
      resolve: async () => ["151.101.1.69"],
      fetch: async (u) => (u.includes("/api/offers/")
        ? new Response(JSON.stringify({ offer: { title: "Payroll Analyst", company_name: "Acme", description: `<p>${description}</p>` } }))
        : new Response("nope", { status: 500 })),
      deadlineMs: 2_000,
      serviceKey: "svc-key",
      rpc: async (fn) => (fn === "check_rate_limit" ? { data: true, error: null } : { data: [{ is_allowed: true }], error: null }),
    };
    const res = await handleFetchJobPosting(new Request("https://h.supabase.co/functions/v1/fetch-job-posting", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" }, body: JSON.stringify({ url: "https://acme.recruitee.com/o/payroll-analyst" }),
    }), hd);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, truncated: true });
    expect(String(j.text).length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1);
  });
});
