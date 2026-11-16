// @vitest-environment node
/**
 * EVERY BUILDER STRING EXISTS IN NINE LANGUAGES.
 *
 * The bug round's builder fixes (an import that failed or was cut short, a
 * draft changed in another tab, a browser that keeps nothing, moving entries,
 * the fields' names) say new things. Those strings live in the builder shard
 * (src/i18n/shards/builder, root builderPage), translated, not in the main
 * locale files. Held here: every literal key the builder's files ask t() for
 * resolves in each of the nine bundles the app serves (main locale plus every
 * shard, merged as src/i18n/index.ts merges them); the shard writes only
 * under its root and redefines nothing; and each translation keeps the
 * placeholders its English carries.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { LOCALE_FILES, readLocale, readMainLocale, readShards, stringLeaves } from "./helpers/locale-strings";
import { shardProblems } from "../i18n/merge-shards";

const root = resolve(__dirname, "../..");
const FILES = [
  "src/pages/ResumeBuilder.tsx",
  "src/components/builder/ExperienceEditor.tsx",
  "src/components/builder/EducationEditor.tsx",
  "src/components/builder/ResumePreview.tsx",
];

const keysOf = (file: string) =>
  [...new Set([...codeOf(readFileSync(resolve(root, file), "utf8")).matchAll(/\bt\(\s*["']([A-Za-z0-9_.-]+)["']/g)].map((m) => m[1]))];

const at = (bundle: Record<string, unknown>, k: string) =>
  k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), bundle);
const resolves = (bundle: Record<string, unknown>, key: string) =>
  [key, `${key}_one`, `${key}_other`].some((k) => typeof at(bundle, k) === "string");

describe("the builder's strings, in every language the app serves", () => {
  it.each(FILES)("%s asks only for keys every language holds", (file) => {
    const keys = keysOf(file);
    expect(keys.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const lf of LOCALE_FILES) for (const k of keys) if (!resolves(readLocale(lf), k)) missing.push(`${lf}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("the page asks for the new builderPage strings", () => {
    const keys = keysOf("src/pages/ResumeBuilder.tsx");
    for (const k of ["builderPage.importTruncated", "builderPage.importLatest", "builderPage.storageBlocked", "builderPage.otherTab.cleared", "builderPage.importFailed.retry"]) {
      expect(keys, k).toContain(k);
    }
  });

  it("the builder shard writes only under its root, in all nine languages, and redefines nothing main holds", () => {
    expect(LOCALE_FILES).toHaveLength(9);
    for (const lf of LOCALE_FILES) {
      const builder = readShards(lf).filter((s) => s.name === "builder");
      expect(builder, lf).toHaveLength(1);
      expect(Object.keys(builder[0].bundle)).toEqual(["builderPage"]);
      expect(shardProblems(readMainLocale(lf), builder), lf).toEqual([]);
    }
  });

  it("each translation keeps its English placeholders, and none is left in English", () => {
    const en = readShards("en.json").find((s) => s.name === "builder")!.bundle;
    const enLeaves = new Map(stringLeaves(en).map(([k, v]) => [k.replace(/_(one|other|many|few|two|zero)$/, ""), v]));
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const lf of LOCALE_FILES.filter((f) => f !== "en.json")) {
      const shard = readShards(lf).find((s) => s.name === "builder")!.bundle;
      for (const [k, v] of stringLeaves(shard)) {
        const base = k.replace(/_(one|other|many|few|two|zero)$/, "");
        const want = enLeaves.get(base);
        expect(want, `${lf}: ${k} has no English`).toBeDefined();
        if (!/_one$/.test(k)) expect(vars(v), `${lf}: ${k}`).toEqual(vars(want!));
        if (!lf.startsWith("en") && !/^builderPage\.(bullet)$/.test(k)) expect(v, `${lf}: ${k} is English`).not.toBe(want);
      }
    }
  });
});
