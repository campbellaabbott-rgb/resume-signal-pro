/**
 * Sweep S11-040. apply-agent read only `data` from generate-application-
 * answers. A 429/402/502/500 (data null), a 200 with [] because the model's
 * JSON did not parse, or a model that echoed a label in another case all
 * became drafted = [], and buildPacket made every required screening question
 * "nothing in your résumé supports an answer" — permanently, because the queue
 * never prepares a row that already has a packet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_DRAFT_NOTE, readDraftReply, sameQuestion, toAskedLabels } from "../../supabase/functions/_shared/draft-reply";
import { buildPacket } from "../../supabase/functions/_shared/submission-packet";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ASKED = [{ label: "Why do you want this role?", required: true, fieldType: "textarea" }];
const packetFrom = (drafted: Parameters<typeof buildPacket>[0]["drafted"]) => buildPacket({
  questions: [{ label: "Full name", required: true }, ...ASKED],
  profile: { fullName: "Ana Diaz" }, standing: {}, drafted, automationTier: "auto",
});

describe("a failed drafting call is a failure, not an empty answer", () => {
  it.each([
    ["a non-2xx answer (429, 402, 502, 500)", { data: null, error: { message: "Edge Function returned a non-2xx status code" } }],
    ["an error body with no answers list", { data: { error: "Busy — try again shortly." }, error: null }],
    ["nothing at all", { data: null, error: null }],
  ])("%s: no packet is built from it", (_name, reply) => {
    expect(readDraftReply(reply, ASKED)).toMatchObject({ ok: false });
  });

  it("apply-agent leaves the posting for the next run instead of inserting a packet", () => {
    const agent = read("supabase/functions/apply-agent/index.ts");
    const branch = agent.slice(agent.indexOf("const read = readDraftReply(reply, needsDraft);"));
    expect(branch).toMatch(/^const read = readDraftReply\(reply, needsDraft\);\s*if \(!read\.ok\) \{[\s\S]{0,300}?continue;\s*\}\s*drafted = read\.drafted;/);
    // ...and that `continue` comes before the insert of the packet.
    expect(branch.indexOf("continue;")).toBeLessThan(branch.indexOf('from("agent_submissions").insert('));
  });

  it("a reply that is not the JSON asked for answers 502, not 200 with no answers", () => {
    // Since S12-148 the questions are drafted in chunks: a chunk whose reply is
    // not the JSON asked for is a failed chunk, and when no chunk answered the
    // call is a 502. The handler is run end to end on this in
    // w4b-every-screening-answer-is-checked-and-a-long-form-is-answered-in-full.
    const fn = read("supabase/functions/generate-application-answers/index.ts");
    expect(fn).toMatch(/if \(!parsed \|\| !Array\.isArray\(parsed\.answers\)\) \{[\s\S]{0,200}return \{ batch, status: 502, answers: null \};/);
    expect(fn).toMatch(/if \(good\.length === 0\) \{[\s\S]{0,700}return json\(\{ error: "Couldn't draft answers right now\.", code: "draft_failed", retryable: true \}, 502\);/);
  });
});

describe("the model's echo is matched the way the packet matches labels", () => {
  it("case, spacing and a list number do not lose a grounded draft", () => {
    for (const echo of ["why do you want THIS role?", "  Why do you   want this role? ", "1. Why do you want this role?"]) {
      const r = readDraftReply({ data: { answers: [{ question: echo, answer: "Because I ran the same programme.", supported: true }] } }, ASKED);
      expect(r.ok).toBe(true);
      const p = packetFrom(r.ok ? r.drafted : []);
      expect(p.fields.find((f) => f.key === ASKED[0].label)).toMatchObject({ source: "drafted" });
      expect(p.ready).toBe(true);
    }
  });

  it("generate-application-answers renames each echo to the label asked, verbatim", () => {
    expect(toAskedLabels([{ question: "1. why do you want this role?" }], [ASKED[0].label]))
      .toEqual([{ question: ASKED[0].label }]);
    expect(sameQuestion("Q2) Are You Willing To Travel?")).toBe("are you willing to travel?");
    expect(read("supabase/functions/generate-application-answers/index.ts"))
      .toMatch(/const echoed = inferred \? raw : toAskedLabels\(raw, \[\.\.\.draftLabels\]\);/);
  });
});

describe("a question the reply left out does not blame the résumé", () => {
  it("it blocks with what happened, never 'nothing in your résumé supports an answer'", () => {
    const r = readDraftReply({ data: { answers: [] } }, ASKED);
    expect(r.ok).toBe(true);
    const p = packetFrom(r.ok ? r.drafted : []);
    expect(p.ready).toBe(false);
    const detail = p.blockers.map((b) => b.detail).join(" ");
    expect(detail).toContain(NO_DRAFT_NOTE);
    expect(detail).not.toMatch(/nothing in your résumé supports/);
  });

  it("an unsupported draft keeps the model's own note", () => {
    const r = readDraftReply({ data: { answers: [{ question: ASKED[0].label, answer: "I…", supported: false, note: "Add why this team." }] } }, ASKED);
    const p = packetFrom(r.ok ? r.drafted : []);
    expect(p.blockers.map((b) => b.detail).join(" ")).toContain("Add why this team.");
  });
});
