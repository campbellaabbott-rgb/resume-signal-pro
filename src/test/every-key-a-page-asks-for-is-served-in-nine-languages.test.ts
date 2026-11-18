/**
 * EVERY KEY A PAGE ASKS FOR IS SERVED IN NINE LANGUAGES (S14X-253 and
 * NEW-COPY-I18N-02).
 *
 * A call t("ns.key", "English") renders its English default whenever no
 * bundle holds the key, and nothing throws: the homepage's source strip, the
 * coverage section's eyebrow and its "as of" line, the free results page's
 * board button and seven account panels read in English to every reader of
 * every language, and no test noticed, because each one passes in English.
 *
 * Held here: every literal key a page asks for (t("…"), i18n.t("…"),
 * i18next.t("…"); a template literal with a ${…} part is skipped) resolves, as
 * a string or a plural group, in all nine languages' served bundles: the main
 * locale with its string shards merged, plus the sign-in strings and the
 * changelog strings that load beside them. A key read with returnObjects may
 * resolve to a list or an object.
 *
 * KNOWN_UNSERVED is the short, per-file list of what no change translates, each
 * with its reason, and an entry must come off once every key in its file
 * resolves.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deepMerge, type Bundle } from "@/i18n/merge-shards";
import { I18N_DIR, LOCALE_FILES, readLocale } from "./helpers/locale-strings";

const SRC = resolve(__dirname, "..");

const KNOWN_UNSERVED: Record<string, string> = {
  // Imported by nothing (checked below): no reader can be shown its keys.
  "components/JobBoardHero.tsx": "the board's old hero, imported by no page",
};
const KNOWN_UNSERVED_CAP = 3;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "test" || f === "__tests__") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** The argument text after a key's closing quote, up to the call's ')'. */
function argsAfter(s: string, i: number): string {
  let depth = 1;
  let q: string | null = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === "\\") { j++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") { depth--; if (depth === 0) return s.slice(i, j); }
  }
  return "";
}

const CALL = /(?<![\w$.])(?:i18n\.|i18next\.)?t\(\s*(["'`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g;
const PLURAL = /_(zero|one|two|few|many|other)$/;

type Ask = { key: string; file: string; objects: boolean };
function asks(): Ask[] {
  const out: Ask[] = [];
  for (const f of sourceFiles(SRC)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(CALL)) {
      if (m[1] === "`" && m[2].includes("${")) continue;
      const args = argsAfter(s, (m.index ?? 0) + m[0].length);
      out.push({ key: m[2], file: relative(SRC, f), objects: /returnObjects\s*:\s*true/.test(args) });
    }
  }
  return out;
}

function served(file: string): Bundle {
  let b = readLocale(file);
  for (const extra of ["auth", "changelog"]) {
    const p = join(I18N_DIR, extra, file);
    if (existsSync(p)) b = deepMerge(b, JSON.parse(readFileSync(p, "utf8")) as Bundle);
  }
  return b;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function resolves(b: Bundle, ask: Ask): boolean {
  const parts = ask.key.split(".");
  const leaf = parts.pop() as string;
  let o: unknown = b;
  for (const p of parts) o = isObj(o) ? o[p] : undefined;
  if (!isObj(o)) return false;
  const v = o[leaf];
  if (typeof v === "string") return true;
  if (ask.objects && v !== undefined && typeof v === "object") return true;
  return Object.keys(o).some((k) => PLURAL.test(k) && k.replace(PLURAL, "") === leaf);
}

const ALL = asks();
const BUNDLES = new Map(LOCALE_FILES.map((f) => [f.replace(/\.json$/, ""), served(f)]));

/** file -> key -> the languages it is missing in. */
function unserved(): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  for (const ask of ALL) {
    const missing = [...BUNDLES].filter(([, b]) => !resolves(b, ask)).map(([lng]) => lng);
    if (!missing.length) continue;
    if (!out.has(ask.file)) out.set(ask.file, new Map());
    out.get(ask.file)!.set(ask.key, missing);
  }
  return out;
}

describe("every key a page asks for is served in nine languages", () => {
  it("the scan reads the calls it is about", () => {
    expect(BUNDLES.size).toBe(9);
    expect(ALL.length).toBeGreaterThan(2000);
    expect(ALL.some((a) => a.key === "atsCoverage.heading")).toBe(true);
  });

  it("every literal key resolves in every language, outside the files listed with their reason", () => {
    const bad: string[] = [];
    for (const [file, keys] of unserved()) {
      if (file in KNOWN_UNSERVED) continue;
      for (const [key, missing] of keys) bad.push(`${file}: ${key}  [${missing.length === 9 ? "all nine" : missing.join(", ")}]`);
    }
    expect(bad, "these render their English default (or the raw key) in the languages named").toEqual([]);
  });

  it("each listed file still has a key no language serves, and the list stays short", () => {
    const now = unserved();
    expect(Object.keys(KNOWN_UNSERVED).length).toBeLessThanOrEqual(KNOWN_UNSERVED_CAP);
    for (const [file, why] of Object.entries(KNOWN_UNSERVED)) {
      expect(why.length, file).toBeGreaterThan(10);
      expect(now.has(file), `${file} is served in full now: take it off KNOWN_UNSERVED`).toBe(true);
    }
  });

  it("the unimported hero is listed only while no file imports it", () => {
    const importers = sourceFiles(SRC).filter((f) => /from\s+["'][^"']*\/JobBoardHero["']|import\(\s*["'][^"']*\/JobBoardHero["']\s*\)/.test(readFileSync(f, "utf8")));
    expect(importers.map((f) => relative(SRC, f))).toEqual([]);
  });
});
