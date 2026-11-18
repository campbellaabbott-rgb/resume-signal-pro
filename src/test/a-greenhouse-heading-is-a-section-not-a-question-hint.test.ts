/**
 * A GREENHOUSE HEADING IS A SECTION, NOT A QUESTION'S HINT (S14X-264).
 *
 * Greenhouse employers title the parts of a form by putting a heading in the
 * description of the question ABOVE the part: on sonobello/5474869008 (read
 * live 2026-11-16, saved in fixtures/greenhouse-sonobello-5474869008.json
 * with the posting text emptied) "<h2>Work Authorization</h2>" sits on the
 * question asking which relatives work there, and "<h2>Employment
 * History</h2>" on "What kind of work energizes you". The reader stored each
 * as that question's hint, so the self-apply marks read the relatives
 * question as a work-authorisation one (a non-plain hint sets the topic and
 * stops a draft), and the packet printed "Note from the employer: Work
 * Authorization" under it.
 *
 * Now a description that is ONLY a heading is carried as `section` on the
 * question after it, never as a hint, so it sets no topic and blocks no draft;
 * the packet prints it as the question's section. A description with a heading
 * and anything else is still a hint. A Greenhouse cache row written before
 * this (no `sectioned` mark) holds the headings as hints with their tags
 * stripped, so it is read again rather than believed for its 24 hours.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readApplicationForm, type FormCache, type FormCacheRow, type PostingRef } from "../../supabase/functions/_shared/application-form";
import { whoAnswersEach } from "../../supabase/functions/_shared/self-apply";
import { applyMyselfAnswer, applyMyselfMarkdown } from "../../supabase/functions/agent-mcp/apply-myself";

const NOW = Date.parse("2026-11-16T10:00:00Z");
const FIXTURE = readFileSync(resolve(__dirname, "fixtures/greenhouse-sonobello-5474869008.json"), "utf8");
const REF: PostingRef = { id: "greenhouse:sonobello:5474869008", source: "greenhouse", token: "sonobello", applyUrl: null };
const serve = (body: string) => {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(body, { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
  return { f, calls };
};
const readSono = async () => {
  const r = await readApplicationForm(REF, { fetch: serve(FIXTURE).f, now: () => NOW });
  if (r.kind !== "read") throw new Error(r.kind);
  return r.form.questions;
};
const at = (qs: Array<{ label: string }>, start: string) => {
  const i = qs.findIndex((q) => q.label.startsWith(start));
  if (i < 0) throw new Error(`no question starting ${start}`);
  return i;
};

describe("sonobello/5474869008, as Greenhouse serves it", () => {
  it("each heading is the section of the question after it, and the hint of none", async () => {
    const qs = await readSono();
    const relatives = at(qs, "If yes, please list the name(s)");
    expect(qs[relatives].hint).toBeUndefined();
    expect(qs[relatives + 1]).toMatchObject({ label: "Are you authorized to work in the US?", section: "Work Authorization" });
    expect(qs[at(qs, "Do you have the following License")].section).toBe("Licensure");
    expect(qs[at(qs, "Have you ever been employed by Sono Bello")].section).toBe("Employment Eligibility");
    expect(qs[at(qs, "Are you available to work a Monday")].section).toBe("Schedule & Compensation");
    expect(qs[at(qs, "Tell us about a time")].section).toBe("Company Culture & Values");
    expect(qs[at(qs, "How many years of experience")].section).toBe("Employment History");
    for (const q of qs) expect(q.hint ?? "", q.label).not.toMatch(/^(?:Work Authorization|Licensure|Employment Eligibility|Employment History|Schedule & Compensation|Company Culture & Values)$/);
  });

  it("a description that says more than a heading is still the question's hint", async () => {
    const qs = await readSono();
    expect(qs[at(qs, "Within your most recent position what type of healthcare setting")].hint).toMatch(/^Examples: Hospital/);
  });

  it("the relatives question is not a work-authorisation question, and the next one carries its section", async () => {
    const marked = whoAnswersEach(await readSono());
    const relatives = marked.find((q) => q.label.startsWith("If yes, please list the name(s)"))!;
    expect(relatives.topic).not.toBe("work_authorisation");
    expect(relatives.hint).toBeUndefined();
    expect(marked.find((q) => q.label === "Are you authorized to work in the US?")?.section).toBe("Work Authorization");
  });

  it("the packet prints the section as a section, never as a note from the employer", async () => {
    const r = await readApplicationForm(REF, { fetch: serve(FIXTURE).f, now: () => NOW });
    const posting = { id: REF.id, title: "Registered Nurse", company: "Sono Bello", location: null, pay: null, postedAt: null, applyUrl: "https://boards.greenhouse.io/sonobello/jobs/5474869008", siteUrl: `https://resumebooster.work/jobs?job=${REF.id}` };
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting, r, []));
    expect(md).toMatch(/Are you authorized to work in the US\? \(required\)\n {3}Section: Work Authorization/);
    expect(md).not.toMatch(/Note from the employer: (?:Work Authorization|Employment History|Licensure)/);
  });
});

describe("a heading never stops a draft", () => {
  it("'Why do you want to work at Sono Bello?' whose description is a heading stays draft_from_your_cv", async () => {
    const body = JSON.stringify({ questions: [
      { label: "Why do you want to work at Sono Bello?", required: true, description: "<h2>Employment History</h2>", fields: [{ type: "textarea" }] },
      { label: "Tell us about your most recent role.", required: false, fields: [{ type: "textarea" }] },
    ] });
    const r = await readApplicationForm(REF, { fetch: serve(body).f, now: () => NOW });
    if (r.kind !== "read") throw new Error(r.kind);
    const [why, next] = whoAnswersEach(r.form.questions);
    expect(why.answeredBy).toBe("draft_from_your_cv");
    expect(why.hint).toBeUndefined();
    expect(next.section).toBe("Employment History");
  });
});

describe("the cache: a Greenhouse row from before sections is read again", () => {
  const row = (form: Record<string, unknown>, vendor = "greenhouse"): FormCacheRow => ({ vendor, ok: true, form, read_at: new Date(NOW - 3600_000).toISOString() });
  const OLD = { questions: [{ label: "If yes, please list the name(s)", required: false, type: "input_text", hint: "Work Authorization" }], documents: [], alsoOnForm: [] };

  it("an unmarked Greenhouse row is a miss: the form is read again and written back marked", async () => {
    const puts: unknown[][] = [];
    const cache: FormCache = { get: async () => row(OLD), put: async (...a) => { puts.push(a); } };
    const net = serve(FIXTURE);
    const r = await readApplicationForm(REF, { fetch: net.f, cache, now: () => NOW });
    expect(r).toMatchObject({ kind: "read", cached: false });
    expect(net.calls).toHaveLength(1);
    expect(puts).toHaveLength(1);
    expect(puts[0][3]).toMatchObject({ sectioned: true });
  });

  it("a marked Greenhouse row is believed with no fetch", async () => {
    const cache: FormCache = { get: async () => row({ ...OLD, sectioned: true }), put: async () => {} };
    const net = serve(FIXTURE);
    const r = await readApplicationForm(REF, { fetch: net.f, cache, now: () => NOW });
    expect(r).toMatchObject({ kind: "read", cached: true });
    expect(net.calls).toEqual([]);
  });

  it("another hiring system's unmarked row is still believed", async () => {
    const lever: PostingRef = { id: "lever:acme:0b1c2d3e-0000-4000-8000-000000000001", source: "lever", token: "acme", applyUrl: null };
    const cache: FormCache = { get: async () => row({ questions: [{ label: "Why us?", required: false, type: "textarea" }], documents: [], alsoOnForm: [] }, "lever"), put: async () => {} };
    const net = serve("{}");
    const r = await readApplicationForm(lever, { fetch: net.f, cache, now: () => NOW });
    expect(r).toMatchObject({ kind: "read", cached: true });
    expect(net.calls).toEqual([]);
  });
});
