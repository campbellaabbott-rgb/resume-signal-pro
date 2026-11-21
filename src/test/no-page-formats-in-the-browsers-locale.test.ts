/**
 * NO PAGE FORMATS A NUMBER OR A DATE IN THE BROWSER'S LOCALE (S14X-255,
 * C-S14-100).
 *
 * WHAT WAS WRONG. About a hundred and fifty calls across the pages printed a
 * count or a date through the toLocale string methods with no locale (or an
 * undefined one, or an empty list), and a few built an Intl formatter the same
 * way. The browser's language decided, not the one the reader picked: a German
 * page on an American browser read "1,234" and "11/17/2026" inside German
 * sentences, and an English data page read "1.234" on a German browser. Part A
 * fixed its lanes' shares (the account, the data pages, the scanner page and
 * the writing tools' answers); the call-sites lane fixed the rest, through
 * src/lib/format (the interface language) or an explicit English locale where
 * the surface itself is English.
 *
 * WHAT HOLDS NOW:
 *   - no source file under src (tests aside), read with its comments
 *     stripped, calls a toLocale string method with no locale, an undefined
 *     one, an empty list or the navigator's language, or builds an Intl
 *     number, date, relative-time, plural or list formatter that way;
 *   - except OWNER_ENGLISH: the owner's five dashboards, which are English and
 *     read by the owner alone, and the dashboard parts only they import (a
 *     listed part that a reader's page imports fails here, so the list cannot
 *     hide a reader's page), and UNSHIPPED, a component nothing imports (the
 *     same check: once something imports it, it is judged);
 *   - a filter's counts and a layoff line asked for in German print German
 *     figures, which the browser's default (en-US here) never did.
 * A region's name (Intl.DisplayNames) is not a number or a date and is not
 * judged here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { codeOf } from "./helpers/strip-comments";
import { MultiSelectFilter } from "@/components/board/MultiSelectFilter";
import { layoffLineText, type LayoffFiling } from "@/components/jobs/LayoffFilingLine";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

const OWNER_PAGES = [
  "src/pages/HealthCheck.tsx",
  "src/pages/AnalyticsDashboard.tsx",
  "src/pages/ScanMetrics.tsx",
  "src/pages/AdminClaims.tsx",
  "src/pages/ErrorDashboard.tsx",
];
const OWNER_PARTS = [
  "src/components/dashboard/UserHealthTable.tsx",
  "src/components/dashboard/IndustryDetectionChart.tsx",
  "src/components/dashboard/AIGenerationTrendChart.tsx",
  "src/components/dashboard/EmailTrendChart.tsx",
  "src/components/dashboard/HealthTrendChart.tsx",
  "src/components/dashboard/WebhookTrendChart.tsx",
];
const OWNER_ENGLISH = new Set([...OWNER_PAGES, ...OWNER_PARTS]);
const UNSHIPPED = ["src/components/JobBoardHero.tsx"];

/** Every non-test TypeScript source under src, as a repo-relative path. */
function sources(dir = SRC): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "test" || f === "__tests__") continue;
      out.push(...sources(p));
    } else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) {
      out.push(relative(ROOT, p));
    }
  }
  return out;
}

/** The browser's own language, in every spelling a call can give it. */
const BROWSERS = String.raw`(?:\)|undefined\b|\[\s*\]|navigator\.languages?\b)`;
const LOCALE_METHOD = new RegExp(String.raw`\.toLocale(?:Date|Time)?String\(\s*` + BROWSERS, "g");
// The Intl constructors that format a figure; a bare DateTimeFormat() whose
// only use is resolvedOptions() reads the time zone and prints nothing.
const LOCALE_INTL = new RegExp(
  String.raw`\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat)\(\s*(?:\)(?!\s*\.resolvedOptions\b)|undefined\b|\[\s*\]|navigator\.languages?\b)`,
  "g",
);

/** Each call in `code` that lets the browser pick the locale, with its line. */
function browserLocaleCalls(code: string): string[] {
  const hits: string[] = [];
  code.split("\n").forEach((line, i) => {
    for (const re of [LOCALE_METHOD, LOCALE_INTL]) {
      for (const m of line.matchAll(re)) hits.push(`${i + 1}: ${line.trim().slice(Math.max(0, m.index! - 50), m.index! + 60)}`);
    }
  });
  return hits;
}

/** The repo-relative file an import specifier names, or null when it is a package. */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(join(ROOT, from)), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
  }
  return null;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
/** Which source files import `target`, statically or lazily. */
function importersOf(target: string, files: string[]): string[] {
  return files.filter((f) => f !== target && [...codeOf(readFileSync(join(ROOT, f), "utf8")).matchAll(SPECIFIER)].some((m) => resolveImport(f, m[1]) === target));
}

const FILES = sources();

describe("the scanner reads what it judges", () => {
  it("reads every page and component, and the files it was written against", () => {
    expect(FILES.length).toBeGreaterThan(500);
    for (const f of ["src/pages/Jobs.tsx", "src/pages/Index.tsx", "src/components/DataViz.tsx", "src/lib/pdf-export.ts", "src/hooks/use-currency.ts"]) expect(FILES).toContain(f);
  });

  it("catches every spelling of the browser's locale in code, and none in a comment", () => {
    const code = codeOf([
      "a.toLocaleString();",
      "b.toLocaleDateString(undefined, { month: 'short' });",
      "c.toLocaleTimeString([], { hour: 'numeric' });",
      "d.toLocaleString(navigator.language);",
      "new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });",
      "Intl.DateTimeFormat().format(x);",
      "new Intl.RelativeTimeFormat([]);",
      "// e.toLocaleString() in a comment",
      "/* f.toLocaleDateString() in a block */",
      "g.toLocaleString('en-US');",
      "h.toLocaleDateString(i18n.language, { month: 'short' });",
      "Intl.DateTimeFormat().resolvedOptions().timeZone;",
      "new Intl.NumberFormat(lng).format(1);",
    ].join("\n"));
    expect(browserLocaleCalls(code).map((h) => Number(h.split(":")[0]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("no page lets the browser pick the language of a number or a date", () => {
  it.each(FILES.filter((f) => !OWNER_ENGLISH.has(f) && !UNSHIPPED.includes(f)))("%s", (file) => {
    expect(browserLocaleCalls(codeOf(readFileSync(join(ROOT, file), "utf8"))), "calls that follow the browser's language").toEqual([]);
  });
});

describe("the files left out are read by no reader", () => {
  it.each(OWNER_PAGES)("%s is an owner page only the router mounts", (page) => {
    expect(existsSync(join(ROOT, page)), `${page} is gone: take it off OWNER_PAGES`).toBe(true);
    expect(importersOf(page, FILES)).toEqual(["src/App.tsx"]);
  });

  it.each(OWNER_PARTS)("%s is imported by the owner's dashboards alone", (part) => {
    expect(existsSync(join(ROOT, part)), `${part} is gone: take it off OWNER_PARTS`).toBe(true);
    const importers = importersOf(part, FILES);
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((f) => !OWNER_ENGLISH.has(f)), "a reader's page imports an owner-English part").toEqual([]);
  });

  it.each(UNSHIPPED)("%s is imported by nothing", (file) => {
    expect(existsSync(join(ROOT, file)), `${file} is gone: take it off UNSHIPPED`).toBe(true);
    expect(importersOf(file, FILES), "it is shipped now, so it is judged: take it off UNSHIPPED").toEqual([]);
  });
});

describe("asked for in German, the figures are German", () => {
  afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage("en"); }); });

  it("a filter's counts", async () => {
    await act(async () => { await i18n.changeLanguage("de"); });
    render(createElement(MultiSelectFilter, {
      value: "", onChange: () => {}, allLabel: "Alle", ariaLabel: "Bereich", max: 3, atMaxNote: "", clearLabel: "Leeren",
      selectedLabel: (n: number) => `${n}`, options: [{ value: "science", label: "Wissenschaft", count: 12345 }],
    }));
    fireEvent.click(screen.getByRole("button", { name: "Bereich" }));
    const row = (await screen.findByText("Wissenschaft")).closest("button")!;
    expect(row.textContent).toContain("12.345");
  });

  it("a layoff line's workers and share", () => {
    const row: LayoffFiling = {
      companyToken: "acme", source: "state_warn", relation: "filer", filer: "Acme Corp", eventDate: "2026-10-01",
      eventBasis: "warn_notice_date", publicDate: "2026-10-03", publicBasis: "agency", state: "CA", site: "Fresno",
      workers: 1234, eventType: "layoff", effectiveDate: null, pct: null, headcount: null, form: null,
      sourceUrl: "https://edd.ca.gov/x", sourceName: "EDD", readAt: "2026-10-04T00:00:00Z", moreN: 0,
    };
    const t = i18n.getFixedT("de");
    expect(layoffLineText(row, t, "de").text).toContain("1.234");
    const sec: LayoffFiling = { ...row, source: "sec_8k_205", form: "8-K", workforce: true, pct: 12.5, workers: null };
    expect(layoffLineText(sec, t, "de").text).toContain("12,5");
  });
});
