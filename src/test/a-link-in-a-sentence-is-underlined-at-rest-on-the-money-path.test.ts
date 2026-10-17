/**
 * A LINK IN A SENTENCE IS UNDERLINED AT REST ON THE MONEY PATH (WCAG 1.4.1).
 *
 * axe link-in-text-block on /pricing (1280 and 375, both themes, all nine
 * locales; review of 3ebdcbb2): "Connect your agent" and "free scan" were
 * `text-primary hover:underline`, marked by colour alone at 1.08:1 against
 * the body text in dark. The design system has an underlined-at-rest `.link`
 * class (src/index.css); the money path's in-text links use it, or an
 * explicit resting underline. The home page's two "benchmark study" links
 * (LiveScanStats) had the same pattern and are held too; so is the board
 * pane's employer link, which sits in a sentence in Jobs.tsx.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const FILES = ["src/pages/Pricing.tsx", "src/pages/JobPosting.tsx", "src/components/jobs/listing/MoreRolesAtEmployer.tsx", "src/components/LiveScanStats.tsx"];

/** Link classNames whose only link cue is colour: a primary colour, an underline only on hover. */
export function colourOnlyLinks(src: string): string[] {
  const out: string[] = [];
  for (const m of codeOf(src).matchAll(/<(?:Link|a)\b[^>]*?className="([^"]*)"/g)) {
    const cls = m[1].split(/\s+/);
    const underlinedAtRest = cls.includes("link") || cls.includes("underline");
    if (cls.includes("text-primary") && cls.includes("hover:underline") && !underlinedAtRest) out.push(m[1]);
  }
  return out;
}

describe("in-text links carry more than colour", () => {
  it.each(FILES)("%s", (f) => {
    expect(colourOnlyLinks(readFileSync(resolve(ROOT, f), "utf8"))).toEqual([]);
  });

  it("the board pane's employer link is underlined at rest", () => {
    // Since pass B (2026-10-12) the pane is the listing vocabulary's
    // PostingDetail, whose PostingHeader prints the employer link; the board
    // mounts it and hands it the employer click.
    const jobs = codeOf(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
    expect(jobs, "the board no longer mounts the shared pane").toMatch(/<PostingDetail\b[\s\S]*?onEmployerClick=\{\(e, href\) => leavePanelFor\(e, href\)\}/);
    const header = codeOf(readFileSync(resolve(ROOT, "src/components/jobs/listing/PostingHeader.tsx"), "utf8"));
    const pane = /<Link\s+to=\{href\}\s+className="([^"]*)"/.exec(header);
    expect(pane, "the pane's employer link moved: re-point this guard").not.toBeNull();
    expect(pane![1].split(/\s+/)).toContain("underline");
    expect(colourOnlyLinks(header), "the header's links carry more than colour").toEqual([]);
  });

  it("the rule catches what it names", () => {
    expect(colourOnlyLinks('<Link to="/" className="text-primary hover:underline">x</Link>')).toHaveLength(1);
    expect(colourOnlyLinks('<Link to="/" className="link">x</Link>')).toHaveLength(0);
    expect(colourOnlyLinks('<a href="/" className="text-primary underline hover:decoration-primary">x</a>')).toHaveLength(0);
  });

  it("the .link class is underlined at rest", () => {
    const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    expect(css).toMatch(/\.link\s*\{\s*@apply[^;]*\bunderline\b/);
  });
});

describe("the board's links inside a sentence are underlined at rest", () => {
  // Pass B (2026-10-12): axe flagged "see the live re-check ages" on the clear
  // page (link-in-text-block, serious): the end-of-results sentence linked
  // the Ghost Job Index by colour alone, as did "Open your tracker" under the
  // saved view and the skill-unlock call to action. Each now wears the
  // design system's resting underline (.link). Pinned by the key each prints.
  const SENTENCE_LINKS = ["jobsPage.endScopeFreshness", "jobsPage.savedViewOpenTracker", "jobsPage.skillUnlockCta"];
  const board = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
  const linkFor = (src: string, key: string) => {
    const m = src.match(new RegExp(`<Link to="[^"]+" className="([^"]*)"\\s*>\\s*\\{t\\("${key.replace(".", "\\.")}"`));
    return m ? m[1].split(/\s+/) : null;
  };
  for (const key of SENTENCE_LINKS) {
    it(`${key} is underlined at rest`, () => {
      const cls = linkFor(board, key);
      expect(cls, `${key}'s Link is not where this guard looks: RE-ANCHOR it`).not.toBeNull();
      expect(cls!.includes("link") || cls!.includes("underline"), `${key} is marked by colour alone`).toBe(true);
    });
  }
  it("TEETH: the colour-only spelling is caught", () => {
    const planted = board.replace(/className="link"(\s*>\s*\{t\("jobsPage\.endScopeFreshness")/, 'className="text-primary hover:underline"$1');
    expect(planted, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(board);
    expect(linkFor(planted, "jobsPage.endScopeFreshness")).toEqual(["text-primary", "hover:underline"]);
    expect(colourOnlyLinks(planted).length).toBeGreaterThan(0);
  });
});
