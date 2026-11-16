/**
 * CLAIM GROUNDING: does a "verbatim" quote in the report appear in the résumé?
 *
 * Several report fields promise quotes from the candidate's own résumé. Each
 * one is checked here, and anything the model invented is dropped. Text is
 * compared after normalising both sides the same way.
 *
 * The normaliser keeps the letters, combining marks and digits of EVERY
 * script (register L5-08). It used to keep only [a-z0-9%$ ], so a Hindi
 * résumé normalised to its digits and every quote from it to '', which never
 * "appears", and every rewrite card was dropped as invented.
 *
 * Plain TypeScript, no imports: the Node test suite runs it directly.
 */
export const normalizeForGrounding = (s: string): string =>
  s.normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}%$ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A predicate: true when a claimed quote appears in `resumeText` (short quotes exactly, long ones 70% of their significant words). */
export function groundedIn(resumeText: string): (claim: unknown) => boolean {
  const groundedResume = normalizeForGrounding(resumeText);
  return (claim: unknown): boolean => {
    if (typeof claim !== "string") return false;
    const n = normalizeForGrounding(claim);
    if (!n) return false;
    if (n.length <= 45) return groundedResume.includes(n);
    // Long quotes: tolerate minor paraphrase — 70% of significant tokens must appear.
    const tokens = n.split(" ").filter((w) => w.length >= 4);
    if (tokens.length < 3) return groundedResume.includes(n.slice(0, 45));
    const hits = tokens.filter((tk) => groundedResume.includes(tk)).length;
    return hits / tokens.length >= 0.7;
  };
}

/**
 * What the deterministic reading of the résumé's dates found (S14X-269): every
 * gap of a month or more between roles, and every role's length, in months.
 * employment-gaps.ts timelineFactsOf builds it; this file stays import-free.
 */
export interface TriggerFacts {
  gapMonths: readonly number[];
  tenureMonths: readonly number[];
}

// A quoted part: straight or curly double quotes, guillemets, curly single
// quotes, or straight single quotes that no letter touches from outside (so
// the apostrophe of "Acme's" never opens one).
const QUOTED = /"([^"\n]{2,}?)"|“([^”\n]{2,}?)”|„([^“”\n]{2,}?)[“”]|«\s*([^»\n]{2,}?)\s*»|‘([^’\n]{2,}?)’|(?<![\p{L}\p{N}])'([^'\n]{2,}?)'(?![\p{L}\p{N}])/gu;
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18 };
const DURATION = /(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)[\s-]*(months?|mos?|years?|yrs?)(?![\p{L}])/giu;
const GAP_CLAIM = /(?<![\p{L}])(gaps?|break|hiatus|time off|career break)(?![\p{L}])/iu;
const TENURE_CLAIM = /(?<![\p{L}])(tenures?|stints?|stayed|stay|lasted|left after|only|short)(?![\p{L}])/iu;

/** The durations a trigger states, in months, each with the span of text it was read from. */
function durationsIn(trigger: string): Array<{ months: number; years: boolean; at: [number, number] }> {
  const out: Array<{ months: number; years: boolean; at: [number, number] }> = [];
  for (const m of trigger.matchAll(DURATION)) {
    const n = WORD_NUMBERS[m[1].toLowerCase()] ?? Number(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    const years = /^y/i.test(m[2]);
    out.push({ months: years ? n * 12 : n, years, at: [m.index!, m.index! + m[0].length] });
  }
  return out;
}

// A stated length matches a found one within a month, a tenth of it, or half
// a year when it was said in years ("a 2-year gap" for 27 months).
const near = (said: { months: number; years: boolean }, found: number) =>
  Math.abs(said.months - found) <= (said.years ? 6 : Math.max(1, Math.round(said.months / 10)));

/**
 * True when a triggered interview question's "Triggered by" text is on the
 * résumé (S14X-269). The report prints it as the résumé's own content, and
 * dropUngrounded used to ground every other quote but this one.
 *   - Every quoted part must be in the résumé (groundedIn).
 *   - A gap or tenure it states ("the 19-month gap", "only 4 months at
 *     BetaCo") must be one the dates show: each stated length a gap or a
 *     role's length the deterministic reading found, and a gap named with no
 *     length needs a gap to have been found.
 *   - Any other figure it names ("$5M", "12 engineers") must be in the résumé.
 * An unquoted description with no figure ("no metrics in the Acme role") is a
 * reference, not a quote, and is kept.
 */
export function groundTrigger(trigger: unknown, resumeText: string, facts: TriggerFacts): boolean {
  if (typeof trigger !== "string" || !trigger.trim()) return false;
  const inResume = groundedIn(resumeText);
  const quotes = [...trigger.matchAll(QUOTED)].map((m) => m.slice(1).find((g) => g !== undefined) ?? "")
    .filter((q) => normalizeForGrounding(q).length >= 3);
  if (quotes.some((q) => !inResume(q))) return false;

  const durations = durationsIn(trigger);
  const gapClaim = GAP_CLAIM.test(trigger);
  const tenureClaim = TENURE_CLAIM.test(trigger);
  if (gapClaim && durations.length === 0 && facts.gapMonths.length === 0) return false;
  if ((gapClaim || tenureClaim) && durations.length > 0) {
    const found = [...(gapClaim ? facts.gapMonths : []), ...(tenureClaim ? facts.tenureMonths : [])];
    if (!durations.every((d) => found.some((f) => near(d, f)))) return false;
  }

  // Every other figure outside the quotes and the stated lengths. A count of
  // the résumé's own parts ("2 of 9 bullets", "3 roles") describes it and is
  // not a quote of it.
  let rest = trigger;
  for (const d of [...durations].reverse()) rest = rest.slice(0, d.at[0]) + " " + rest.slice(d.at[1]);
  for (const q of quotes) rest = rest.split(q).join(" ");
  rest = rest.replace(/\d+\s+(?:(?:of|out of)\s+\d+\s+)?(?:bullets?|roles?|jobs?|positions?|lines?|sections?|employers?|companies)(?![\p{L}])/giu, " ");
  // A figure is in the résumé as a whole number there ("12" is not in 2012),
  // compared without its thousands or decimal separators.
  const bare = (f: string) => f.replace(/[.,]/g, "");
  const resumeFigures = new Set((resumeText.match(/\d+(?:[.,]\d+)*/g) ?? []).map(bare));
  const figures = rest.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return figures.every((f) => resumeFigures.has(bare(f)));
}
