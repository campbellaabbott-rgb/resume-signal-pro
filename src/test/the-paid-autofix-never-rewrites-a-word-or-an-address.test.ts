/**
 * THE PAID AUTO-FIX NEVER REWRITES A WORD OR AN ADDRESS (register L5-03).
 *
 * The Premium Package's "auto-fix" ran on the paid résumé and cover letter
 * (server: generate-premium-package; browser: the streamed copy on the
 * success page) and corrupted them: every "Git" became "GitHub", every
 * "linked" became "LinkedIn", a space went into every email and profile URL
 * with digits in it, and the browser copy then split camel-case words
 * ("Git. Hub", "Linked. In"). Both copies are run here on the sentences that
 * broke, and on the corrections that were worth keeping.
 */
import { describe, expect, it } from "vitest";
import { autoFixContent as clientFix } from "@/lib/content-autofix";
import { autoFixContent as serverFix, validateContent } from "../../supabase/functions/generate-premium-package/auto-fix";

const SOURCE = `Jane Smith | jsmith1987@gmail.com | linkedin.com/in/janesmith1990 | github.com/jsmith2020
SKILLS: Git, Docker, JavaScript, PowerPoint, SQL
- Owned quarterly OKRs closely linked to retention goals
- Shipped the iOS app with GitHub Actions CI/CD`;

const DRAFT = `Jane Smith | jsmith1987@gmail.com | linkedin.com/in/janesmith1990 | github.com/jsmith2020
SKILLS: Git, Docker, JavaScript, PowerPoint, SQL
- Owned quarterly OKRs closely linked to retention goals; apply the same rigour to forecasting
- Finished top 3 of 40 reps for a year over the target
- Shipped the iOS app with GitHub Actions CI/CD`;

const FIXERS: Array<[string, (c: string, o?: string) => { fixed: string }]> = [
  ["server", (c, o) => serverFix(c, o ?? "")],
  ["browser", (c, o) => clientFix(c, o)],
];

describe.each(FIXERS)("the %s auto-fix", (_name, fix) => {
  it("leaves a correct draft exactly as written", () => {
    expect(fix(DRAFT, SOURCE).fixed).toBe(DRAFT);
  });

  it("never claims a skill: Git stays Git, linked stays linked", () => {
    const out = fix("Skills: Git, SQL. Hiring plans closely linked to revenue.", SOURCE).fixed;
    expect(out).toContain("Skills: Git, SQL.");
    expect(out).toContain("closely linked to revenue");
    expect(out).not.toMatch(/GitHub|LinkedIn/);
  });

  it("never touches an email or a profile URL", () => {
    const line = "jsmith1987@gmail.com | github.com/jsmith2020 | https://www.linkedin.com/in/janesmith1990";
    expect(fix(line, SOURCE).fixed).toBe(line);
  });

  it("still repairs real corruption", () => {
    expect(fix("Managed a $20,,000 budget,, on time", SOURCE).fixed).toContain("$20,000 budget, on time");
    expect(fix("Grew revenue 40%+ year on year", SOURCE).fixed).toContain("40% year");
  });
});

describe("the browser copy's own rules", () => {
  it("no longer splits camel-case words into sentences", () => {
    const out = clientFix("Built dashboards in PowerPoint and JavaScript; shipped on GitHub; posted on LinkedIn.").fixed;
    expect(out).toBe("Built dashboards in PowerPoint and JavaScript; shipped on GitHub; posted on LinkedIn.");
  });

  it("restores a truncated year only where a year belongs", () => {
    const src = "Acme Corp, Jan 2019 - Present. Grew the team to 201 people.";
    expect(clientFix("Acme Corp, Jan 201 - Present", src).fixed).toBe("Acme Corp, Jan 2019 - Present");
    expect(clientFix("Grew the team to 201 people.", src).fixed).toBe("Grew the team to 201 people.");
  });
});

describe("the server's issue report", () => {
  it("does not flag an address with digits, or a correct 'Git', as corruption", () => {
    const { issues } = validateContent(DRAFT, SOURCE);
    expect(issues.join(" | ")).not.toMatch(/missing space|truncated GitHub|truncated LinkedIn/i);
  });
});
