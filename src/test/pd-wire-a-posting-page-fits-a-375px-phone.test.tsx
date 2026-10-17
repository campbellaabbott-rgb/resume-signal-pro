/**
 * A POSTING PAGE FITS A 375PX PHONE (S12-023).
 *
 * The S12 sweep measured every one of the 500 sitemap posting pages at 375px:
 * the "Score my résumé…" call to action was a nowrap button 388px wide, so
 * the document scrolled sideways (scrollWidth 404 against a 375px viewport)
 * and the header's Start button sat off-screen. Since the design upgrade the
 * posting page renders the listing vocabulary's PostingDetail, whose decision
 * row (PostingActions) wraps every control: no control on it may carry
 * `whitespace-nowrap`, every one is capped at its container's width, and the
 * row itself wraps.
 *
 * jsdom lays nothing out, so the width claim is pinned at the class level
 * against the one Button component every control is built from (whose plain
 * form IS nowrap: the teeth below show it), and the headless measurement on a
 * built page is reported in the pass B result (document.scrollWidth at 375).
 */
import { describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Button } from "@/components/ui/button";
import { PostingActions } from "@/components/jobs/listing/PostingActions";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const LONG_EMPLOYER = "Northwestern Memorial Healthcare Corporation of Greater Chicagoland";
const classes = (el: Element) => el.className.split(/\s+/);

function mountRow(variant: "full" | "short") {
  return render(
    <MemoryRouter>
      <PostingActions
        variant={variant}
        employer={LONG_EMPLOYER}
        applyUrl="https://jobs.example.com/apply/12345"
        onApply={() => {}}
        onCheckFit={() => {}}
        onToggleSave={() => {}}
        title="Senior Staff Accountant, Revenue Cycle Operations"
      />
    </MemoryRouter>,
  );
}

describe("the posting's decision row never widens a phone", () => {
  for (const variant of ["full", "short"] as const) {
    it(`${variant}: every control wraps its label and is capped at the row's width`, () => {
      const { container } = mountRow(variant);
      const row = container.querySelector(`[data-posting-actions="${variant}"]`) as HTMLElement;
      expect(row, "the decision row is missing").not.toBeNull();
      expect(classes(row), "the row itself wraps").toContain("flex-wrap");
      const apply = within(row).getByRole("link", { name: /Apply on/ });
      const fit = within(row).getByRole("button", { name: /Check my fit, free/ });
      for (const el of [apply, fit]) {
        const cls = classes(el);
        expect(cls, `${(el.textContent ?? "").trim()} is nowrap`).not.toContain("whitespace-nowrap");
        expect(cls, `${(el.textContent ?? "").trim()} does not wrap`).toContain("whitespace-normal");
        expect(cls.some((c) => c === "max-w-full" || c === "w-full"), `${(el.textContent ?? "").trim()} can outgrow its container`).toBe(true);
      }
      // The Save control is an icon, never a label that could grow.
      expect(classes(within(row).getByRole("button", { name: /^Save / })), "Save grew a label").toContain("shrink-0");
      cleanup();
    });
  }

  it("TEETH: the plain Button IS nowrap, so the assertion above is not satisfied by default", () => {
    const { container } = render(<Button>{LONG_EMPLOYER}</Button>);
    const cls = classes(container.querySelector("button")!);
    expect(cls).toContain("whitespace-nowrap");
    expect(cls).not.toContain("whitespace-normal");
    cleanup();
  });

  it("the posting page renders the listing detail (its row above) and carries no nowrap call to action of its own", () => {
    const page = codeOf(readFileSync(resolve(ROOT, "src/pages/JobPosting.tsx"), "utf8"));
    expect(page).toMatch(/<PostingDetail\b/);
    expect(page).toMatch(/surface="page"/);
    expect(page, "a nowrap control came back to the posting page").not.toMatch(/whitespace-nowrap/);
    const detail = codeOf(readFileSync(resolve(ROOT, "src/components/jobs/listing/PostingDetail.tsx"), "utf8"));
    expect(detail).not.toMatch(/whitespace-nowrap/);
    const actions = codeOf(readFileSync(resolve(ROOT, "src/components/jobs/listing/PostingActions.tsx"), "utf8"));
    expect(actions).not.toMatch(/whitespace-nowrap/);
  });
});
