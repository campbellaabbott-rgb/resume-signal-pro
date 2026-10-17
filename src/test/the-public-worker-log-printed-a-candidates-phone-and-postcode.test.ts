/**
 * Sweep S11-046. The worker runs on GitHub Actions in a public repository.
 * The L12-09 scrub replaced URLs and the quoted text after `page said:`, and
 * still printed candidates' details two ways:
 *
 *  - answer.ts's refusal for a control that would not keep its value quoted
 *    the read-back ("field kept <value>"), and apply.ts wrapped that reason
 *    and index.ts logged it whole;
 *  - a page excerpt with a double quote inside it ended the `page said: "…"`
 *    match early, and the rest of the excerpt printed.
 *
 * A reason now prints as its stage from refusal.ts's closed list, and the
 * read-back is no longer in the reason at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicReason, publicText } from "../../worker/src/public-log.js";
import { applyResolution } from "../../worker/src/questions/answer.js";

type Page = Parameters<typeof applyResolution>[0];

const EMAIL = "jane.doe@example.com";
const PHONE = "07700 900123";
const POSTCODE = "LS1 4AP";
const SALARY = "£52,500";

describe("an uncertain submit's page excerpt is not printed", () => {
  it("an excerpt with an inner double quote prints none of the candidate's details", () => {
    const reason =
      `no confirmation recognised after submit — url: https://acme.breezy.hr/p/1/apply — page said: ` +
      `"Review: Name "Jane Doe" Email ${EMAIL} Phone ${PHONE} Postcode ${POSTCODE} Salary ${SALARY}"`;
    const line = publicReason(reason, false);
    for (const v of [EMAIL, PHONE, POSTCODE, SALARY, "Jane Doe", "acme.breezy.hr"]) expect(line).not.toContain(v);
    expect(line).toBe("stage submit-uncertain");
  });

  it("the XHR-submit uncertain reason reads as an uncertain submit too", () => {
    expect(publicReason("submit sent 1 request(s) (status 200) and the form is still showing — outcome unknown, not retrying", false))
      .toBe("stage submit-uncertain");
  });

  it("an operator who asks for verbose logs still gets the sentence", () => {
    expect(publicReason(`page said: "${EMAIL}"`, true)).toContain(EMAIL);
  });
});

describe("a control that would not keep its answer does not quote what it kept", () => {
  // A masked phone box that keeps only part of what was typed.
  const page = {
    locator: () => {
      let value = "";
      const one = {
        first: () => one, nth: () => one,
        isVisible: async () => true,
        fill: async (v: string) => { value = v.slice(0, 7); },
        inputValue: async () => value,
      };
      return one;
    },
  } as unknown as Page;

  it("the refusal names the failure, not the value", async () => {
    const r = await applyResolution(page, { name: "phone", type: "text", required: true, label: "Phone", options: [] },
      { kind: "fill", category: "phone", value: PHONE });
    expect(r.ok).toBe(false);
    const why = "why" in r ? r.why : "";
    expect(why).not.toContain(PHONE.slice(0, 7));
    // The sentence apply.ts builds from it, as the log prints it.
    const line = publicReason(`could not answer "Phone": ${why}`, false);
    expect(line).toBe("stage control-refused");
  });
});

describe("other free text goes through the public scrubber", () => {
  it("a broker error or an exception loses its address, phone and URL", () => {
    const text = publicText(`500 {"error":"duplicate for ${EMAIL} ${PHONE} at https://x.supabase.co/rest"}`, false);
    for (const v of [EMAIL, PHONE, "supabase.co"]) expect(text).not.toContain(v);
  });

  it("the worker prints every reason through the stage-only reading", () => {
    const src = readFileSync(join(process.cwd(), "worker/src/index.ts"), "utf8");
    expect(src).toMatch(/const scrub = \(reason: string\): string => publicReason\(reason, VERBOSE_LOGS\);/);
    const printed = src.split("\n").filter((l) => /console\.(?:log|warn|error)\(/.test(l));
    expect(printed.length).toBeGreaterThan(10);
    for (const l of printed) expect(l).not.toMatch(/(?<!quiet\()\b\w+\.detail\b|(?<!quiet\()String\(e\)|\$\{outcome\.reason\}/);
  });
});
