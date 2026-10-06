// @vitest-environment node
/**
 * THE CHANGELOG CRAWLERS GET HAS ITS ENTRIES.
 *
 * The changelog's text moved out of src/i18n/locales/en.json into its own
 * lazily loaded file, src/i18n/changelog/en.json, on 2026-07-26. The
 * prerender kept reading the main locale file, which has no changelogEntries
 * key, so every entry was filtered out: from that day until 2026-10-06 the
 * /changelog served to crawlers and answer engines was a heading over an
 * empty list (9,669 bytes, description on its no-entries fallback), while the
 * React page in a browser showed all 300-odd entries.
 *
 * What this holds: the prerender bundles the file that really holds the
 * entries, its /changelog reads that export, and the newest entries the
 * prerender takes (the first 30) each have an English title there.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { changelog } from "../data/changelog";
import { codeOf } from "./helpers/strip-comments";

const root = resolve(__dirname, "../..");
const prerender = readFileSync(resolve(root, "scripts/prerender-seo.mjs"), "utf8");
const code = codeOf(prerender);

describe("the prerendered /changelog reads the file the entries live in", () => {
  it("the data bundle exports the changelog's own English file", () => {
    const m = /export \{ default as EN_CHANGELOG \} from "\.\.\/(src\/i18n\/changelog\/en\.json)";/.exec(code);
    expect(m, "the prerender's data entry must export EN_CHANGELOG").not.toBeNull();
    const file = JSON.parse(readFileSync(resolve(root, m![1]), "utf8"));
    expect(Object.keys(file.changelogEntries ?? {}).length).toBeGreaterThan(0);
  });

  it("/changelog takes its titles from that export, not from the main locale file", () => {
    expect(code).toMatch(/const tEn = \(D\.EN_CHANGELOG && D\.EN_CHANGELOG\.changelogEntries\) \|\| \{\};/);
    expect(code).not.toMatch(/D\.EN_LOCALE && D\.EN_LOCALE\.changelogEntries/);
  });

  it("every entry the prerender takes has an English title where it reads them", () => {
    const entries = JSON.parse(readFileSync(resolve(root, "src/i18n/changelog/en.json"), "utf8")).changelogEntries;
    const missing = changelog.slice(0, 30).filter((e) => !(entries[e.id]?.title?.length > 4)).map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it("positive control: the main locale file really has no changelog text, which is why reading it emptied the page", () => {
    const main = JSON.parse(readFileSync(resolve(root, "src/i18n/locales/en.json"), "utf8"));
    expect(main.changelogEntries).toBeUndefined();
  });
});
