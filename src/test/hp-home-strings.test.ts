/**
 * THE HOMEPAGE'S STRINGS: NINE LANGUAGES, THE SHARD RULES, AND THE HOUSE RULES.
 *
 * The home strings live in src/lib/home/strings/<lng>.json until the
 * switch-over moves them to src/i18n/shards/home/ (docs/homepage-pricing/
 * README.md). Until then the design system's shard guard cannot see them, so
 * this file holds them to the same rules (one root key, no collision with the
 * main locale or another shard, identical key sets with a plural group as one
 * key, every plural category the language uses, no empty value) and to the
 * owner's copy rules of 2026-10-17:
 *
 *   - the headline, word for word;
 *   - no "verified", no claim of zero ghost jobs, no hiring odds, never
 *     "unlimited" (Pro says "no daily cap on scans");
 *   - seeker-facing copy names Claude, ChatGPT and Claude Code and no other
 *     AI host;
 *   - no retired product or price, and the EU/UK/India line describes what
 *     checkout looks at, never a billing address;
 *   - no number typed into a sentence: every count, price, allowance and
 *     window is interpolated from where it is true;
 *   - every placeholder and markup tag the English sentence has, each
 *     translation has.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { leafKeys, type Bundle } from "@/i18n/merge-shards";
import { LISTING_BANNED_PHRASES, LOCALE_FILES, readMainLocale, readShards, stringLeaves } from "./helpers/locale-strings";

const DIR = resolve(__dirname, "../lib/home/strings");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Bundle;
const PLURAL = /_(zero|one|two|few|many|other)$/;
const leaves = (f: string) => stringLeaves(read(f));

describe("the home strings exist in the nine languages the site ships", () => {
  it("one file per main locale file, no more and no fewer", () => {
    expect(FILES).toEqual(LOCALE_FILES);
    expect(FILES).toHaveLength(9);
  });

  it("each writes only under \"home\", and redefines nothing main or a shard defines", () => {
    for (const f of FILES) {
      expect(Object.keys(read(f)), f).toEqual(["home"]);
      const owned = new Set([...leafKeys(readMainLocale(f)), ...readShards(f).flatMap((s) => leafKeys(s.bundle))]);
      const clashes = leafKeys(read(f)).filter((k) => owned.has(k) || [...owned].some((o) => o.startsWith(`${k}.`) || k.startsWith(`${o}.`)));
      expect(clashes, f).toEqual([]);
    }
  });

  it("every language has the same keys as English, a plural group counting as one key", () => {
    const keysOf = (f: string) => [...new Set(leafKeys(read(f)).map((k) => k.replace(PLURAL, "")))].sort();
    const en = keysOf("en.json");
    for (const f of FILES) expect(keysOf(f), f).toEqual(en);
  });

  it("every plural carries the categories its language uses", () => {
    for (const f of FILES) {
      const lng = f.replace(/\.json$/, "");
      const need = new Intl.PluralRules(lng === "tl" ? "fil" : lng).resolvedOptions().pluralCategories.filter((c) => c !== "zero");
      const groups = new Map<string, Set<string>>();
      for (const k of leafKeys(read(f))) {
        const m = k.match(PLURAL);
        if (!m) continue;
        const base = k.slice(0, -m[0].length);
        groups.set(base, (groups.get(base) ?? new Set()).add(m[1]));
      }
      expect(groups.size, f).toBeGreaterThan(0);
      for (const [base, have] of groups) for (const c of need) expect(have.has(c), `${f} ${base}_${c}`).toBe(true);
    }
  });

  it("no value is empty", () => {
    for (const f of FILES) expect(leaves(f).filter(([, v]) => !v.trim()).map(([k]) => k), f).toEqual([]);
  });

  it("every placeholder and tag of the English sentence is in each translation", () => {
    const en = new Map(leaves("en.json"));
    const tokens = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}|<(\/?\w+)>/g)].map((m) => m[1] ?? m[2]).sort();
    for (const f of FILES) {
      for (const [k, v] of leaves(f)) {
        const base = k.replace(PLURAL, "");
        const src = en.get(k) ?? en.get(`${base}_other`) ?? en.get(base);
        expect(src, `${f} ${k} has no English sentence`).toBeDefined();
        expect(tokens(v), `${f} ${k}`).toEqual(tokens(src!));
      }
    }
  });
});

describe("the house rules hold in every language", () => {
  it("the headline is the owner's, word for word", () => {
    expect((read("en.json").home as Bundle & { hero: { title: string } }).hero.title).toBe("Live jobs, straight from employers' own hiring systems.");
    expect((read("en-GB.json").home as Bundle & { hero: { title: string } }).hero.title).toBe("Live jobs, straight from employers' own hiring systems.");
  });

  const BANNED: Array<[string, RegExp]> = [
    ...LISTING_BANNED_PHRASES,
    ["verified (adjective)", /\bverified\b|verifiziert|vérifié|verificad[oa]|geverifieerd|सत्यापित|beripikado/i],
    ["ghost jobs", /ghost|geister|fantôme|fantasma|spook|भूतिया|multo/i],
    ["unlimited", /unlimited|unbegrenzt|unbeschränkt|illimit|ilimitad|onbeperkt|onbegrensd|असीमित|walang limitasyon/i],
    ["hiring odds", /likelihood|probabilit|wahrscheinlich|probabilidad|waarschijnlijk|\d+\s?%\s*(?:chance|likely)/i],
    ["another AI host", /cursor|windsurf|copilot|gemini|codex|perplexity|vs ?code|visual studio|grok|deepseek|mistral|llama/i],
    ["a retired product or price", /freelance boost|transition pro|scan pack|apply agent|agent pass|morning queue|premium|all-access|\$\s?(?:29|99|7)\b|\b(?:29|99|7)\s?\$/i],
    ["a billing-address check", /billing address|rechnungsadresse|adresse de facturation|dirección de facturación|endereço de cobrança|factuuradres|बिलिंग पता/i],
    ["a verified-badge synonym", /\bcertified\b|zertifiziert|certifiée?s? (?:offre|poste)|vacantes certificad/i],
  ];
  // "Tell you your chances" sits in the "What we never do" list: the one place the word may appear.
  const CHANCE = /\bchances?\b|chancen|posibilidades|\bkansen\b|संभावन|tsansa/i;
  const CHANCE_KEYS = new Set(["home.ai.never2Lead", "home.ai.never2"]);

  for (const f of FILES) {
    it(`${f}: no banned phrase, and "chances" only in the never-list`, () => {
      for (const [k, v] of leaves(f)) {
        for (const [name, re] of BANNED) expect(re.test(v), `${f} ${k}: ${name}: "${v}"`).toBe(false);
        if (!CHANCE_KEYS.has(k)) expect(CHANCE.test(v), `${f} ${k}: "${v}"`).toBe(false);
      }
    });
  }

  it("names Claude, ChatGPT and Claude Code, in every language", () => {
    for (const f of FILES) {
      const all = leaves(f).map(([, v]) => v).join("\n");
      expect(all, f).toContain("Claude Code");
      expect(all, f).toContain("ChatGPT");
    }
  });

  it("types no number into a sentence (95 is the statistic's name, 100 the sample score's scale)", () => {
    for (const f of FILES) {
      for (const [k, v] of leaves(f)) {
        const digits = (v.replace(/\{\{\s*\w+\s*\}\}/g, "").match(/\d+/g) ?? []).filter((d) => d !== "95" && d !== "100");
        expect(digits, `${f} ${k}: "${v}"`).toEqual([]);
      }
    }
  });

  it("says fit is free with no account, and that the checkout line names what it checks", () => {
    for (const f of ["en.json", "en-GB.json"]) {
      const h = read(f).home as Record<string, Record<string, string>>;
      expect(h.faq.fitA).toMatch(/free, with no account/);
      expect(h.plans.freeTitle).toMatch(/fit/);
      expect(h.plans.termTerritory).toMatch(/EU.*EEA.*UK.*India/);
      expect(h.plans.termTerritory).toMatch(/currency.*time zone.*IP address/);
      expect(h.plans.proBody).toMatch(/no daily cap on scans/);
      expect(h.plans.termFinal).toBe("All sales are final.");
    }
  });
});
