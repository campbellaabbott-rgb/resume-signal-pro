/**
 * THE FOOTER LINKS NO PRODUCT THE OWNER CUT (owner decision 6 of 2026-10-17;
 * switch-over README, step 9; precondition W4).
 *
 * Freelance Boost and Transition Pro are no longer sold, and /freelance-boost
 * says so to a past buyer. But the shared footer still listed "Freelance
 * Boost" among its resources on every page (design's footer by locale key,
 * footer.links.freelanceBoost; wave 4's older footer by a typed literal), so
 * the board-first homepage and the new pricing page would have named a cut
 * product at the bottom of every screen. The link and its key are gone in all
 * nine languages; the retirement page itself stays reachable by its address.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Footer } from "@/components/Footer";

afterEach(cleanup);

const ROOT = resolve(__dirname, "../..");
const LOCALES = resolve(ROOT, "src/i18n/locales");

describe("the footer", () => {
  it("renders no link to a cut product", () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(container.querySelector('a[href="/freelance-boost"]')).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/Freelance Boost|Transition Pro/);
    // The rest of the resources list is still there.
    expect(container.querySelector('a[href="/resume-checker"]')).not.toBeNull();
    expect(container.querySelector('a[href="/builder"]')).not.toBeNull();
  });

  it("its source names neither the address nor the product", () => {
    const code = readFileSync(resolve(ROOT, "src/components/Footer.tsx"), "utf8");
    expect(code).not.toMatch(/\/freelance-boost|Freelance Boost|footer\.links\.freelanceBoost/);
  });

  it("no language carries the footer's Freelance Boost label", () => {
    const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const links = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).footer?.links ?? {}) as Record<string, string>;
      expect(Object.keys(links), `${f} footer.links`).not.toContain("freelanceBoost");
      expect(Object.keys(links).length, `${f} keeps its other footer links`).toBeGreaterThan(10);
    }
  });
});
