/**
 * "HOW APPLYING WORKS HERE" PRINTS ONLY MEASURED FACTS.
 *
 * The block a reader sees beside the Apply button (design spec 3.6). Each
 * line is read from a list that is already the truth, and a line with no
 * measurement behind it is not printed:
 *   - the human-verification sentence follows the tier measured on 674 apply
 *     pages (2026-07-30); Workday's clean result is a non-measurement by the
 *     measurement's own note, and a sample under 10 pages is too thin;
 *   - "can submit" only on a vendor the agent sends on; "prepares" on the rest
 *     of the measured systems; nothing on USAJOBS or an unmeasured ATS;
 *   - screening questions only where the reader exists, the same set as
 *     REAL_QUESTION_PREFIXES;
 *   - the re-check only when the caller's Apply handler re-checks;
 *   - never a claim about accounts: we hold no data on it.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HowApplyingWorks } from "@/components/jobs/HowApplyingWorks";
import { applyMechanics, screeningQuestionVendors } from "@/lib/apply-mechanics";
import { REAL_QUESTION_PREFIXES } from "@/components/apply/ApplicationAnswers";
import { SENDABLE_VENDOR_KEYS } from "@/config/sendable-vendors";

const lines = () => [...document.querySelectorAll("[data-line]")].map((l) => l.getAttribute("data-line"));

describe("the facts, per hiring system", () => {
  // Pass B (2026-10-12): the server-side apply agent is retired (owner,
  // 2026-10-11), so the block prints NO agent line on any system. The mechanics
  // still measure what a vendor's form allowed; the component no longer says it.
  it("a CAPTCHA vendor: 'usually showed a human-verification step', questions read, and no agent line", () => {
    expect(applyMechanics("greenhouse")).toEqual({ systemKey: "greenhouse", tier: "click", captcha: "usually", agent: "prepares", readsScreeningQuestions: true });
    render(<HowApplyingWorks systemKey="greenhouse" systemLabel="Greenhouse" />);
    expect(screen.getByRole("heading", { name: "How applying works here" })).toBeTruthy();
    expect(screen.getByText("Applications go through Greenhouse.")).toBeTruthy();
    expect(screen.getByText(/In our check of 674 apply pages \(30 Jul 2026\), Greenhouse forms usually showed a human-verification step\./)).toBeTruthy();
    expect(lines()).toEqual(["through", "captcha", "questions"]);
    expect(document.body.textContent).not.toMatch(/Apply Agent|submits? applications/i);
  });

  it("a clean, well-sampled vendor: the sample is stated, and still no agent line", () => {
    expect(applyMechanics("breezy")).toMatchObject({ captcha: "none-in-sample", agent: "submits", readsScreeningQuestions: true });
    render(<HowApplyingWorks systemKey="breezy" systemLabel="Breezy" rechecksOnApply />);
    expect(screen.getByText(/Breezy forms showed no human-verification step in that sample/)).toBeTruthy();
    expect(screen.queryByText(/Apply Agent/)).toBeNull();
    expect(lines()).not.toContain("agent");
    // Only where the employer's system allows it (GD6/A3): a page-capped feed
    // and Workday answer the re-check as undecidable.
    expect(screen.getByText("Where the employer's system allows it, we re-check the posting is still live when you press Apply.")).toBeTruthy();
  });

  it("Workday's clean result is not stated: the measurement calls it a non-measurement", () => {
    expect(applyMechanics("workday").captcha).toBe("not-stated");
  });

  it("a thin sample (Pinpoint 5 pages, Personio 7) is not stated as clean", () => {
    expect(applyMechanics("pinpoint").captcha).toBe("not-stated");
    expect(applyMechanics("personio").captcha).toBe("not-stated");
  });

  it("USAJOBS and an unmeasured ATS get no tier and no agent line", () => {
    for (const k of ["usajobs", "paylocity", "ukg", "adp", "jazzhr"]) {
      expect(applyMechanics(k), k).toMatchObject({ tier: "unknown", captcha: "not-stated", agent: "none" });
    }
    render(<HowApplyingWorks systemKey="usajobs" systemLabel="USAJOBS" />);
    expect(lines()).toEqual(["through"]);
  });

  it("no system, no block", () => {
    const { container } = render(<HowApplyingWorks systemKey={null} systemLabel={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("the re-check line is printed only when the caller says its Apply re-checks", () => {
    render(<HowApplyingWorks systemKey="lever" systemLabel="Lever" />);
    expect(lines()).not.toContain("recheck");
  });

  it("never claims anything about accounts", () => {
    render(<HowApplyingWorks systemKey="workday" systemLabel="Workday" rechecksOnApply />);
    expect(document.body.textContent).not.toMatch(/account/i);
  });
});

describe("the lists stay one list", () => {
  it("the vendors whose questions are read are REAL_QUESTION_PREFIXES", () => {
    expect(screeningQuestionVendors()).toEqual([...REAL_QUESTION_PREFIXES].map((p) => p.replace(/:$/, "")).sort());
  });

  it("'can submit' is exactly the sendable list", () => {
    for (const k of SENDABLE_VENDOR_KEYS) expect(applyMechanics(k).agent, k).toBe("submits");
    expect(applyMechanics("greenhouse").agent).toBe("prepares");
  });
});
