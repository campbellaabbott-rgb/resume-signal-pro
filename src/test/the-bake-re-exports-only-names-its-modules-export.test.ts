// @vitest-environment node
/**
 * THE BAKE RE-EXPORTS ONLY NAMES ITS MODULES EXPORT (wave 4, the second
 * recheck of the descope).
 *
 * scripts/prerender-seo.mjs writes a data entry of `export { NAME } from
 * "../src/..."` lines and bundles it with esbuild. A name the module no
 * longer exports bundles SILENTLY: esbuild leaves it undefined, and the first
 * read of it (D.AFFILIATE_COMMISSION_CENTS.other, in the SEO round's
 * /affiliates bake) throws inside the bake's never-block-a-publish handler, so
 * the publish ships with no prerendered pages and a green build. Wave 4
 * removed AFFILIATE_COMMISSION_CENTS (the affiliate re-base); the SEO round's
 * bake still names it, and neither file conflicts as text when main is merged
 * into wave4/integration. This reads the entry the bake writes and imports
 * every module it names, and fails on any name that module does not export.
 * It passes on wave 4's own bake and fails on that merge until the bake reads
 * affiliates.proCommission and AFFILIATE_PRO_FIRST_MONTH_CENTS.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const BAKE = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");

/** The entry's re-export lines: [names, module path relative to scripts/]. */
function reexportsOf(bake: string): Array<{ names: string[]; from: string }> {
  // `writeFileSync(entry, \`...\`)` here; `writeFileSync(entry, entryImports(\`...\`))` in the SEO round's bake.
  const start = bake.indexOf("writeFileSync(entry,");
  if (start < 0) return [];
  const open = bake.indexOf("`", start);
  const entry = bake.slice(open + 1, bake.indexOf("`", open + 1));
  return [...entry.matchAll(/export \{([^}]+)\} from "([^"]+)";/g)].map((m) => ({
    names: m[1].split(",").map((n) => n.trim()).filter(Boolean).map((n) => (n.includes(" as ") ? n.split(" as ")[0].trim() : n)),
    from: m[2],
  }));
}

describe("every name the bake's data entry re-exports exists in its module", () => {
  const lines = reexportsOf(BAKE);

  it("reads the entry (an empty read would pass vacuously)", () => {
    expect(lines.length).toBeGreaterThan(20);
    expect(lines.some((l) => l.from.endsWith("src/config/products"))).toBe(true);
  });

  it.each(lines.map((l) => [l.from, l] as const))("%s", async (_from, l) => {
    const mod = (await import(/* @vite-ignore */ resolve(ROOT, "scripts", l.from))) as Record<string, unknown>;
    const missing = l.names.filter((n) => n !== "default" && !(n in mod));
    expect(missing, `${l.from} does not export ${missing.join(", ")}`).toEqual([]);
  });

  it("the teeth: the SEO round's affiliate line is caught against wave 4's module", async () => {
    const [line] = reexportsOf('writeFileSync(entry, `\nexport { AFFILIATE_COMMISSION_CENTS, formatUsd } from "../src/config/affiliate-commission";\n`);');
    const mod = (await import(/* @vite-ignore */ resolve(ROOT, "scripts", line.from))) as Record<string, unknown>;
    expect(line.names.filter((n) => !(n in mod))).toEqual(["AFFILIATE_COMMISSION_CENTS"]);
  });
});
