/**
 * NO RAW PALETTE IN THE LEDGER'S OWN FILES.
 *
 * The design system is a set of tokens (src/index.css) measured for contrast
 * in both themes (design-tokens-contrast.test.ts). A class that names a raw
 * Tailwind colour ("text-gray-500", "bg-amber-50", "text-white"), a hex value,
 * a pixel font size, or text whose contrast comes from an opacity modifier
 * ("text-foreground/70") bypasses every one of those measurements: it is a
 * colour nobody checked, and it will be wrong in one of the two themes.
 *
 * COVERED: every file the design-system, listing and company groups create,
 * plus Header, Footer and src/components/ui/** and src/components/data/**.
 * RATCHETED: the four big legacy pages may only lose violations, never gain
 * them. Their counts are measured, and the number below is lowered each time
 * a page is cleaned (an assertion fails when the count drops below the
 * recorded figure, so the record follows the code down). The admin pages
 * forced dark (App.tsx ForceDark) are outside both lists.
 *
 * Code only: comments are stripped first, so a sentence quoting a banned
 * class (this one) is never a violation and never a pass.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");

const COLORS = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTIL = "text|bg|border|ring|ring-offset|from|via|to|fill|stroke|outline|divide|placeholder|shadow|decoration|accent|caret";

export const RULES: Array<[name: string, re: RegExp]> = [
  ["raw palette colour", new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:${COLORS})-\\d{2,3}(?:\\/\\d{1,3})?(?![\\w-])`, "g")],
  ["raw white or black", new RegExp(`(?<![\\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:white|black)(?:\\/\\d{1,3})?(?![\\w-])`, "g")],
  ["hex colour in a class", /\[#[0-9a-fA-F]{3,8}\]|className="[^"]*#[0-9a-fA-F]{3,8}\b/g],
  ["pixel font size", /(?<![\w-])(?:[a-z-]+:)*text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g],
  ["text contrast from opacity", /(?<![\w-])(?:[a-z-]+:)*text-[a-z]+(?:-[a-z]+)*\/\d{1,3}(?![\w-])/g],
  ["opacity on content", /(?<![\w-])(?!(?:disabled|peer-disabled|data-\[disabled\]|aria-disabled|group-disabled):)(?:[a-z-]+:)*opacity-(?!0(?![\d])|100(?![\d]))\d{1,3}(?![\w-])/g],
];

/** Violations in one source text, after comments come off. */
export function violations(src: string): string[] {
  const code = codeOf(src);
  const out: string[] = [];
  for (const [name, re] of RULES) {
    for (const m of code.matchAll(re)) {
      // A disabled-state dimming is exempt (WCAG excludes inactive controls).
      if (name === "opacity on content" && /(?:disabled|\[disabled\]):opacity-/.test(code.slice(Math.max(0, (m.index ?? 0) - 24), (m.index ?? 0) + m[0].length))) continue;
      out.push(`${name}: ${m[0]}`);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const COVERED_DIRS = [
  "src/components/ui",
  "src/components/data",
  // The listing and company groups' own directories (empty until they land).
  "src/components/jobs/listing",
  "src/components/jobs/company",
  "src/components/company",
  "src/lib/listing",
  "src/lib/company",
];
const COVERED_FILES = [
  "src/components/Header.tsx",
  "src/components/Footer.tsx",
  "src/components/LanguageSwitcher.tsx",
  "src/components/ScanCreditsCounter.tsx",
  "src/components/FloatingHelpButton.tsx",
  "src/components/FloatingUploadButton.tsx",
  "src/components/StickyBottomCTA.tsx",
  "src/components/jobs/FilterBar.tsx",
  "src/components/jobs/FilterSheet.tsx",
  "src/components/jobs/HowApplyingWorks.tsx",
  "src/components/jobs/BoardBudgetNotice.tsx",
  "src/components/jobs/SavedSearchPills.tsx",
  "src/components/jobs/contracts.ts",
  "src/lib/format.ts",
  "src/lib/display-name.ts",
  "src/lib/apply-mechanics.ts",
  "src/lib/theme.ts",
  "src/App.tsx",
];

/**
 * THE RATCHET. Measured 2026-10-12 on the design-system branch (pass A); the
 * board wiring pass lowers these as it swaps each region onto the listing and
 * company components.
 */
const RATCHET: Record<string, number> = {
  "src/pages/Jobs.tsx": 134,
  "src/pages/JobPosting.tsx": 0,
  "src/pages/Pricing.tsx": 0,
  "src/pages/Index.tsx": 2,
};

const covered = [
  ...COVERED_DIRS.flatMap((d) => walk(resolve(ROOT, d))),
  ...COVERED_FILES.map((f) => resolve(ROOT, f)).filter(existsSync),
];

describe("the Ledger's own files use tokens only", () => {
  it("the sweep reads what it says", () => {
    const rel = covered.map((f) => relative(ROOT, f));
    expect(rel).toContain("src/components/ui/button.tsx");
    expect(rel).toContain("src/components/Header.tsx");
    expect(rel).toContain("src/components/jobs/FilterBar.tsx");
    expect(rel.length).toBeGreaterThan(40);
  });

  it.each(covered.map((f) => [relative(ROOT, f)]))("%s", (rel) => {
    expect(violations(readFileSync(resolve(ROOT, rel), "utf8"))).toEqual([]);
  });
});

describe("the legacy pages may only get cleaner", () => {
  it.each(Object.entries(RATCHET))("%s holds at most %i violations", (rel, max) => {
    const n = violations(readFileSync(resolve(ROOT, rel), "utf8")).length;
    expect(n, `${rel} gained raw-palette classes (now ${n}, ratchet ${max})`).toBeLessThanOrEqual(max);
    expect(n, `${rel} got cleaner (now ${n}): lower its ratchet to ${n}`).toBe(max);
  });
});

describe("the rules catch what they name", () => {
  it.each([
    ['className="text-gray-500"', "raw palette colour"],
    ['className="hover:bg-amber-50/40"', "raw palette colour"],
    ['className="text-white"', "raw white or black"],
    ['className="bg-[#0a0a0a]"', "hex colour in a class"],
    ['className="text-[11px]"', "pixel font size"],
    ['className="text-muted-foreground/70"', "text contrast from opacity"],
    ['className="opacity-70"', "opacity on content"],
  ])("%s is a %s", (src, name) => {
    expect(violations(src).some((v) => v.startsWith(name)), violations(src).join(", ")).toBe(true);
  });

  it.each([
    'className="text-muted-foreground bg-primary/10 border-warning/40 decoration-primary/50"',
    'className="disabled:opacity-60 data-[disabled]:opacity-60 peer-disabled:opacity-70"',
    'className="opacity-0 group-hover:opacity-100"',
    '// a comment quoting text-gray-500 is not code',
  ])("%s is clean", (src) => {
    expect(violations(src)).toEqual([]);
  });
});
