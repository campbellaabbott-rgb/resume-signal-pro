/**
 * A COUNT OF ONE IS SAID IN THE SINGULAR (S14X-176).
 *
 * i18next answers t(key, { count }) by looking up key_one or key_other for the
 * reader's language, then the bare key. Nine keys that every call site already
 * passed a count to had only a bare key, so one issue on the free results page
 * read "1 issues found — fix them now", the board told a screen reader
 * "1 openings shown.", and the same held in every language, where the noun and
 * the verb did not agree either.
 *
 * Held here, two ways:
 *   (a) through the real i18n instance with each language's served bundle,
 *       a count of one resolves to that language's own singular text for each
 *       of the nine keys, never to the bare key or to English;
 *   (b) every literal t("<key>", { count }) call in the app names a key with a
 *       plural group in the English bundle, unless its count can never be one
 *       or its sentence reads the same at one (COUNT_NEUTRAL, each with why),
 *       or its string belongs to another group's shard (SHARD_OWNED).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { deepMerge, type Bundle } from "@/i18n/merge-shards";
import { I18N_DIR, LOCALE_FILES, readLocale, readMainLocale, readShards } from "./helpers/locale-strings";

const SRC = resolve(__dirname, "..");

/** The nine keys whose count can be one and whose sentence then changed. */
const SINGULAR_KEYS = [
  "freeResults.actionBanner.issuesFound",
  "jobsPage.a11yResults",
  "freeResults.lockedInsights.kwDescWithStats",
  "homepage.toast.unreadCharactersDescription",
  "jobKeywordMatcher.topActions",
  "jobsPage.fuzzyExtraLine",
  "jobsPage.hiddenCount",
  "jobsPage.hiddenByViews",
  "accountPage.tracked",
] as const;

/**
 * Count-taking keys that need no plural group, each with the reason. Capped:
 * the list is for a count that cannot be one, a "label: N" or "(N)" form,
 * or an abbreviated unit, never for a sentence that reads wrong at one.
 */
const COUNT_NEUTRAL: Record<string, string> = {
  "accountPage.acSavedNoLetter": "label form: 'Tailored résumés saved: N.'",
  "accountPage.localScansOfferTitle": "label form: 'Scans found in this browser: N'",
  "accountPage.scanCountMany": "rendered only when scans.length is not 1; scanCountOne says one",
  "atsCoverage.stripSub": "the count is the served applicant-tracking-system list, a constant of many",
  "atsCoverage.sub": "the count is the served applicant-tracking-system list, a constant of many",
  "atsCoverage.subCounted": "the count is the served applicant-tracking-system list, a constant of many",
  "atsRoles.description": "'up to N' with N the constant MAX_TARGET_ROLES (3)",
  "hero.preview.found": "a sample preview whose count is the constant 8",
  "hero.preview.ready": "a sample preview whose count is the constant 5",
  "jobKeywordMatcher.criticalGapsTitle": "heading with the count in parentheses: '(N)'",
  "jobKeywordMatcher.skillsYouHave": "heading with the count in parentheses: '(N)'",
  "jobKeywordMatcher.showAll": "rendered only when there are more than five gaps",
  "jobsPage.agoMinutes": "abbreviated unit ('Nm ago'); rendered from two minutes",
  "jobsPage.agoHours": "abbreviated unit ('Nh ago')",
  "jobsPage.agoDays": "abbreviated unit ('Nd ago')",
  "jobsPage.postedDaysAgo": "abbreviated unit ('Nd ago')",
  "jobsPage.fitSummaryStrong": "partitive: 'N of these openings' reads at one in every language",
  "jobsPage.fitSummaryPossible": "partitive: 'N of these openings' reads at one in every language",
  "jobsPage.fitSummaryAndPossible": "'N more' reads at one in every language",
  "jobsPage.sameLocationOpenings": "rendered only when postingCount is above 1",
  "jobsPage.seeAllOpenings": "rendered only when postingCount - 1 exceeds the siblings listed, so at least 2",
  "methodologyPage.atsCount": "the count is the named scan systems, a constant of many",
  "methodologyPage.atsPlatformsSubtitle": "the count is the named scan systems, a constant of many",
  "streamingContent.characters": "StreamingContentDisplay is imported by nothing",
  "writingTools.lettersStillOwed": "label form: 'Cover letters still to write: N.'",
};
const COUNT_NEUTRAL_CAP = 30;

/**
 * Count-taking keys whose string lives in another group's shard, which that
 * group edits; each names the shard so the entry cannot excuse a main-locale
 * key. Their singular is that group's follow-up.
 */
const SHARD_OWNED: Record<string, string> = {
  "accountView.profileUploadedAndRead": "account",
};
const SHARD_OWNED_CAP = 3;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function holder(bundle: Bundle, key: string): [Record<string, unknown> | undefined, string] {
  const parts = key.split(".");
  const leaf = parts.pop() as string;
  let o: unknown = bundle;
  for (const p of parts) o = o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>)[p] : undefined;
  return [o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : undefined, leaf];
}
const hasPluralGroup = (bundle: Bundle, key: string) => {
  const [o, leaf] = holder(bundle, key);
  return !!o && Object.keys(o).some((k) => k === `${leaf}_one` || k === `${leaf}_other`);
};
const served = (bundle: Bundle, key: string) => {
  const [o, leaf] = holder(bundle, key);
  return !!o && Object.keys(o).some((k) => k === leaf || (k.startsWith(`${leaf}_`) && PLURAL_SUFFIX.test(k)));
};
const leafValue = (bundle: Bundle, key: string): unknown => {
  const [o, leaf] = holder(bundle, key);
  return o?.[leaf];
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "test" || f === "__tests__") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f)) out.push(p);
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

const CALL = /(?<![\w$.])(?:i18n\.|i18next\.)?t\(\s*(["'])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g;
const PASSES_COUNT = /[{,]\s*count\s*[:,}]/;

/** key -> "file:line" of each literal call that passes a count. */
function countCalls(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of sourceFiles(SRC)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(CALL)) {
      if (!PASSES_COUNT.test(argsAfter(s, (m.index ?? 0) + m[0].length))) continue;
      const where = `${relative(SRC, f)}:${s.slice(0, m.index).split("\n").length}`;
      out.set(m[2], [...(out.get(m[2]) ?? []), where]);
    }
  }
  return out;
}

function englishBundle(): Bundle {
  const auth = join(I18N_DIR, "auth", "en.json");
  const main = readLocale("en.json");
  return existsSync(auth) ? deepMerge(main, JSON.parse(readFileSync(auth, "utf8")) as Bundle) : main;
}

const lngOf = (file: string) => file.replace(/\.json$/, "");
const bundles = new Map<string, Bundle>(LOCALE_FILES.map((f) => [lngOf(f), readLocale(f)]));

describe("the nine keys have a singular in every language", () => {
  it.each(LOCALE_FILES)("%s has the _one and _other of each, and no bare key beside them", (file) => {
    const b = bundles.get(lngOf(file)) as Bundle;
    const missing: string[] = [];
    for (const key of SINGULAR_KEYS) {
      const [o, leaf] = holder(b, key);
      for (const suffix of ["_one", "_other"]) if (typeof o?.[leaf + suffix] !== "string") missing.push(key + suffix);
      if (o && leaf in o) missing.push(`${key} (the bare key is still there)`);
    }
    expect(missing, `${file} is missing`).toEqual([]);
  });
});

describe("a count of one resolves to the reader's own singular", () => {
  beforeAll(() => {
    for (const [lng, b] of bundles) i18n.addResourceBundle(lng, "translation", b, true, true);
  });

  const interp = (s: string, vars: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? `{{${k}}}`));
  const vars = { count: 1, industry: "Healthcare", q: "nurse", views: "Applied" };

  it.each([...bundles.keys()])("in %s", (lng) => {
    const b = bundles.get(lng) as Bundle;
    const en = bundles.get("en") as Bundle;
    const t = i18n.getFixedT(lng);
    const wrong: string[] = [];
    for (const key of SINGULAR_KEYS) {
      const own = leafValue(b, `${key}_one`);
      if (typeof own !== "string") { wrong.push(`${key}: no _one`); continue; }
      const got = t(key, vars);
      if (got !== interp(own, vars)) wrong.push(`${key}: ${JSON.stringify(got)}`);
      const english = leafValue(en, `${key}_one`);
      if (!lng.startsWith("en") && typeof english === "string" && got === interp(english, vars)) wrong.push(`${key}: the English text`);
    }
    expect(wrong, `${lng} at count 1`).toEqual([]);
  });

  it("English reads one issue and one opening, and several of each in the plural", () => {
    const t = i18n.getFixedT("en");
    expect(t("freeResults.actionBanner.issuesFound", { count: 1 })).toBe("1 issue found — fix it now");
    expect(t("jobsPage.a11yResults", { count: 1 })).toBe("1 opening shown.");
    expect(t("freeResults.actionBanner.issuesFound", { count: 3 })).toBe("3 issues found — fix them now");
    expect(t("jobsPage.a11yResults", { count: 12 })).toBe("12 openings shown.");
    expect(t("jobKeywordMatcher.topActions", { count: 1 })).toBe("Top 1 Action to Improve Your Match");
  });

  it("Spanish, French and Portuguese agree in number at one and at many", () => {
    expect(i18n.getFixedT("es")("jobsPage.hiddenCount", { count: 1 })).toBe("1 oculta");
    expect(i18n.getFixedT("es")("jobsPage.hiddenCount", { count: 4 })).toBe("4 ocultas");
    expect(i18n.getFixedT("fr")("accountPage.tracked", { count: 1 })).toBe("1 suivie");
    expect(i18n.getFixedT("fr")("accountPage.tracked", { count: 1_000_000 })).toBe("1000000 suivies");
    expect(i18n.getFixedT("pt")("freeResults.actionBanner.issuesFound", { count: 1 })).toBe("1 problema encontrado — corrija-o agora");
  });
});

describe("every count a call site passes has somewhere to land", () => {
  const en = englishBundle();
  const calls = countCalls();

  it("the scan reads the call sites it is about", () => {
    // A scan that found nothing would pass everything below.
    for (const key of ["freeResults.actionBanner.issuesFound", "jobsPage.a11yResults", "accountPage.tracked"]) {
      expect(calls.has(key), `${key} is not seen passing a count`).toBe(true);
    }
    expect(calls.size).toBeGreaterThan(20);
  });

  it("every literal t(key, { count }) names a key with a plural group, or one listed with its reason", () => {
    const bad: string[] = [];
    for (const [key, where] of calls) {
      if (!served(en, key)) continue; // an unserved key is the every-key guard's to name
      if (hasPluralGroup(en, key) || key in COUNT_NEUTRAL || key in SHARD_OWNED) continue;
      bad.push(`${key}  (${where.join(", ")})`);
    }
    expect(bad, "a count of one reads in the plural for these").toEqual([]);
  });

  it("the neutral list stays a short list of reasons, and none of the nine is on it", () => {
    expect(Object.keys(COUNT_NEUTRAL).length).toBeLessThanOrEqual(COUNT_NEUTRAL_CAP);
    for (const [key, why] of Object.entries(COUNT_NEUTRAL)) expect(why.length, key).toBeGreaterThan(10);
    for (const key of SINGULAR_KEYS) expect(COUNT_NEUTRAL, key).not.toHaveProperty(key);
  });

  it("a shard-owned entry is served only from the shard it names", () => {
    expect(Object.keys(SHARD_OWNED).length).toBeLessThanOrEqual(SHARD_OWNED_CAP);
    for (const file of LOCALE_FILES) {
      const main = readMainLocale(file);
      const shards = readShards(file);
      for (const [key, shard] of Object.entries(SHARD_OWNED)) {
        expect(served(main, key), `${key} is in the main ${file}`).toBe(false);
        for (const s of shards) if (s.name !== shard) expect(served(s.bundle, key), `${key} in shard ${s.name}`).toBe(false);
      }
    }
  });
});
