/**
 * HOW THE PROFILE READER IS SCORED ON THE HELD-OUT SET (spec §5 held-out targets).
 *
 *   country    the home country read, against countryTruth (or, where the text
 *              names no country, any answer in countryAcceptable). Over all 60.
 *   city       the home city read, against city / cityAlt, compared without case
 *              or accents. Over the résumés whose text names a home city.
 *   auth       PRECISION, never recall: of the résumés the reader gave a
 *              work-authorisation status other than unknown, or a sponsorship
 *              need, the share whose declaration it read right. A status the
 *              résumé never declared is a miss, because authorisation is never
 *              inferred (spec §3.5). Target 100%.
 *   years      |the middle of the reader's band - the true employment years| <= 3,
 *              with no band read as 0 years. Over all 60.
 *   entry      recall of entry-level readers (level entry), and the count of
 *              readers called entry who are not.
 *
 * The reader's answer is passed in as plain data (the MatchProfile fields), so
 * this file imports nothing from the engine.
 */
import type { HeldOutTruth } from "./types.ts";

export interface ReaderAnswer {
  home: { city: string; region: string | null; country: string | null } | null;
  workAuth?: { status?: string; needsSponsorship?: boolean; citizenOf?: string[] } | null;
  level?: string | null;
  years?: { low: number; high: number } | null;
}

export const READER_TARGETS = { country: 95, city: 90, authPrecision: 100, years3: 85, entryRecall: 90, entryFalsePositivesMax: 1 } as const;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

/** Does the reader's status agree with what the résumé declares? */
export function authAgrees(truth: HeldOutTruth, a: ReaderAnswer): boolean {
  const status = a.workAuth?.status ?? "unknown";
  const needs = !!a.workAuth?.needsSponsorship;
  if (needs && !truth.sponsorshipFuture) return false;
  switch (status) {
    case "unknown": return needs ? truth.sponsorshipFuture : true;
    // A citizen of the country they live in; or a citizen of ANOTHER country (an EU citizen in Germany, an
    // Indian graduate in Stuttgart), which says nothing about the right to work here. Reading a citizenship
    // of the work country the résumé never claimed is a miss: it would pass "citizenship required" postings.
    // Missing a declared sponsorship need is counted apart (sponsorRecall), not here.
    case "citizen": {
      const of = a.workAuth?.citizenOf ?? [];
      if (truth.declaredAuth === "citizen") return of.length === 0 || of.includes(truth.country);
      return (truth.declaredAuth === "authorized" || truth.declaredAuth === "needs_sponsorship") && of.length > 0 && !of.includes(truth.country);
    }
    case "permanent_resident": return truth.declaredAuth === "permanent_resident";
    // A visa holder: either declared as needing sponsorship, or declared as authorised today (an EU citizen
    // abroad, a work permit) without a citizen claim.
    case "student_visa":
    case "work_visa": return truth.declaredAuth === "needs_sponsorship" || truth.declaredAuth === "authorized";
    default: return false;
  }
}

export interface ReaderScore {
  n: number;
  country: number | null; countryRight: number;
  city: number | null; cityRight: number; cityOf: number; cityInvented: number;
  authPrecision: number | null; authRight: number; authClaimed: number;
  years3: number | null; yearsRight: number;
  entryRecall: number | null; entryRight: number; entryOf: number; entryFalsePositives: number;
  /** Of the résumés that declare a sponsorship need, the share read as needing it (no spec target; a miss shows postings that refuse sponsorship). */
  sponsorRecall: number | null; sponsorRight: number; sponsorOf: number;
  /** Ids of the misses, for the bench owner only (never printed by the CI gate: the held-out set must not be tuned on). */
  misses: Record<"country" | "city" | "auth" | "years" | "entry" | "sponsor", string[]>;
}

export function scoreReader(pairs: Array<{ truth: HeldOutTruth; answer: ReaderAnswer }>): ReaderScore {
  const misses: ReaderScore["misses"] = { country: [], city: [], auth: [], years: [], entry: [], sponsor: [] };
  let countryRight = 0, cityRight = 0, cityOf = 0, cityInvented = 0, authRight = 0, authClaimed = 0, yearsRight = 0, entryRight = 0, entryOf = 0, entryFalsePositives = 0, sponsorRight = 0, sponsorOf = 0;
  for (const { truth: t, answer: a } of pairs) {
    const country = a.home?.country ?? null;
    const okCountry = t.countryTruth != null ? country === t.countryTruth : (t.countryAcceptable ?? [null]).includes(country);
    if (okCountry) countryRight++; else misses.country.push(t.id);

    if (t.city) {
      cityOf++;
      const got = a.home?.city ? fold(a.home.city) : null;
      const want = [t.city, ...(t.cityAlt ?? [])].map(fold);
      if (got && want.includes(got)) cityRight++; else misses.city.push(t.id);
    } else if (a.home?.city) {
      cityInvented++;
    }

    const status = a.workAuth?.status ?? "unknown";
    if (status !== "unknown" || a.workAuth?.needsSponsorship) {
      authClaimed++;
      if (authAgrees(t, a)) authRight++; else misses.auth.push(t.id);
    }

    if (t.sponsorshipFuture) {
      sponsorOf++;
      if (a.workAuth?.needsSponsorship) sponsorRight++; else misses.sponsor.push(t.id);
    }

    const mid = a.years ? (a.years.low + a.years.high) / 2 : 0;
    if (Math.abs(mid - t.years) <= 3) yearsRight++; else misses.years.push(t.id);

    const readEntry = a.level === "entry";
    if (t.level === "entry") {
      entryOf++;
      if (readEntry) entryRight++; else misses.entry.push(t.id);
    } else if (readEntry) {
      entryFalsePositives++;
      misses.entry.push(t.id);
    }
  }
  return {
    n: pairs.length,
    country: pct(countryRight, pairs.length), countryRight,
    city: pct(cityRight, cityOf), cityRight, cityOf, cityInvented,
    authPrecision: pct(authRight, authClaimed), authRight, authClaimed,
    years3: pct(yearsRight, pairs.length), yearsRight,
    entryRecall: pct(entryRight, entryOf), entryRight, entryOf, entryFalsePositives,
    sponsorRecall: pct(sponsorRight, sponsorOf), sponsorRight, sponsorOf,
    misses,
  };
}

/** The spec's targets, met or not, as lines a report prints. */
export function targetLines(s: ReaderScore): string[] {
  const T = READER_TARGETS;
  const line = (name: string, v: number | null, target: number, basis: string) =>
    `${name.padEnd(14)} ${v == null ? "n/a" : `${v}%`.padStart(6)}  target >=${target}%  ${v != null && v >= target ? "met" : "NOT met"}  (${basis})`;
  return [
    line("country", s.country, T.country, `${s.countryRight}/${s.n}`),
    line("city", s.city, T.city, `${s.cityRight}/${s.cityOf}; ${s.cityInvented} city read where the text names none`),
    line("auth precision", s.authPrecision, T.authPrecision, `${s.authRight}/${s.authClaimed} declared statuses read right`),
    line("years +-3", s.years3, T.years3, `${s.yearsRight}/${s.n}`),
    line("entry recall", s.entryRecall, T.entryRecall, `${s.entryRight}/${s.entryOf}; false positives ${s.entryFalsePositives} (max ${T.entryFalsePositivesMax})`),
    `${"sponsor need".padEnd(14)} ${s.sponsorRecall == null ? "n/a" : `${s.sponsorRecall}%`.padStart(6)}  no spec target  (${s.sponsorRight}/${s.sponsorOf} declared sponsorship needs read)`,
  ];
}
