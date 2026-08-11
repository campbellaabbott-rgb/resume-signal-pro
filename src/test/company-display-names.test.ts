/**
 * COMPANY CARDS WERE SHOWING SLUGS, AND THREE EMPLOYERS WERE SHOWING AS ONE.
 *
 * A posting's `company` is the catalog's display name from sources.ts. For a
 * long tail of boards that name was just the token, title-cased, so Explore and
 * every /jobs/company page rendered "Thehartford", "Hdsupply", "Nyp", "Umd",
 * "Ummh", "Ncsecu". Measured on the live Explore cache 2026-08-11: 104 distinct
 * company cards are visible across the page's sections, and ~20 of them were
 * unreadable in this way.
 *
 * A caveat that killed the obvious detector: `name === titleCase(token)` is NOT
 * the defect. 15,821 of 19,012 catalog boards satisfy it, and the overwhelming
 * majority are correct — "TransPerfect", "Framestore", "Bitfinex" are real
 * names whose slug simply matches. Only names where the SLUG CONCATENATED WORDS
 * are wrong. There is no reliable way to tell those apart automatically, so the
 * corrections are an explicit, reviewed list rather than a rule.
 *
 * WORSE THAN COSMETIC, for four of them. Several distinct employers shared one
 * parent slug — Fabletics, Savage X Fenty and JustFab all rendered as
 * "Justfab"; PHP Agency, Ritter Insurance Marketing and Connexion Point all as
 * "Integritymarketing". get_size_segments merges boards BY DISPLAY NAME (so PwC
 * appears once), so those unrelated employers were being counted as a single
 * company. Naming them correctly separates them.
 *
 * AND STORED ROWS DO NOT HEAL. The refresh is insert-only by design, so
 * correcting sources.ts changes what NEW postings get and nothing else. The
 * version-stamped sweep in index.ts is the only thing that rewrites existing
 * rows, which is why a rename must ship with NAME_SYNC_VERSION bumped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../supabase/functions/job-board");
const IDX = readFileSync(resolve(ROOT, "index.ts"), "utf8");
const SOURCES = readFileSync(resolve(ROOT, "sources.ts"), "utf8");

/** Catalog entries as {name, source, token}. */
const entries = (() => {
  const out: Array<{ name: string; source: string; token: string }> = [];
  const re = /\{\s*name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*source:\s*"(\w+)"\s*,\s*token:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of SOURCES.matchAll(re)) out.push({ name: m[1], source: m[2], token: m[3] });
  return out;
})();

const renamedTokens = (() => {
  const block = /const RENAMED_TOKENS: readonly string\[\] = \[([\s\S]*?)\];/.exec(IDX);
  expect(block, "RENAMED_TOKENS not found in index.ts").toBeTruthy();
  return [...block![1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
})();

describe("the catalog parses at all", () => {
  it("finds the whole board list", () => {
    // If this regex ever stops matching, every assertion below passes
    // vacuously — the failure mode this whole file exists to prevent.
    expect(entries.length).toBeGreaterThan(15_000);
  });
});

describe("renamed boards are corrected in the catalog", () => {
  const byToken = new Map(entries.map((e) => [e.token, e]));

  it("every token in RENAMED_TOKENS still exists in sources.ts", () => {
    // A token that no longer exists means the sweep is updating nothing and the
    // list has silently gone stale.
    const missing = renamedTokens.filter((t) => !byToken.has(t));
    expect(missing, `RENAMED_TOKENS entries absent from sources.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("none of them still carries the slug as its display name", () => {
    const titleCased = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    for (const tk of renamedTokens) {
      const e = byToken.get(tk);
      if (!e) continue;
      expect(
        e.name,
        `${tk} display name is still its slug title-cased: "${e.name}"`,
      ).not.toBe(titleCased(tk.split("~")[0]));
    }
  });

  it("the boards that were three employers under one name are distinct again", () => {
    // get_size_segments merges by display name, so identical names here mean
    // these are still counted as one company.
    const names = (tokens: string[]) => tokens.map((t) => byToken.get(t)?.name);
    const justfab = names([
      "justfab~wd1~fabletics", "justfab~wd1~savagex", "justfab~wd1~justfab",
    ]);
    expect(new Set(justfab).size, `still sharing one name: ${justfab.join(" / ")}`).toBe(3);

    const integrity = names([
      "integritymarketing~wd1~PHPAgency",
      "integritymarketing~wd1~RitterInsuranceMarketing",
      "integritymarketing~wd1~connexionpoint",
    ]);
    expect(new Set(integrity).size, `still sharing one name: ${integrity.join(" / ")}`).toBe(3);
  });
});

describe("a rename actually reaches stored rows", () => {
  it("the sweep is keyed on the constant, not a literal version", () => {
    // It read `!== 1` and stamped `version: 1`. With the check hardcoded, a
    // later rename could never trigger a re-sweep — the rename would land in
    // the catalog and never appear on the site.
    expect(IDX).toMatch(/const NAME_SYNC_VERSION = \d+;/);
    expect(IDX).toMatch(/\?\.version !== NAME_SYNC_VERSION/);
    expect(IDX).toMatch(/k: "name_sync_version", v: \{ version: NAME_SYNC_VERSION/);
  });

  it("the sweep includes the renamed tokens, not only the HTML-escaped ones", () => {
    // v1 only collected tokens whose stored name contained &amp; / &#039;. A
    // corrected name is not escaped, so without this line the sweep would run,
    // stamp itself done, and change nothing.
    const block = IDX.slice(IDX.indexOf('k", "name_sync_version"'), IDX.indexOf("salary_parse_version"));
    expect(block).toMatch(/for \(const tk of RENAMED_TOKENS\) tokens\.add\(tk\);/);
  });

  it("still updates closures as well as postings", () => {
    // job_board_closures feeds the actively-hiring leaderboard, so a name fixed
    // only in postings would leave the old one showing there.
    const block = IDX.slice(IDX.indexOf('k", "name_sync_version"'), IDX.indexOf("salary_parse_version"));
    expect(block).toMatch(/from\("job_board_postings"\)\.update\(\{ company: src\.name \}\)/);
    expect(block).toMatch(/from\("job_board_closures"\)\.update\(\{ company: src\.name \}\)/);
  });
});

describe("the segment card states the number its link delivers", () => {
  const MIG = resolve(__dirname, "../../supabase/migrations");
  const sql = (() => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const hit = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => readFileSync(resolve(MIG, f), "utf8"))
      .filter((t) => t.includes("FUNCTION public.get_size_segments")).pop();
    return (hit ?? "").replace(/^\s*--.*$/gm, "");
  })();

  it("emits the lead feed's own count for the card", () => {
    // The `named` CTE sums an employer's feeds but keeps ONE token, and the
    // card links to /jobs/company/{that token}. Publishing the summed figure
    // beside a link that shows one feed's worth is the click-through lie this
    // fixes: PwC has four feeds.
    expect(sql).toMatch(/max\(on_board\)::int AS lead_on_board/);
    const top = sql.slice(sql.indexOf("top AS ("), sql.indexOf("SELECT jsonb_object_agg"));
    expect(top, "top CTE not located").toContain("jsonb_build_object");
    expect(top).toMatch(/'on_board', lead_on_board/);
  });

  it("the band aggregate still uses the employer's full served count", () => {
    // Band placement is about the employer, not one feed — only the CARD had to
    // change. If this flips to lead_on_board the bands understate every
    // multi-feed employer.
    const agg = sql.slice(sql.indexOf("agg AS ("), sql.indexOf("top AS ("));
    expect(agg).toMatch(/sum\(on_board\)::int AS open_roles/);
  });
});

describe("the document declares the language it is actually rendering", () => {
  const I18N = readFileSync(resolve(__dirname, "../i18n/index.ts"), "utf8");

  it("sets documentElement.lang whenever the language changes", () => {
    // Detection order is ['localStorage','navigator'], so visitors are
    // auto-switched with no action — and nothing on that path touched
    // documentElement.lang, so eight languages rendered inside lang="en".
    expect(I18N).toMatch(/i18n\.on\('languageChanged'[\s\S]{0,300}syncDocumentLang\(lng\)/);
    expect(I18N).toMatch(/document\.documentElement\.lang = lng;/);
  });

  it("also applies it for the initial detected language", () => {
    // init() detects before the listener is attached, so the first render would
    // otherwise keep whatever index.html hardcoded.
    expect(I18N).toMatch(/syncDocumentLang\(i18n\.language\);/);
  });

  it("is safe where there is no document (prerender/SSR)", () => {
    expect(I18N).toMatch(/if \(typeof document === 'undefined'\) return;/);
  });
});
