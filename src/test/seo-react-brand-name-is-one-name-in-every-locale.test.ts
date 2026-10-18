/**
 * THE BRAND IS "RESUME BOOSTER" IN EVERY LANGUAGE (S12-135).
 *
 * en-GB named the product "CV Booster" six times — the footer copyright on
 * every page, the FAQ subtitle and question, the comparison answer, "Why …?"
 * and the comparison table's own column — while every other locale, the
 * bake, the JSON-LD and the domain say Resume Booster. A British visitor read
 * a different product name than the one a search result showed them.
 *
 * Any string in any main locale or shard that names a "… Booster" must name
 * Resume Booster (the German compound "Resume-Booster-…" is the same name).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "i18n");
const DIRS = ["locales", "shards/company", "shards/listing"];

function leaves(o: unknown, prefix = ""): Array<[string, string]> {
  if (typeof o === "string") return [[prefix, o]];
  if (!o || typeof o !== "object") return [];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("the brand name in every locale", () => {
  const files = DIRS.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".json")).map((f) => join(d, f)));

  it("reads nine main locale files", () => {
    expect(files.filter((f) => f.startsWith("locales/")).length).toBe(9);
  });

  it.each(files)("%s names no Booster but Resume Booster", (file) => {
    const strings = leaves(JSON.parse(readFileSync(join(ROOT, file), "utf8")));
    const wrong = strings
      .filter(([, v]) => /Booster/.test(v))
      .filter(([, v]) => v.replace(/Resume[ -]Booster/g, "").includes("Booster"))
      .map(([k, v]) => `${k}: ${v.slice(0, 80)}`);
    expect(wrong).toEqual([]);
  });

  it("en-GB says Resume Booster in its footer copyright", () => {
    const gb = JSON.parse(readFileSync(join(ROOT, "locales", "en-GB.json"), "utf8"));
    expect(gb.footer.copyright).toContain("Resume Booster");
  });
});
