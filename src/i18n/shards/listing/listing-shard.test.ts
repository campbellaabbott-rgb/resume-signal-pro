/**
 * THE LISTING SHARD: nine locales, one key set, every plural category, no
 * banned claim, and inline defaults that say what English says.
 *
 * The design-system pass adds the cross-shard guard
 * (src/test/every-shard-string-is-loaded-translated-and-scanned.test.ts) and
 * the loader that merges this shard at init. Until then this file holds the
 * shard to the same rules on its own:
 *   - the 9 files, each with the single top-level key "listing", and the same
 *     keys once plural suffixes are folded;
 *   - each plural key carries exactly the categories Intl.PluralRules reports
 *     for the locale (es, fr and pt need one/many/other);
 *   - placeholders survive translation, and the seven translated locales are
 *     really translated;
 *   - no key collides with the main locale file;
 *   - no banned claim word, and no AI host besides Claude, ChatGPT and Claude
 *     Code;
 *   - every t("listing.…") default in the listing components equals the
 *     English shard value, so the source a reviewer reads is what ships.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DIR = __dirname;
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const load = (l: string) => JSON.parse(readFileSync(join(DIR, `${l}.json`), "utf8")) as Record<string, unknown>;

function flatten(o: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out[key] = v;
      else Object.assign(out, flatten(v, key));
    }
  }
  return out;
}
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]).sort();
const FLAT = Object.fromEntries(LOCALES.map((l) => [l, flatten(load(l))])) as Record<string, Record<string, string>>;
const EN = FLAT.en;

describe("the files", () => {
  it("are exactly the nine locales, each with the single top-level key 'listing'", () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()).toEqual([...LOCALES].map((l) => `${l}.json`).sort());
    for (const l of LOCALES) expect(Object.keys(load(l)), l).toEqual(["listing"]);
  });

  it("carry the same keys once plural suffixes are folded", () => {
    const want = [...new Set(Object.keys(EN).map(base))].sort();
    for (const l of LOCALES) expect([...new Set(Object.keys(FLAT[l]).map(base))].sort(), l).toEqual(want);
  });

  it("carry every plural category the locale needs, and no other", () => {
    const plurals = [...new Set(Object.keys(EN).filter((k) => PLURAL.test(k)).map(base))];
    expect(plurals.length, "no plural keys found — this check would be vacuous").toBeGreaterThan(0);
    for (const l of LOCALES) {
      const cats = new Intl.PluralRules(l).resolvedOptions().pluralCategories.slice().sort();
      for (const p of plurals) {
        const have = Object.keys(FLAT[l]).filter((k) => base(k) === p && PLURAL.test(k)).map((k) => k.match(PLURAL)![1]).sort();
        expect(have, `${l}: ${p}`).toEqual(cats);
      }
    }
  });
});

describe("the translations", () => {
  it("keep every placeholder English uses, and invent none", () => {
    // The components pass BOTH {{employer}} and {{employerPossessive}} wherever
    // English uses the possessive, because most languages build "X's site" with
    // a preposition and the plain name; the two count as one slot here.
    const slot = (names: string[]) => names.map((n) => (n === "employerPossessive" ? "employer" : n));
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(FLAT[l])) {
        const enKey = EN[k] !== undefined ? k : `${base(k)}_other`;
        expect(slot(placeholders(v)), `${l}: ${k}`).toEqual(slot(placeholders(EN[enKey])));
      }
    }
  });

  it("are really translated in the seven non-English locales", () => {
    const FORMULA = new Set(["listing.card.annualEstimate", "listing.page.jobs", "listing.page.breadcrumb", "listing.facts.system"]);
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const same = Object.keys(FLAT[l]).filter((k) => !FORMULA.has(k) && FLAT[l][k] === EN[k]);
      expect(same, `${l} still carries English for: ${same.join(", ")}`).toEqual([]);
    }
  });

  it("collide with no key of the main locale file", () => {
    const main = JSON.parse(readFileSync(resolve(DIR, "../../locales/en.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(main)).not.toContain("listing");
  });

  it("make no banned claim and name no AI host but Claude, ChatGPT and Claude Code", () => {
    const BANNED = /\bverified\b|zero ghost|\bfilled\b|early applicants|re-?checked live|Gemini|Copilot|Cursor|Perplexity|Windsurf|Grok|Llama/i;
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(FLAT[l])) expect(v, `${l}: ${k}`).not.toMatch(BANNED);
    }
    expect(EN["listing.menu.aiHandoff"]).toBe("Open in Claude or ChatGPT");
  });
});

describe("the components' inline defaults are the English shard", () => {
  const COMPONENTS = resolve(DIR, "../../../components/jobs/listing");
  const sources = readdirSync(COMPONENTS)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => ({ f, code: readFileSync(join(COMPONENTS, f), "utf8") }));

  it("every listing key the components read exists in the shard, with the same English", () => {
    let checked = 0;
    for (const { f, code } of sources) {
      // t("listing.x", "default")
      for (const m of code.matchAll(/t\(\s*"(listing\.[\w.]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)) {
        expect(EN[m[1]], `${f}: ${m[1]} is not in the shard`).toBeDefined();
        expect(m[2], `${f}: ${m[1]}`).toBe(EN[m[1]]);
        checked++;
      }
      // t("listing.x", { defaultValue: "…" | defaultValue_one: "…", defaultValue_other: "…" })
      for (const m of code.matchAll(/t\(\s*"(listing\.[\w.]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
        for (const d of m[2].matchAll(/defaultValue(_one|_other)?:\s*"((?:[^"\\]|\\.)*)"/g)) {
          const key = d[1] ? `${m[1]}${d[1]}` : m[1];
          expect(EN[key], `${f}: ${key} is not in the shard`).toBeDefined();
          expect(d[2], `${f}: ${key}`).toBe(EN[key]);
          checked++;
        }
      }
    }
    expect(checked, "the scan found no defaults — the patterns stopped matching").toBeGreaterThan(40);
  });
});
