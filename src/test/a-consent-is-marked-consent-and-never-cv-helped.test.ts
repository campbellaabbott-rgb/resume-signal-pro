/**
 * A CONSENT IS MARKED CONSENT, AND NEVER CV-HELPED (connect W4, APPLY-1107-11).
 *
 * Rule (2) tells the person's AI never to tick a consent box for them. The
 * classifier already knew a consent when it saw one, but the answer carried
 * no marker for it, and an SMS opt-in or a data-retention question worded as
 * a sentence came out cvMayHelp:true, as if the CV could answer it. So the
 * rule depended on the AI noticing the consent itself. "How did you hear
 * about us" carried cvMayHelp too.
 *
 * Now a consent, an attestation or an opt-in carries topic "consent" and
 * never cvMayHelp, and a how-heard question carries topic
 * "how_you_found_us" and never cvMayHelp. Read on the real labels of
 * src/test/fixtures/form-labels-2026-11.json, and on the packet the person
 * sees.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { whoAnswers, whoAnswersEach } from "../../supabase/functions/_shared/self-apply";
import { applyMyselfAnswer, applyMyselfMarkdown } from "../../supabase/functions/agent-mcp/apply-myself";

type Row = { vendor: string; label: string; type: string; required: boolean; options?: string[]; hint?: string };
const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/form-labels-2026-11.json"), "utf8")) as { rows: Row[] };
const find = (re: RegExp) => {
  const r = CORPUS.rows.find((x) => re.test(x.label));
  if (!r) throw new Error(`no corpus label matches ${re}`);
  return whoAnswers({ label: r.label, required: r.required, type: r.type, ...(r.options ? { options: r.options } : {}) }, 1);
};

describe("consents, attestations and opt-ins are marked consent", () => {
  it.each([
    ["an SMS opt-in on a Greenhouse form", /^Effective School Solutions uses text messaging/],
    ["Paylocity's SMS permission", /^We may use SMS during the hiring process/],
    ["a Dutch data-retention question", /^De door jouw aangereikte gegevens worden gebruikt/],
    ["a certification of accuracy", /^By clicking Yes, I hereby certify/],
    ["a privacy-notice acknowledgement", /^Capco Job Candidate Privacy Notice Acknowledgement/],
    ["a BambooHR certification box", /^I hereby certify that the facts contained in this application/],
  ])("%s is the person's, topic consent, with no CV hint", (_what, re) => {
    const q = find(re);
    expect(q.answeredBy).toBe("you");
    expect(q.topic).toBe("consent");
    expect(q.cvMayHelp).toBeUndefined();
  });

  it("every corpus label the classifier reads as a consent carries the marker and no CV hint", () => {
    const consents = CORPUS.rows
      .map((r) => whoAnswers({ label: r.label, required: r.required, type: r.type, ...(r.options ? { options: r.options } : {}) }, 1))
      .filter((q) => q.topic === "consent");
    expect(consents.length).toBeGreaterThanOrEqual(15);
    for (const q of consents) {
      expect(q.answeredBy, q.label).toBe("you");
      expect(q.cvMayHelp, q.label).toBeUndefined();
    }
  });
});

describe("how the person heard about the job is theirs, with no CV hint", () => {
  it.each([
    /^Where did you hear about us\?/,
    /^Wie sind Sie auf uns aufmerksam geworden\?/,
    /^Hoe ben je op deze vacature terecht gekomen\?/,
    /^¿Cómo te enteraste de nuestra vacante\?/,
  ])("%s", (re) => {
    const q = find(re);
    expect(q.answeredBy).toBe("you");
    expect(q.topic).toBe("how_you_found_us");
    expect(q.cvMayHelp).toBeUndefined();
  });
});

describe("the packet says so", () => {
  it("a consent question prints 'about: consent' and never 'your CV may help you answer'", () => {
    const questions = [{ label: "We may use SMS during the hiring process. Do you give us permission to text you?", required: true, type: "boolean", options: ["Yes", "No"] }];
    const posting = { id: "paylocity:t:1", title: "Clerk", company: "Acme", location: null, pay: null, postedAt: null, applyUrl: "https://recruiting.paylocity.com/Recruiting/Jobs/Details/1", siteUrl: "https://resumebooster.work/jobs?job=paylocity:t:1" };
    const md = applyMyselfMarkdown(applyMyselfAnswer(posting, { kind: "read", vendor: "paylocity", readAt: "2026-11-08T00:00:00Z", cached: false, form: { questions, documents: [], alsoOnForm: [] } }, []));
    const block = md.slice(md.indexOf("We may use SMS"));
    expect(block).toMatch(/about: consent/);
    expect(block.split("\n## ")[0]).not.toMatch(/your CV may help/);
    expect(whoAnswersEach(questions)[0].topic).toBe("consent");
  });
});
