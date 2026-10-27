/**
 * THE FREE REPORT PRINTS NO CONFIGURED FIGURE AS A MEASUREMENT (the
 * switch-over's report sweep, 2026-10-27; README "Still open after the review
 * round", item 3).
 *
 * The review round took the predictions out of the free report (H0), but the
 * report the switch-over links to still printed percentages and multipliers
 * that nobody measured, in the voice of a measurement:
 *
 *   - the role card's share of "top candidates" with a portfolio, a
 *     certification or a quantified bullet (hand-set per role in
 *     src/config/personalization.ts), next to a "competitive standing" that
 *     read three props FreeKeywordResults never passed, so every reader got
 *     the same empty checklist;
 *   - a "top-quartile candidate" (eight quantified bullets, three leadership
 *     verbs, a fixed keyword coverage, all literals in free-keyword-scan) and
 *     an "industry median" (a configured table) printed beside the reader's
 *     own numbers;
 *   - "keywords that appear in" a share "of top-quartile resumes" for a list
 *     somebody typed;
 *   - the market card's salary context (typed ranges and percentage gaps);
 *   - the ATS tooltip's share of the Fortune 500, and dead upsell copy that
 *     promised a callback multiplier and a share of applicants beaten;
 *   - the local-standards card's photo shares and a survey's interview
 *     multiplier, from a country review that is not in this repository.
 *
 * A figure the report prints is allowed only when it is computed from the
 * reader's own résumé (or the posting they pasted), or comes from a dataset
 * the report names and dates. This guard reads:
 *
 *   1. every string of the report's own namespaces, and every key it uses
 *      from a shared one, in all nine locales: any "%" or multiplier must be
 *      one of the keys listed below with what fills it;
 *   2. every module the report imports (its component tree, from
 *      FreeKeywordResults): any place that prints a percentage or a
 *      multiplier must be listed below with where its number comes from, and
 *      the configured figure sources are never printed;
 *   3. the scan's own printed data, in free-keyword-scan and its stream fork:
 *      the country standards and the market card's printed fields carry no
 *      percentage or multiplier outside a quoted example;
 *   4. a rendered report whose scan answer carries every one of those
 *      configured fields.
 *
 * A new figure fails here until someone says, in the allowlist, which of the
 * reader's numbers it is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { COUNTRY_STANDARDS, evaluateCountryStandards } from "../../supabase/functions/free-keyword-scan/country-standards";
import { COUNTRY_STANDARDS as STREAM_COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan-stream/country-standards";
import { getMarketInsight } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { getMarketInsight as streamMarketInsight } from "../../supabase/functions/free-keyword-scan-stream/market-intelligence";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true, fullAnalysisOnSale: () => true, proOnSale: () => true }));
vi.mock("@/components/EmailReportCapture", () => ({ EmailReportCapture: () => null }));
vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;

/* ------------------------------------------------------------------ */
/* The report's module tree                                            */
/* ------------------------------------------------------------------ */

const ENTRY = "src/components/FreeKeywordResults.tsx";

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(resolve(ROOT, from)), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return relative(ROOT, p);
  }
  return null;
}

/** Every src module the report's entry reaches, the shadcn primitives, the i18n loaders and the client integration excepted. */
function reportModules(): string[] {
  const seen = new Set<string>();
  const queue = [ENTRY];
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = codeOf(read(f));
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolveSpec(f, m[1] || m[2]);
      if (r && !seen.has(r) && /^src\//.test(r) && /\.(ts|tsx)$/.test(r)) queue.push(r);
    }
  }
  return [...seen]
    .filter((f) => !/^src\/(components\/ui|i18n|integrations)\//.test(f))
    .sort();
}

const MODULES = reportModules();

/* ------------------------------------------------------------------ */
/* What counts as a printed figure                                     */
/* ------------------------------------------------------------------ */

const DIGIT = "[0-9\\u0966-\\u096F]";
const NUM = `${DIGIT}(?:[0-9\\u0966-\\u096F.,]*${DIGIT})?`;
/** A percentage or a multiplier in prose. A size (4×3 cm, 2×2-inch) is not a multiplier. */
const PROSE_FIGURE = new RegExp(
  [
    `${NUM}\\+?\\s?[%％]`,
    `\\{\\{\\s*\\w+\\s*\\}\\}\\s?[%％]`,
    `${NUM}\\s?(?:percent|per cent|prozent|pour cent|por ciento|por cento|procent|porsyento|porsiyento|प्रतिशत)`,
    `${NUM}\\s?[×x](?!\\s?${DIGIT})(?![\\w])`,
    `(?<!${DIGIT}\\s?)×\\s?${NUM}`,
  ].join("|"),
  "giu",
);

/** Examples the reader is shown how to write ("e.g. \"drove 40% DAU increase\"") are quoted, never claims. */
const withoutQuotedExamples = (s: string) => s.replace(/"[^"]*"/g, " ").replace(/“[^”]*”/g, " ");

/**
 * Code with everything that is styling rather than prose taken out: tailwind
 * arbitrary values, colour and gradient functions, and the style keys that
 * take a percentage.
 */
function prose(code: string): string {
  return code
    .replace(/\[[^\]\n]*%[^\]\n]*\]/g, " ")
    .replace(/\b(?:hsla?|rgba?|linear-gradient|radial-gradient|calc|translate[XY]?)\([^()\n]*(?:\([^()\n]*\)[^()\n]*)*\)/g, " ")
    .replace(/\b(?:width|height|left|right|top|bottom|maxWidth|minWidth|maxHeight|minHeight|borderRadius|background|backgroundImage|transform|inset|flexBasis|backgroundSize|backgroundPosition)\s*:\s*(?:`[^`\n]*`|"[^"\n]*"|'[^'\n]*')/g, " ")
    .replace(/(["'`])\s*-?\d+(?:\.\d+)?%\s*\1/g, " ");
}

/** The config whose `weak:` and `strong:` values are example bullets. */
const PERSONALIZATION = "src/config/personalization.ts";

/**
 * The places a module prints a percentage or a multiplier: a JSX or template
 * expression followed by "%", and any line whose prose (a string, JSX text or
 * an i18next default) carries a literal figure or a placeholder followed by
 * "%"; and the percent formatters. Example bullets (a weak line and its
 * strong rewrite, the values of `weak:` and `strong:` in the personalization
 * config) are shown as examples of how to write; their figures belong to the
 * example, never to the reader or the market.
 */
function printedFigureSites(file: string): string[] {
  const code = prose(codeOf(read(file)));
  const sites: string[] = [];
  const expr = /\$?\{[^{}\n]*\}\s?%/g;
  for (const m of code.matchAll(expr)) sites.push(m[0]);
  for (const line of code.split("\n")) {
    if (file === PERSONALIZATION && /\b(?:weak|strong)\s*:/.test(line)) continue;
    const body = line.replace(expr, " ");
    for (const f of body.matchAll(PROSE_FIGURE)) {
      const at = f.index ?? 0;
      const from = at > 30 ? body.lastIndexOf(" ", at - 30) + 1 : 0;
      const end = body.indexOf(" ", at + 50);
      sites.push(`"${f[0]}" in ${JSON.stringify(body.slice(from, end < 0 ? body.length : end).trim())}`);
    }
  }
  // The percent formatters, called anywhere but in their own definition.
  if (file !== "src/lib/format.ts") for (const m of code.matchAll(/\bpercent\(|style:\s*["']percent["']/g)) sites.push(m[0]);
  return sites;
}

/**
 * Every figure the report's modules print, and where its number comes from.
 * Each one is computed from the reader's own résumé or the posting they
 * pasted, in this browser or by the scan; none is configured.
 */
const COMPUTED_SITES: Record<string, Record<string, string>> = {
  "src/components/ATSParseSimulator.tsx": {
    "{overallConfidence}%": "the parse simulator's confidence over the reader's own extracted text (src/lib/ats-parse-simulator.ts)",
  },
  "src/components/FreeKeywordResults.tsx": {
    "${scoreBreakdown.keywords}%": "the scan's breakdown of the reader's own score (PDF export)",
    "${scoreBreakdown.format}%": "the scan's breakdown of the reader's own score (PDF export)",
    "${scoreBreakdown.quantification}%": "the scan's breakdown of the reader's own score (PDF export)",
    [`"40%" in "severity: 'warning', label: 'Under 40% of bullets carry a number — recruiters anchor on"`]: "printed only when the reader's own quantificationScore (the share of their bullets with a number) is under 40",
    "{industryBlend.primaryPct}%": "the share of the reader's own résumé text the industry detector reads as the first field",
    "{industryBlend.secondaryPct}%": "the share of the reader's own résumé text the industry detector reads as the second field",
    "{side.keywordCoveragePct}%": "the share of a field's keyword list found in the reader's own résumé",
    "{bulletQuantRate}%": "the share of the reader's own bullets that carry a metric",
    "{competitiveGap.gapScore}%": "the share of the listed keywords found in the reader's own résumé",
    "{val}%": "the scan's breakdown of the reader's own score",
  },
  "src/components/IndustryKeywordSuggestions.tsx": {
    "{coveragePercent}%": "the share of the industry's keyword list found in the reader's own résumé",
  },
  "src/components/JobKeywordMatcher.tsx": {
    "{overallMatchRate}%": "the share of the pasted posting's keywords found in the reader's own résumé",
  },
  "src/components/LiveMatches.tsx": {
    [String.raw`"{{pct}}%" in "{t(\"jobsPage.fitBadge\", \"fit {{pct}}%\", { pct: m.fit })}"`]: "the fit score of the reader's own résumé against that posting",
  },
  "src/components/ReportInsightCards.tsx": {
    "${Math.min(100, Math.max(0, n))}%": "the score simulator's bar width for the reader's own score (a style value)",
  },
  "src/components/RoleTargeting.tsx": {
    [`"{{pct}}%" in "{t('freeResults.targeting.reachTitle', 'Within reach — your {{pct}}% {{industry}} side', {"`]: "industryBlend.secondaryPct, the share of the reader's own résumé text read as that field",
  },
  "src/components/SkillsGapAnalysis.tsx": {
    "{overallMatchRate}%": "the share of the role's listed skills and keywords found in the reader's own résumé",
  },
  "src/components/scorecard/MetricCardsGrid.tsx": {
    "${quantificationScore.score}%": "the share of the reader's own bullets with a number",
    "${readabilityScore.score}%": "the readability of the reader's own text",
    "${bulletImpactScore.score}%": "the share of the reader's own bullets that state an impact",
  },
  "src/components/scorecard/ScoreHero.tsx": {
    "${quantificationScore}%": "the share of the reader's own bullets with a number",
    "${bulletImpactScore}%": "the share of the reader's own bullets that state an impact",
  },
};

/* ------------------------------------------------------------------ */
/* 1. The locales                                                      */
/* ------------------------------------------------------------------ */

/** Namespaces the report shares with other pages: only the keys it uses are its strings. */
const SHARED_NAMESPACES = new Set(["common", "auth", "jobsPage", "uploader", "purchaseTerms", "checkoutGate"]);

function keysUsed(): { whole: Set<string>; exact: Set<string> } {
  const whole = new Set<string>();
  const exact = new Set<string>();
  for (const f of MODULES) {
    const code = codeOf(read(f));
    for (const m of code.matchAll(/\bt\(\s*(["'`])([A-Za-z0-9_]+)\.([A-Za-z0-9_.${}]*)/g)) {
      const ns = m[2];
      if (SHARED_NAMESPACES.has(ns)) {
        if (!/\$\{/.test(m[3])) exact.add(`${ns}.${m[3].replace(/\.$/, "")}`);
      } else whole.add(ns);
    }
  }
  return { whole, exact };
}

/** Locale keys whose "%" is filled from the reader's own numbers, and what fills it. */
const COMPUTED_KEYS: Record<string, string> = {
  "freeResults.targeting.reachTitle": "{{pct}} is industryBlend.secondaryPct, the share of the reader's own résumé text read as that field",
  "jobsPage.fitBadge": "{{pct}} is the fit score of the reader's own résumé against that posting",
  "freeResults.lockedInsights.bulletLine1": "an example rewrite (\"Replace '…' → '…'\"), shown only when the reader's résumé gave no weak bullet to quote; its figures are the example's",
  "freeResults.lockedInsights.bulletLine2": "an example rewrite (\"Replace '…' → '…'\"), shown only when the reader's résumé gave no weak bullet to quote; its figures are the example's",
};

function strings(o: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof o === "string") out.push([path, o]);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) strings(v, path ? `${path}.${k}` : k, out);
  return out;
}

const pluralBase = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");

describe("the report's strings, in all nine locales", () => {
  const { whole, exact } = keysUsed();

  it("reads the report's namespaces (a guard that reads nothing passes against anything)", () => {
    expect([...whole]).toEqual(expect.arrayContaining(["freeResults", "personalizedInsights", "scoreHero", "shareableCard", "industryKeywords"]));
    expect(exact.has("jobsPage.fitBadge")).toBe(true);
  });

  for (const lng of LOCALES) {
    it(`${lng}: no percentage or multiplier but the reader's own`, () => {
      const json = JSON.parse(read(`src/i18n/locales/${lng}.json`)) as Record<string, unknown>;
      const found: string[] = [];
      for (const ns of whole) for (const [k, v] of strings(json[ns], ns)) {
        if (COMPUTED_KEYS[pluralBase(k)]) continue;
        const hits = [...v.matchAll(PROSE_FIGURE)].map((m) => m[0]);
        if (/%/.test(v) && !hits.length) hits.push("%");
        if (hits.length) found.push(`${k} = ${JSON.stringify(v)} (${hits.join(", ")})`);
      }
      for (const key of exact) {
        if (COMPUTED_KEYS[key]) continue;
        const v = key.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), json);
        if (typeof v === "string" && ([...v.matchAll(PROSE_FIGURE)].length || /%/.test(v))) found.push(`${key} = ${JSON.stringify(v)}`);
      }
      expect(found, "a figure in the report that is not the reader's own").toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* 2. The report's modules                                             */
/* ------------------------------------------------------------------ */

describe("the report's modules", () => {
  it("walks the report's own tree", () => {
    expect(MODULES).toEqual(expect.arrayContaining([
      ENTRY,
      "src/components/PersonalizedInsights.tsx",
      "src/components/ReportInsightCards.tsx",
      "src/components/scorecard/MetricCardsGrid.tsx",
      "src/config/personalization.ts",
    ]));
  });

  it("print no percentage or multiplier but one computed from the reader's own résumé", () => {
    const unlisted: string[] = [];
    const stale: string[] = [];
    for (const f of MODULES) {
      const sites = printedFigureSites(f);
      const allowed = COMPUTED_SITES[f] ?? {};
      for (const s of sites) if (!(s in allowed)) unlisted.push(`${f}: ${s}`);
      for (const s of Object.keys(allowed)) if (!sites.includes(s)) stale.push(`${f}: ${s}`);
    }
    for (const f of Object.keys(COMPUTED_SITES)) if (!MODULES.includes(f)) stale.push(`${f} (no longer in the report)`);
    expect({ unlisted, stale }, "unlisted: a printed figure with no computed source named here; stale: an allowlisted figure the report no longer prints").toEqual({ unlisted: [], stale: [] });
  });

  it("never print a configured figure source", () => {
    const printed: string[] = [];
    for (const f of MODULES.filter((m) => m.startsWith("src/components/"))) {
      const code = codeOf(read(f));
      for (const re of [/\.archetype\b/, /\.benchmarkMedian\b/, /\.salaryContext\b/, /\.industryBenchmarks\b/, /\bindustryBenchmarks\b/, /\.avgBulletCount\b/]) {
        if (re.test(code)) printed.push(`${f}: ${re.source}`);
      }
      // A role's configured weights may decide whether a guideline shows, never print as a share.
      for (const m of code.matchAll(/\b(portfolioRate|certificationRate|metricsRate)\b(?!\s*>=\s*\d+)/g)) printed.push(`${f}: ${m[0]} used as a value`);
    }
    expect(printed).toEqual([]);
  });

  it("the share card draws no percentile", () => {
    expect(codeOf(read("src/components/ReportInsightCards.tsx"))).not.toMatch(/Better than \$\{/);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The scan's printed data (free-keyword-scan and its stream fork)  */
/* ------------------------------------------------------------------ */

describe("the scan's printed data", () => {
  const figures = (s: string) => [...withoutQuotedExamples(s).matchAll(PROSE_FIGURE)].map((m) => m[0]);

  for (const [name, table] of [["free-keyword-scan", COUNTRY_STANDARDS], ["free-keyword-scan-stream", STREAM_COUNTRY_STANDARDS]] as const) {
    it(`${name}: the local-standards card's notes carry no percentage or multiplier`, () => {
      const found: string[] = [];
      for (const [iso, std] of Object.entries(table)) {
        for (const [field, value] of Object.entries(std)) {
          for (const s of Array.isArray(value) ? value : [value]) {
            if (typeof s !== "string") continue;
            const hits = figures(s);
            if (hits.length) found.push(`${iso}.${field}: ${hits.join(", ")} in ${JSON.stringify(s.slice(0, 120))}`);
          }
        }
      }
      expect(Object.keys(table).length).toBeGreaterThan(40);
      expect(found).toEqual([]);
    });
  }

  it("the advisories the card prints add no figure of their own", () => {
    for (const iso of Object.keys(COUNTRY_STANDARDS)) {
      const r = evaluateCountryStandards("Jane Doe\njane@example.com\nExperience\n- Built pipelines\nPhoto attached", iso);
      for (const a of r?.advisories ?? []) expect(figures(a.message), `${iso} ${a.check}`).toEqual([]);
    }
  });

  for (const [name, insight, file] of [
    ["free-keyword-scan", getMarketInsight, "supabase/functions/free-keyword-scan/market-intelligence.ts"],
    ["free-keyword-scan-stream", streamMarketInsight, "supabase/functions/free-keyword-scan-stream/market-intelligence.ts"],
  ] as const) {
    it(`${name}: the market card's printed fields carry no percentage or multiplier outside a quoted example`, () => {
      const keys = [...new Set([...read(file).matchAll(/'([A-Z]{2}):([a-z_]+)'\s*:/g)].map((m) => [m[1], m[2]] as const).map((k) => k.join(":")))];
      expect(keys.length).toBeGreaterThan(10);
      const found: string[] = [];
      for (const key of [...keys, "ZZ:none"]) {
        const [c, ind] = key.split(":");
        const m = insight(c, ind);
        for (const s of [m.marketSummary, ...m.hotSkills, ...m.risingKeywords, ...m.cvNorms]) {
          const hits = figures(s);
          if (hits.length) found.push(`${key}: ${hits.join(", ")} in ${JSON.stringify(s.slice(0, 120))}`);
        }
      }
      expect(found).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ */
/* 4. A rendered report whose scan answer carries every configured field */
/* ------------------------------------------------------------------ */

const RESUME = [
  "Jane Doe",
  "jane@example.com · +49 30 1234567 · Berlin, Germany",
  "Experience",
  "Software Engineer, Acme GmbH (2019 - present)",
  "- Built data pipelines for the billing team",
  "- Led a migration of 40 services to Kubernetes",
  "Education",
  "BSc Computer Science",
  "Skills",
  "Python, SQL, Kubernetes",
].join("\n");

describe("a report whose scan answer carries every configured field", () => {
  it("prints none of them", () => {
    const de = evaluateCountryStandards(RESUME, "DE");
    const gb = getMarketInsight("GB", "technology");
    const props = {
      candidateName: "Jane Doe",
      currentRole: "Software Engineer",
      industry: "technology",
      atsScoreEstimate: 61,
      formatGrade: "B",
      formatIssue: "",
      redFlags: [],
      keywords: [{ keyword: "terraform", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }],
      quickWins: [],
      hasJobDescription: false,
      resumeText: RESUME,
      countryStandards: de,
      marketIntelligence: { country: "GB", countryName: gb.countryName, countrySource: "resume", hotSkills: gb.hotSkills, risingKeywords: gb.risingKeywords, cvNorms: gb.cvNorms, salaryContext: gb.salaryContext ?? null, marketSummary: gb.marketSummary },
      competitiveGap: { missingHighFrequency: ["system design", "observability"], presentHighFrequency: ["kubernetes"], gapScore: 47 },
      competitorSilhouette: { archetype: { quantifiedBullets: 8, leadershipSignals: 3, keywordCoveragePct: 70 }, user: { quantifiedBullets: 1, leadershipSignals: 1, keywordCoveragePct: 31 } },
      dualIndustryComparison: { primary: { industry: "technology", score: 61, keywordCoveragePct: 31, benchmarkMedian: 68 }, secondary: { industry: "data_engineering", score: 57, keywordCoveragePct: 22, benchmarkMedian: 69 } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<MemoryRouter><FreeKeywordResults {...(props as any)} onReset={() => {}} /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    // The report rendered the cards this test is about.
    expect(text).toMatch(/Local standards: Germany/);
    expect(text).toMatch(/Market Intelligence/);
    expect(text).toMatch(/47% of this list/);
    for (const said of [
      /top candidates/i, /top performers/i, /top-quartile/i, /top quartile/i, /Industry median/i, /Competitive Standing/i,
      /Salary context/i, /of top resumes/i, /Fortune 500/i, /of applicants/i, /interview chances/i,
      /Avg bullets per role/i, /\b78%/, /\b55%/, /\b85%/, /70%\+/, /15-25%/,
    ]) expect(text, `the report still says ${said}`).not.toMatch(said);
    if (gb.salaryContext) expect(text).not.toContain(gb.salaryContext);
  });
});
