/**
 * A SCREENING ANSWER KEY NEVER LEAVES THE READER (connect W5, APPLY-1107-01).
 *
 * Paylocity's apply page carries its screener with the employer's scoring
 * beside every answer: isCorrect, isGraded, targetScore, and isAutoReject on
 * the answers that end an application. Handing any of that to the person's
 * AI would hand it the passing answer, which rule 8 forbids ("never suggest
 * an answer chosen to get past a screening question").
 *
 * The reader keeps only each answer's title. A question with an
 * auto-rejecting answer says, in the owner's words (decision 2026-11-07),
 * "the employer screens applications on this answer", and never which
 * answer: the JSON carries screens: true and nothing else.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readApplicationForm } from "../../supabase/functions/_shared/application-form";
import { parsePaylocityForm } from "../../supabase/functions/_shared/form-readers-extra";
import { applyMyselfAnswer, applyMyselfMarkdown } from "../../supabase/functions/agent-mcp/apply-myself";
import { formBlock } from "../../supabase/functions/public-api/application";

const PAGE = readFileSync(resolve(__dirname, "fixtures/forms/paylocity-4344747.html"), "utf8");
const REF = { id: "paylocity:c3b88991-c035-4553-a749-c4ed739f2faa:4344747", source: "paylocity", token: "c3b88991-c035-4553-a749-c4ed739f2faa", applyUrl: "https://recruiting.paylocity.com/recruiting/jobs/Details/4344747" };
const URL_ = "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4344747";
/** Any scoring key, as a JSON key: the employer's own names, and any spelling a later reader might copy. */
const KEY_FIELDS = /"(?:isCorrect|isGraded|targetScore|isAutoReject|autoReject|score|points|weight|correct)"\s*:/i;

const readIt = async () => {
  const f = (async (u: string) => (String(u) === URL_ ? new Response(PAGE, { status: 200 }) : new Response("", { status: 404 }))) as typeof fetch;
  const r = await readApplicationForm(REF, { fetch: f });
  if (r.kind !== "read") throw new Error(r.kind);
  return r;
};

describe("the recorded page does carry a key", () => {
  it("isCorrect, isAutoReject and targetScore are in the employer's page", () => {
    expect(PAGE).toMatch(/"isCorrect"/);
    expect(PAGE).toMatch(/"isAutoReject":true/);
    expect(PAGE).toMatch(/"targetScore"/);
  });
});

describe("none of it leaves the reader", () => {
  it("the parsed form has no scoring field anywhere", () => {
    const parsed = parsePaylocityForm(PAGE)!;
    expect(JSON.stringify(parsed)).not.toMatch(KEY_FIELDS);
  });

  it("the read, the connector's answer, its packet and /v1's form block carry no scoring field", async () => {
    const r = await readIt();
    const posting = { id: REF.id, title: "Server", company: "Acme", location: "Naples, FL", pay: null, postedAt: null, applyUrl: REF.applyUrl, siteUrl: `https://resumebooster.work/jobs?job=${REF.id}` };
    const answer = applyMyselfAnswer(posting, r, []);
    const surfaces = [JSON.stringify(r), JSON.stringify(answer), applyMyselfMarkdown(answer), JSON.stringify(formBlock(r))];
    for (const s of surfaces) expect(s).not.toMatch(/isCorrect|isGraded|targetScore|isAutoReject/);
  });

  it("a screening question says the employer screens on it, and never which answer", async () => {
    const r = await readIt();
    const screened = r.form.questions.filter((q) => q.screens);
    expect(screened).toHaveLength(3);
    for (const q of screened) {
      expect(Object.keys(q).sort()).toEqual(["label", "options", "required", "screens", "type"]);
      expect(q.options).toEqual(["Yes", "No"]);
    }
    const posting = { id: REF.id, title: "Server", company: "Acme", location: null, pay: null, postedAt: null, applyUrl: REF.applyUrl, siteUrl: "https://resumebooster.work/jobs" };
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting, r, []));
    const lines = md.split("\n").filter((l) => /screens applications on this answer/.test(l));
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).not.toMatch(/\b(?:yes|no)\b.*(?:pass|correct|reject|right|wrong)/i);
    expect(md).not.toMatch(/correct answer|passing answer|auto-?reject/i);
  });
});
