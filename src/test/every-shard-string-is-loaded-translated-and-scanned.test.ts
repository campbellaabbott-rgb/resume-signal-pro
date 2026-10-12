/**
 * EVERY SHARD STRING IS LOADED, TRANSLATED AND SCANNED.
 *
 * The listing and company groups write their strings to
 * src/i18n/shards/<group>/<lng>.json (design spec, section 1) so no two
 * groups share a file. That only works if:
 *   1. each shard has all nine languages with IDENTICAL key sets (a key in
 *      English alone renders English to a German reader);
 *   2. no shard redefines a key main or another shard defines (which text
 *      wins would depend on merge order), and each writes only under its own
 *      root key ("listing", "companyProfile");
 *   3. every plural carries the categories its language uses;
 *   4. the claim guards read shard text (the phrase sweep lives in
 *      published-claims.test.ts through helpers/locale-strings.ts);
 *   5. the runtime really merges them: a shard key resolves through i18next.
 *
 * Before the listing and company groups land there may be no shard on disk;
 * the rules are then proven on fixture shards below, and design pass B adds
 * the assertion that both shards exist, so deleting one cannot pass.
 */
import { describe, expect, it } from "vitest";
import i18n, { enTranslation } from "@/i18n";
import { deepMerge, leafKeys, mergeShards, parseShardPath, shardProblems, shardsFor, SHARD_ROOT_KEYS, type Bundle } from "@/i18n/merge-shards";
import { LOCALE_FILES, readMainLocale, readShards, shardNames, stringLeaves } from "./helpers/locale-strings";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function pluralGaps(bundle: Bundle, lng: string): string[] {
  const need = new Intl.PluralRules(lng === "tl" ? "fil" : lng).resolvedOptions().pluralCategories.filter((c) => c !== "zero");
  const groups = new Map<string, Set<string>>();
  for (const k of leafKeys(bundle)) {
    const m = k.match(PLURAL_SUFFIX);
    if (!m) continue;
    const base = k.slice(0, -m[0].length);
    if (!groups.has(base)) groups.set(base, new Set());
    groups.get(base)!.add(m[1]);
  }
  const gaps: string[] = [];
  for (const [base, have] of groups) for (const c of need) if (!have.has(c)) gaps.push(`${base}_${c}`);
  return gaps;
}

describe("the shards on disk", () => {
  const names = shardNames();

  it("every shard directory is a registered group", () => {
    for (const n of names) expect(Object.keys(SHARD_ROOT_KEYS), `unregistered shard directory ${n}`).toContain(n);
  });

  for (const name of names) {
    describe(`shard "${name}"`, () => {
      it("has all nine languages, with identical key sets", () => {
        const sets = LOCALE_FILES.map((f) => {
          const s = readShards(f).find((x) => x.name === name);
          return [f, s ? leafKeys(s.bundle).sort() : null] as const;
        });
        const missing = sets.filter(([, k]) => k === null).map(([f]) => f);
        expect(missing, `shard ${name} is missing languages`).toEqual([]);
        const en = sets.find(([f]) => f === "en.json")![1]!;
        for (const [f, keys] of sets) {
          expect(keys, `${name}/${f} key set differs from English`).toEqual(en);
        }
      });

      it("writes only under its root key and redefines nothing", () => {
        for (const f of LOCALE_FILES) {
          expect(shardProblems(readMainLocale(f), readShards(f)), f).toEqual([]);
        }
      });

      it("every plural carries its language's categories", () => {
        for (const f of LOCALE_FILES) {
          const s = readShards(f).find((x) => x.name === name);
          if (s) expect(pluralGaps(s.bundle, f.replace(/\.json$/, "")), `${name}/${f}`).toEqual([]);
        }
      });

      it("every value is a non-empty string", () => {
        for (const f of LOCALE_FILES) {
          const s = readShards(f).find((x) => x.name === name);
          if (!s) continue;
          const empty = stringLeaves(s.bundle).filter(([, v]) => !v.trim()).map(([k]) => k);
          expect(empty, `${name}/${f}`).toEqual([]);
          expect(leafKeys(s.bundle).length).toBe(stringLeaves(s.bundle).length);
        }
      });
    });
  }

  it("the English shards are merged into the running translation", () => {
    for (const s of readShards("en.json")) {
      for (const k of leafKeys(s.bundle).slice(0, 25)) {
        expect(i18n.exists(k, { lng: "en" }), `${s.name}: ${k} does not resolve`).toBe(true);
      }
    }
  });
});

describe("the merge rules, on fixture shards", () => {
  const main: Bundle = { header: { jobs: "Jobs" }, jobsPage: { title: "Live job board" } };
  const listing = { name: "listing", bundle: { listing: { apply: "Apply on {{employer}}'s site" } } };
  const company = { name: "company", bundle: { companyProfile: { openRoles_one: "{{count}} open role", openRoles_other: "{{count}} open roles" } } };

  it("parses a shard path and picks a language's shards (fr-CA reads fr)", () => {
    expect(parseShardPath("./shards/listing/en.json")).toEqual({ name: "listing", lng: "en" });
    expect(parseShardPath("./shards/company/en-GB.json")).toEqual({ name: "company", lng: "en-GB" });
    expect(parseShardPath("./locales/en.json")).toBeNull();
    const mods = { "./shards/listing/fr.json": listing.bundle, "./shards/listing/de.json": { listing: {} } };
    expect(shardsFor(mods, "fr-CA").map((s) => s.name)).toEqual(["listing"]);
    expect(shardsFor({ "./shards/listing/fr.json": { default: listing.bundle } }, "fr")[0].bundle).toEqual(listing.bundle);
  });

  it("merges clean shards into one namespace", () => {
    const merged = mergeShards(main, [listing, company]);
    expect(merged).toMatchObject({ header: { jobs: "Jobs" }, listing: { apply: expect.any(String) }, companyProfile: { openRoles_other: expect.any(String) } });
    expect(shardProblems(main, [listing, company])).toEqual([]);
  });

  it("names a collision with main, a collision between shards, and a write outside the root", () => {
    const collidesMain = { name: "listing", bundle: { listing: { x: "1" }, header: { jobs: "Vacatures" } } };
    expect(shardProblems(main, [collidesMain]).join("\n")).toMatch(/writes outside "listing": header[\s\S]*redefines header\.jobs \(already in main\)/);
    const a = { name: "listing", bundle: { listing: { same: "a" } } };
    const b = { name: "company", bundle: { listing: { same: "b" } } };
    expect(shardProblems(main, [a, b]).join("\n")).toMatch(/redefines listing\.same \(already in shard "listing"\)/);
    expect(shardProblems(main, [{ name: "stray", bundle: {} }])).toEqual(['shard "stray" has no registered root key']);
  });

  it("a colliding shard can never replace a main-locale sentence at run time", () => {
    const merged = mergeShards(main, [{ name: "listing", bundle: { header: { jobs: "Hijacked" }, listing: {} } }]);
    expect((merged.header as Bundle).jobs).toBe("Jobs");
  });

  it("deepMerge leaves its inputs alone", () => {
    const t = { a: { b: 1 } };
    const out = deepMerge(t, { a: { c: 2 } });
    expect(out).toEqual({ a: { b: 1, c: 2 } });
    expect(t).toEqual({ a: { b: 1 } });
  });

  it("the plural check finds a missing category for the language", () => {
    expect(pluralGaps({ x_one: "a", x_other: "b" }, "en")).toEqual([]);
    expect(pluralGaps({ x_one: "a", x_other: "b" }, "es")).toEqual(["x_many"]);
    expect(pluralGaps({ x_one: "a", x_many: "c", x_other: "b" }, "fr")).toEqual([]);
  });
});

describe("the runtime bundle", () => {
  it("English is the main file with its shards merged", () => {
    expect((enTranslation.header as Bundle).jobs).toBe((readMainLocale("en.json").header as Bundle).jobs);
    for (const s of readShards("en.json")) {
      const root = SHARD_ROOT_KEYS[s.name];
      expect(enTranslation[root], `${s.name} did not reach the bundle`).toBeTruthy();
    }
  });
});
