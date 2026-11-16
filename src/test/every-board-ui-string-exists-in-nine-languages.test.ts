// @vitest-environment node
/**
 * EVERY BOARD-UI STRING EXISTS IN NINE LANGUAGES (bug round 2026-11-08, lane
 * board-ui).
 *
 * The board's fixes in this round add sentences: the allowance named with its
 * number and window, the unscored reason, the parse that read nothing, the
 * hand-off that leaves a vendor out, the compare sheet's description. They
 * live in src/i18n/shards/board-ui under the root "boardUi", one file per
 * language, and every one of them is a translation, not the English copied
 * across. The board's own inputs (NB-45) read the filter bar's existing names
 * for the keyword and location fields, so those keys must resolve too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { LOCALE_FILES, readLocale, readMainLocale, readShards } from "./helpers/locale-strings";
import { shardProblems } from "../i18n/merge-shards";

const root = resolve(__dirname, "../..");
const FILES = [
  "src/pages/Jobs.tsx",
  "src/components/LiveMatches.tsx",
  "src/components/jobs/listing/JobCard.tsx",
  "src/components/jobs/company/HiringRecordCard.tsx",
];

/** The literal boardUi / filterBar keys a file asks t() for. */
const keysOf = (file: string) =>
  [...new Set([...codeOf(readFileSync(resolve(root, file), "utf8")).matchAll(/\bt\(\s*["']((?:boardUi|filterBar)\.[A-Za-z0-9_.-]+)["']/g)].map((m) => m[1]))];

const at = (bundle: Record<string, unknown>, key: string) =>
  key.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), bundle);

const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe("the board's new strings, in every language the app serves", () => {
  it("there are nine bundles", () => {
    expect(LOCALE_FILES).toHaveLength(9);
  });

  it("the board asks for boardUi keys at all (the reader below is not reading nothing)", () => {
    expect(keysOf("src/pages/Jobs.tsx").filter((k) => k.startsWith("boardUi.")).length).toBeGreaterThan(10);
  });

  it.each(FILES)("%s asks only for boardUi and filterBar keys every language holds", (file) => {
    const missing: string[] = [];
    for (const lf of LOCALE_FILES) {
      const bundle = readLocale(lf);
      for (const k of keysOf(file)) if (typeof at(bundle, k) !== "string") missing.push(`${lf}: ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it("the board-ui shard writes only under its root and redefines nothing main holds", () => {
    for (const lf of LOCALE_FILES) {
      const mine = readShards(lf).filter((s) => s.name === "board-ui");
      expect(mine, lf).toHaveLength(1);
      expect(shardProblems(readMainLocale(lf), mine), lf).toEqual([]);
    }
  });

  it("every language is translated, and keeps the English sentence's placeholders", () => {
    const en = readLocale("en.json").boardUi as Record<string, string>;
    expect(Object.keys(en).length).toBeGreaterThan(10);
    for (const lf of LOCALE_FILES.filter((f) => f !== "en.json")) {
      const v = readLocale(lf).boardUi as Record<string, string>;
      for (const [k, s] of Object.entries(en)) {
        expect(vars(v[k] ?? ""), `${lf}: ${k}`).toEqual(vars(s));
        // en-GB shares most English sentences; every other language must not.
        if (!lf.startsWith("en")) expect(v[k], `${lf}: ${k} is the English copied across`).not.toBe(s);
      }
    }
  });

  it("names no AI host but the connector itself (seeker copy names only Claude, ChatGPT and Claude Code)", () => {
    for (const lf of LOCALE_FILES) {
      const text = JSON.stringify(readLocale(lf).boardUi);
      expect(text, lf).not.toMatch(/Cursor|Copilot|Gemini|Windsurf|Cline|VS ?Code|Zed\b/);
    }
  });
});
