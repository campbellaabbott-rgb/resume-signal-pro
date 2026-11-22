/**
 * A HEADING IS NOT FLAGGED BECAUSE A WEAK BULLET CONTAINS ITS WORD (register
 * S10-149).
 *
 * The X-Ray underlines each résumé line the scan called weak, matching the
 * scan's snippet to the line both ways round: the line held the snippet, or
 * the snippet held the line. The second way flagged any short line that a
 * weak bullet happens to contain: a heading ("Project management"), a skill,
 * a job title. A line is now flagged only when it holds the snippet; the
 * scan's snippets are whole lines (or a line's first 80 characters), so a
 * weak bullet still finds its own line.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ResumeXRay, lineMatches } from "@/components/ResumeXRay";

afterEach(() => cleanup());

const WEAK = "Responsible for project management across three regional offices";

describe("which line a weak snippet marks", () => {
  it("a heading the snippet contains is not the snippet's line", () => {
    expect(lineMatches("PROJECT MANAGEMENT", WEAK)).toBe(false);
    expect(lineMatches("Regional offices and project management", WEAK)).toBe(false);
  });

  it("the bullet itself, with its dash and its full stop, is", () => {
    expect(lineMatches(`- ${WEAK}.`, WEAK)).toBe(true);
    // The backup scanner sends a line's first 80 characters.
    expect(lineMatches(`• ${WEAK} and the head office in Leeds, reporting to the COO`, WEAK.slice(0, 80))).toBe(true);
  });

  it("a snippet too short to tell lines apart marks nothing", () => {
    expect(lineMatches("Project manager", "Project")).toBe(false);
  });
});

describe("on the X-Ray", () => {
  it("underlines the bullet and leaves the heading above it alone", () => {
    const resumeText = ["Jordan Probe", "Project management", `- ${WEAK}`, "- Cut vendor spend by 18 percent in 2024"].join("\n");
    const { container } = render(
      createElement(TooltipProvider, null,
        createElement(ResumeXRay, { resumeText, weakBullets: [{ text: WEAK, reason: "starts with a duty" }] })),
    );
    const underlined = [...container.querySelectorAll(".decoration-wavy")].map((el) => el.textContent?.trim());
    expect(underlined).toEqual([`- ${WEAK}`]);
  });
});
