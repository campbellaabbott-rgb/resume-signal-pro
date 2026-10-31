/**
 * THE TARGET-FLOOR COMMENT SAYS WHAT A LINK UTILITY CAN BEAT (switch-over
 * README, step 9; the fix round's finding on 44 px under a finger).
 *
 * src/index.css sets a 24 px floor on buttons, roles, selects and a[href] in
 * the base layer, and its comment said a utility like min-h-6 wins over that
 * base layer. Tailwind 3 orders its layers but does not use native cascade
 * layers, so specificity still decides: a[href] is (0,1,1), a single-class
 * utility (0,1,0), and the base rule wins on every link. The homepage's
 * link-buttons and chips had to use important floors (!min-h-10) for that
 * reason. The comment now says so, and the rule is unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };

/** The comment right above the 24 px floor rule, and the rule's selectors. */
function floor(): { comment: string; selectors: string } {
  const rule = CSS.indexOf("a[href] {\n    min-height: 24px;");
  expect(rule, "the 24 px floor rule").toBeGreaterThan(-1);
  const open = CSS.lastIndexOf("/*", rule);
  const close = CSS.indexOf("*/", open);
  return { comment: CSS.slice(open, close), selectors: CSS.slice(close + 2, rule + "a[href]".length) };
}

describe("the 24 px floor and its comment", () => {
  it("the project is on Tailwind 3, whose layers do not outrank specificity", () => {
    const v = pkg.devDependencies?.tailwindcss ?? pkg.dependencies?.tailwindcss ?? "";
    expect(v).toMatch(/^\^?3\./);
  });

  it("the rule still floors links with a[href], specificity (0,1,1)", () => {
    expect(floor().selectors).toMatch(/\ba\[href\]$/);
  });

  it("the comment no longer says a utility wins over it, and says what does for a link", () => {
    const { comment } = floor();
    expect(comment, "the old claim").not.toMatch(/a utility like min-h-6 wins over\s+this base layer/);
    expect(comment).toMatch(/\(0,1,1\)/);
    expect(comment).toMatch(/!min-h-/);
  });
});
