import { describe, expect, it } from "vitest";
import { resumeRoleTerms } from "../../supabase/functions/_shared/fit-score";

/**
 * A FOUNDER'S RÉSUMÉ SEARCHED THE BOARD FOR "GO-TO-MARKET".
 *
 * Reported 2026-09-03 as "I tried this feature and it didn't work". The drop
 * itself was healthy — reproduced end to end in a real browser with a software
 * engineer's CV — so the failure was in what fit-terms read out of THIS
 * résumé. Probed: every CV mentioning go-to-market got it as the FIRST term,
 * ahead of the real title even on the engineer control, and for a Founder &
 * CEO or a Chief of Staff it was the ONLY term. The client searches terms[0].
 * The board ran q=go-to-market — a strategy phrase that names no job — and
 * fit-ranked whatever came back. To the reader, nothing happened.
 *
 * Three things were true at once and each is pinned below: the sales titles
 * list carried "gtm"/"go-to-market" as occupations; uncapped repetition let
 * three bullets outscore one headline; and the scanner knew no executive
 * titles, so a founder's headline resolved to nothing and a stray skill won.
 * These are behavioural tests — they import the scanner and run it — because
 * the last time this path was pinned by source text alone it shipped broken.
 */
const pad = "\nEXPERIENCE\n" +
  "Led cross-functional teams, owned the roadmap and P&L, ran go-to-market, hired and managed staff.\n" +
  "Built the go-to-market motion from zero; go-to-market strategy across three launches.\n" +
  "SKILLS: leadership, strategy, hiring, fundraising, analytics, SQL, Excel\nBS, University of Washington 2012";

describe("a founder's résumé searched for go-to-market", () => {
  it("a Founder & CEO resolves to a job, never to a strategy phrase", () => {
    const t = resumeRoleTerms("Campbell Abbott — Founder & CEO, Resume Booster, Seattle WA" + pad);
    expect(t.length, "an executive résumé must resolve to SOMETHING now").toBeGreaterThan(0);
    expect(["founder", "ceo", "chief executive officer"]).toContain(t[0]);
    expect(t, "go-to-market is an activity, not an occupation").not.toContain("go-to-market");
    expect(t).not.toContain("gtm");
  });

  it("a Chief of Staff resolves to Chief of Staff", () => {
    expect(resumeRoleTerms("Jane Doe — Chief of Staff, Acme Corp" + pad)[0]).toBe("chief of staff");
  });

  it("the headline beats a phrase repeated three times in the body", () => {
    // Before the cap, go-to-market x3 (25) outscored software engineer x1 (24)
    // and the bullets became the search.
    const t = resumeRoleTerms("Jane Doe — Senior Software Engineer, Acme" + pad);
    expect(t[0]).toBe("software engineer");
  });

  it("a résumé whose only hit WAS go-to-market now returns nothing — the honest fallback", () => {
    // No occupation the scanner knows, and no buzzword to fake one: the client
    // then ranks what is on screen and SAYS so, instead of searching garbage.
    const t = resumeRoleTerms("Jane Doe — Acme Corp, Seattle" + pad);
    expect(t).not.toContain("go-to-market");
    expect(t).toEqual([]);
  });

  it("the board's own common titles resolve — found by harvest, not by report", () => {
    // scripts/role-vocab-gaps.ts, 2026-09-03: 57% of newest headlines did not
    // resolve, led by retail, grocery and branch-banking roles the industry
    // dictionary never carried. A user report found the founder gap; this
    // finds the rest from the board itself.
    for (const [title, expect0] of [
      ["Deli Clerk", "deli clerk"], ["Relationship Banker", "relationship banker"],
      ["Store Driver", "store driver"], ["Leasing Professional", "leasing professional"],
      ["Retail Parts Pro", "retail parts pro"], ["Mechanical Technician", "mechanical technician"],
    ] as const) {
      const t = resumeRoleTerms(`Jane Doe — ${title}, Acme Corp` + pad);
      expect(t[0], `${title} should resolve to its own occupation`).toBe(expect0);
    }
  });

  it("an executive title in the BODY does not hijack the query", () => {
    // Bare-word titles count only in the headline window — the first 400
    // characters or 20% of the text, whichever is larger. The first draft of
    // this fixture was 350 characters long, so the whole résumé WAS the
    // headline and "ceo" qualified honestly. The body here is pushed well past
    // the window so the rule is actually exercised: the executive mentions sit
    // in bullets the reader did not lead with.
    const filler = "Designed and shipped payment services in TypeScript and Go with strong observability and on-call ownership. ".repeat(6);
    const t = resumeRoleTerms("Jane Doe — Senior Software Engineer, Acme\nEXPERIENCE\n" + filler +
      "Reported directly to the CEO and the CTO on platform strategy.\n".repeat(3) +
      "SKILLS: TypeScript, Go, Kubernetes, AWS\nBS Computer Science 2018");
    expect(t[0], "the query the client runs is the headline role").toBe("software engineer");
    expect(t, "a bare-word executive title outside the headline is not a term").not.toContain("ceo");
    expect(t).not.toContain("cto");
  });
});
