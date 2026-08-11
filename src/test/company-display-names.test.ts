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
  // Comments stripped FIRST. The v3 note inside this array quotes company names
  // ("Alignment Health", "Careers at AnewHealth"), and without this the quoted
  // prose was harvested as if it were board tokens — the test then failed
  // reporting five "missing tokens" that were never tokens at all. Caught by
  // this file's own guard, which is the outcome it was written for.
  const code = block![1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
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

  it("the v3 renames are the verified names, not the obvious guesses", () => {
    // Both of these came back from source-checking DIFFERENT from what a
    // reasonable guess would produce, which is the whole reason the names were
    // verified rather than assumed:
    //   Alignment Healthcare is the SEC registrant; the board's own
    //     og:description and every posting body say "Alignment Health".
    //   The exactcare slug is an old subsidiary; that board is a shared career
    //     site for the merged organisation and every job page on it is titled
    //     "Careers at AnewHealth". Naming it ExactCare would attribute the
    //     whole board to one of its pharmacy brands.
    expect(byToken.get("alignmenthealthcare~wd12~ahc_external")?.name).toBe("Alignment Health");
    expect(byToken.get("exactcare~wd1~AnewHealth_Career_Site")?.name).toBe("AnewHealth");
  });

  it("Embry-Riddle's two boards carry the SAME name", () => {
    // External is staff/faculty, AdjunctFacultyOpportunities is adjunct hiring;
    // careers.erau.edu links both. They are one employer, so get_size_segments
    // SHOULD merge them — the one place a shared display name is correct.
    const a = byToken.get("embryriddle~wd1~External")?.name;
    const b = byToken.get("embryriddle~wd1~AdjunctFacultyOpportunities")?.name;
    expect(a).toBe("Embry-Riddle Aeronautical University");
    expect(b).toBe(a);
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
  /** Updated together, never one without the other.
   *
   *  Adding a token to RENAMED_TOKENS without bumping NAME_SYNC_VERSION is a
   *  SILENT no-op: the sweep's guard is `stored.version !== NAME_SYNC_VERSION`,
   *  so if the version already matches what is stored, the block is skipped
   *  entirely and the new rename never touches a single row. The catalog would
   *  be correct, every test green, and the site unchanged — the exact shape of
   *  failure this codebase keeps paying for.
   *
   *  Mutation-tested: renaming a board and leaving the version at 2 must fail. */
  const PINNED = { nameSyncVersion: 3, tokenCount: 38 };

  it("the token list and the sync version move together", () => {
    const m = /const NAME_SYNC_VERSION = (\d+);/.exec(IDX);
    expect(m, "NAME_SYNC_VERSION not found").toBeTruthy();
    expect(
      Number(m![1]),
      "RENAMED_TOKENS changed but NAME_SYNC_VERSION did not — the sweep will " +
        "skip itself and the rename will never reach stored rows. Bump the " +
        "version in index.ts and update PINNED here.",
    ).toBe(PINNED.nameSyncVersion);
    expect(
      renamedTokens.length,
      `RENAMED_TOKENS is now ${renamedTokens.length} tokens; if you added some, ` +
        `bump NAME_SYNC_VERSION and set PINNED.tokenCount to ${renamedTokens.length}`,
    ).toBe(PINNED.tokenCount);
  });

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
  /** get_size_segments' OWN body, not the whole migration file.
   *
   *  Lovable re-stamps applied migrations and MERGES them, so the newest file
   *  containing get_size_segments also contains get_transparent_employers —
   *  whose `WITH agg AS (SELECT company_token, …)` comes first in the text.
   *  Slicing on the file's first "agg AS (" therefore read the wrong function
   *  entirely, and the assertion below failed against a CTE it was never about.
   *  Scope to the function first, always. */
  const sql = (() => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const hit = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => readFileSync(resolve(MIG, f), "utf8"))
      .filter((t) => t.includes("FUNCTION public.get_size_segments")).pop();
    const file = (hit ?? "").replace(/^\s*--.*$/gm, "");
    const start = file.indexOf("FUNCTION public.get_size_segments");
    expect(start, "get_size_segments not found in any migration").toBeGreaterThan(-1);
    const end = file.indexOf("$$;", start);
    expect(end, "get_size_segments body has no terminator").toBeGreaterThan(start);
    return file.slice(start, end);
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
