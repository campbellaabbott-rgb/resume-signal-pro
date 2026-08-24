import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workdayPostedDays } from "../../supabase/functions/job-board/normalize";

/**
 * THE 30-DAY CAP WAS ENFORCED IN ENGLISH ONLY.
 *
 * Every branch of the Workday date parser required the literal word "posted",
 * and Workday localises that field per tenant. So a Spanish hotel group
 * saying "Publicado hace más de 30 días" — the employer stating in its own
 * feed that the job is past our cap — parsed as null, which means undated,
 * which means kept and served with no age, underneath a badge reading
 * "30-day freshness cap".
 *
 * Measured 2026-08-24: 23,944 servable Workday rows undated across 203
 * boards. Probing the top 90 (21,206 rows, 88.6%) split them cleanly — 60
 * boards genuinely disable the field and are honestly undated, while 30
 * boards state an age we discarded. A full census of barcelo~wd3 found 416 of
 * 522 items reading "Publicado hace más de 30 días". Verified live against
 * that feed after the fix: 60 of 60 items sampled from deeper pages now
 * parse, and 54 of them (90%) land past the cap.
 *
 * ASSERTED ON RETURN VALUES, NOT ON SOURCE LITERALS. A guard that greps for
 * the strings passes while the parser is dead — that trap has now caught this
 * codebase eight times, so every case below calls the function.
 */
describe("the cap is enforced in every language the vendor speaks", () => {
  it.each([
    // English, unchanged.
    ["Posted Today", 0],
    ["Posted Yesterday", 1],
    ["Posted 3 Days Ago", 3],
    ["Posted 30+ Days Ago", 31],
    // Spanish — the measured majority of the undated population.
    ["Publicado hace más de 30 días", 31],
    ["Publicado hace 5 días", 5],
    ["Publicado hoy", 0],
    // French.
    ["Offre publiée il y a 30 jours ou plus", 31],
    ["Publiée il y a 2 jours", 2],
    // German.
    ["Vor mehr als 30 Tagen ausgeschrieben", 31],
    ["Heute ausgeschrieben", 0],
    // Dutch, Portuguese, Italian.
    ["Meer dan 30 dagen geleden geplaatst", 31],
    ["Há mais de 30 dias", 31],
    ["Pubblicato più di 30 giorni fa", 31],
    // Chinese — no word boundaries, matched on the day character.
    ["超過 30 天前刊登", 31],
    ["3 天前刊登", 3],
  ] as const)("%s → %s days", (input, want) => {
    expect(workdayPostedDays(input)).toBe(want);
  });

  it.each([
    // One tenant (tutorperini~wd12, 226 rows) puts a LOCATION in this field.
    // A parser that believed bare digits would date postings from street
    // numbers, so a day word is required before any number is trusted.
    ["Menlo Park, CA"],
    ["Suite 300"],
    [""],
    ["Some Random Text"],
  ] as const)("%s stays undated rather than guessed", (input) => {
    expect(workdayPostedDays(input)).toBeNull();
  });

  it("a 30+ bucket lands PAST the cap, never exactly on it", () => {
    // 30 would survive a `> 30` test and keep serving the posting.
    expect(workdayPostedDays("Posted 30+ Days Ago")).toBeGreaterThan(30);
    expect(workdayPostedDays("Publicado hace más de 30 días")).toBeGreaterThan(30);
  });
});

describe("an aged-out posting is never logged as an employer takedown", () => {
  // Dropping a stale row inside the Workday normalizer hid it from the ingest
  // diff, so an ALREADY-STORED posting simply vanished from the feed — which
  // the absence machinery reads as a takedown and, the row being undated,
  // writes to the closure log as a real one. The employer took nothing down;
  // we aged it out. The closure log is the one dataset that must never
  // receive an event that did not happen.
  const ROOT = resolve(__dirname, "../..");
  const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
  const NORM = readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8");
  const strip = (c: string) =>
    c.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  it("workday rows reach the shared freshness filter instead of being dropped early", () => {
    const n = strip(NORM);
    // The normalizer must no longer strip stale rows itself...
    expect(n).not.toMatch(/!\(j as \{ _stale\?: boolean \}\)\._stale/);
    // ...and must carry the date that lets the shared filter claim them.
    expect(n).toMatch(/postedAt: days !== null \? new Date\(Date\.now\(\) - days \* 86_400_000\)\.toISOString\(\) : null/);
  });

  it("the ingest's own age-out record outranks the stored date", () => {
    const f = strip(FN);
    expect(f).toMatch(/const isAgedOut = \(r: Record<string, unknown>\) => \{/);
    expect(f).toMatch(/if \(agedOutIds\.has\(String\(r\.id\)\)\) return true;/);
    // Both the exit ledger and the closure filter must consult it.
    expect(f).toMatch(/const agedRows = \(\(toLog \?\? \[\]\) as Array<Record<string, unknown>>\)\.filter\(isAgedOut\);/);
    expect(f).toMatch(/if \(isAgedOut\(r\)\) return false;/);
  });
});
