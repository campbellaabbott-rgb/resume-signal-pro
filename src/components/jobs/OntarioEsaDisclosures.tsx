// WHAT THE POSTING STATES -- NOT WHAT THE EMPLOYER DID.
//
// Ontario's Employment Standards Act, 2000 gained Part III.1 on 1 January
// 2026. Four clauses touch a publicly advertised posting: s. 8.2(1) expected
// compensation or a range, s. 8.5(1)(a) whether the posting is for an existing
// vacancy, s. 8.4(1) disclosure of artificial intelligence used to screen,
// assess or select applicants, and s. 8.3(1), which forbids requiring Canadian
// experience. This panel prints the posting's own words for each, quotes them
// verbatim, cites the clause, and stops there.
//
// IT IS NOT A COMPLIANCE READ AND MUST NEVER BECOME ONE. O. Reg. 476/24 s.1
// exempts an employer under the regulation's headcount threshold, and this
// board holds no headcount for any employer on any row from any vendor -- so
// whether Part III.1 applied to a given posting at all is a fact we cannot
// observe. A sentence saying an employer broke the law, failed to comply or is
// in violation would be asserting exactly the thing we cannot see. The copy
// rule is therefore absolute and guarded per language: this surface states
// what the posting says and what we could not find in it, and never a verdict,
// a score or a share.
//
// TWO CLAUSES ARE PRESENT-ONLY. s. 8.4(1) binds only an employer that actually
// screens with the technology -- silence is full compliance for everyone else
// -- and s. 8.3(1) is a prohibition, visible only when breached. Those two
// lines render when there is evidence and render NOTHING when there is not.
// Only the pay and vacancy clauses are unconditional, and only those two have
// an "we could not find it" line at all.
//
// THE CLIENT RE-CHECKS THE EVIDENCE IT IS HANDED. readOntarioDisclosureRow
// mirrors the reader's own rules and drops any field that arrives outside
// them: pay evidence with no digit in it (a pay field reading "competitive" is
// not a disclosure), a basis the reader does not emit, vacancy or Canadian-
// experience evidence that does not contain the phrase it is supposed to
// quote, and -- the one that was actually measured wrong -- screening evidence
// whose phrase does not stand within ONTARIO_ESA.aiProximityChars of a
// screening verb or the applicant noun. One sampled Ontario posting carried
// the phrase inside its job DUTIES, which is a role about the technology, not
// a disclosure about recruitment; a bare phrase match would have printed it as
// one. The window here is the same number the migration compiles into its
// pattern, and a guard pins the two together across the runtime boundary.
//
// PROVENANCE. Every line names its basis: which of the employer's two fields
// the pay evidence came from, when we last read the posting, that the scope is
// the stored Ontario subdivision code, and WHAT WAS ACTUALLY APPLIED before
// anything was read. That last one was wrong and is worth writing down: the
// exclusions line used to tell the reader that remote postings were dropped
// because the regulation exempts work performed outside Ontario. It does not
// -- a role worked remotely from Ontario is work performed in Ontario -- and
// what we actually drop is whatever the employer's feed flags as remote,
// because the board stores no work location for those at all. The line now
// names the flag. It also names the currency rule, because the ceiling is a
// Canadian-dollar figure and the board's annual columns are not converted.
// The statutory threshold and ceiling are interpolated from ONTARIO_ESA,
// never typed into a translation, so nine locales cannot drift from the
// regulation.

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** The numbers this surface states, and the numbers the reader compiles into
 *  its patterns. Mirrored by the migration; a guard fails on drift. */
export const ONTARIO_ESA = {
  /** The stored ISO 3166-2 subdivision code the reader scopes to. */
  regionCode: "CA-ON",
  /** O. Reg. 476/24 s.1 -- the headcount below which Part III.1 does not
   *  apply. We hold no headcount, which is why this is printed as the reason
   *  the panel is not a compliance read. */
  minEmployees: 25,
  /** O. Reg. 476/24 s.3 -- expected compensation above this annual figure is
   *  exempt; those postings are excluded by the reader, in CAD. */
  compensationExemptCad: 200000,
  /** The character window between the screening phrase and its verb. */
  aiProximityChars: 40,
  /** The character window between a currency figure and a pay word. */
  payProximityChars: 80,
} as const;

export const ONTARIO_ESA_LINKS = {
  statute: "https://www.ontario.ca/laws/statute/00e41",
  regulation: "https://www.ontario.ca/laws/regulation/240476",
} as const;

/** The two bases the reader emits for pay evidence, in its own spelling. */
export const PAY_BASES = ["salary_field", "description"] as const;
export type PayBasis = (typeof PAY_BASES)[number];

const AI_PHRASE = "artificial intelligence";
const AI_ANCHORS = ["screen", "assess", "select", "applicant"] as const;
const VACANCY_PHRASE = "existing vacanc";
const CANADIAN_PHRASE = "canadian experience";

/** The words a digit has to stand near before it counts as a statement about pay. Mirrors the
 *  reader's own list; the guard reads both and fails on drift. */
export const PAY_WORDS = ["salary", "compensation", "wage", "pay", "rate", "hour", "hourly", "annually"] as const;
/** A currency-marked figure, the shape the reader's own pattern catches first. */
const PAY_CURRENCY_FIGURE = /(?:CAD|CDN|USD|C\$|\$)\s*[0-9]/i;
const PAY_WORD_NEAR = new RegExp(
  `(?:\\b(?:${PAY_WORDS.join("|")})\\b[\\s\\S]{0,${ONTARIO_ESA.payProximityChars}}?[0-9]` +
    `|[0-9][\\s\\S]{0,${ONTARIO_ESA.payProximityChars}}?\\b(?:${PAY_WORDS.join("|")})\\b)`,
  "i",
);

/**
 * Is this evidence a statement about pay, or just a field that happens to hold a number?
 *
 * A bare digit is a wider door than s. 8.2(1) needs: a pay field carrying a grade, a band or a
 * requisition number would be printed as what the posting states for expected compensation. So the
 * figure has to be currency-marked, or a digit has to stand within the same window of a pay word
 * that the reader's own fallback uses. Same rule on both sides of the runtime boundary, so the
 * client re-check still means something.
 */
export function payEvidenceIsFigureShaped(evidence: string): boolean {
  if (!/[0-9]/.test(evidence)) return false;
  return PAY_CURRENCY_FIGURE.test(evidence) || PAY_WORD_NEAR.test(evidence);
}

/**
 * Is this the shape of a s. 8.4(1) disclosure, or just a posting that happens
 * to mention the technology?
 *
 * True only when the phrase stands within ONTARIO_ESA.aiProximityChars of a
 * screening verb or of the applicant noun, measured the way the reader's
 * pattern measures it: from the end of one token to the start of the other,
 * in either order. A posting whose DUTIES involve the technology fails this,
 * which is the whole point -- that false positive was measured on a real
 * Ontario posting before this surface existed.
 */
export function aiEvidenceIsDisclosureShaped(evidence: string): boolean {
  const s = evidence.toLowerCase();
  const gap = ONTARIO_ESA.aiProximityChars;
  for (let i = s.indexOf(AI_PHRASE); i >= 0; i = s.indexOf(AI_PHRASE, i + 1)) {
    const end = i + AI_PHRASE.length;
    for (const anchor of AI_ANCHORS) {
      const fwd = s.indexOf(anchor, end);
      if (fwd >= 0 && fwd - end <= gap) return true;
      const rev = s.lastIndexOf(anchor, i);
      if (rev >= 0 && rev + anchor.length <= i && i - (rev + anchor.length) <= gap) return true;
    }
  }
  return false;
}

/** One posting's evidence, as a surface prints it. Every field is the
 *  employer's own wording; null means nothing was found, and for the two
 *  present-only clauses that is all it ever means. */
export interface OntarioDisclosures {
  id: string;
  readAt: string;
  payEvidence: string | null;
  payBasis: PayBasis | null;
  vacancyEvidence: string | null;
  aiEvidence: string | null;
  canadianExperienceEvidence: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * The reader's row, with every field re-checked against the rule that was
 * supposed to produce it.
 *
 * Returns null when the row is not a row at all (no id, no read stamp, an
 * unparseable stamp). Otherwise each evidence field survives only if it still
 * satisfies its own rule, so a future widening of a pattern cannot quietly
 * put a sentence on the page that the rule would not have admitted.
 */
export function readOntarioDisclosureRow(raw: unknown): OntarioDisclosures | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.od_id);
  const readAt = str(r.od_read_at);
  if (!id || !readAt || !Number.isFinite(Date.parse(readAt))) return null;

  const rawPay = str(r.od_pay_evidence);
  const rawBasis = str(r.od_pay_basis);
  const basis = (PAY_BASES as readonly string[]).includes(rawBasis ?? "") ? (rawBasis as PayBasis) : null;
  // A pay field with no figure in it states no compensation, whatever word it
  // uses -- and a number that is not near a pay word is a grade or a
  // requisition, not a rate; and evidence with no basis has no provenance to
  // print beside it.
  const payEvidence = rawPay && payEvidenceIsFigureShaped(rawPay) && basis ? rawPay : null;

  const rawVacancy = str(r.od_vacancy_evidence);
  const vacancyEvidence = rawVacancy && rawVacancy.toLowerCase().includes(VACANCY_PHRASE) ? rawVacancy : null;

  const rawAi = str(r.od_ai_evidence);
  const aiEvidence = rawAi && aiEvidenceIsDisclosureShaped(rawAi) ? rawAi : null;

  const rawCanadian = str(r.od_canadian_experience_evidence);
  const canadianExperienceEvidence =
    rawCanadian && rawCanadian.toLowerCase().includes(CANADIAN_PHRASE) ? rawCanadian : null;

  return {
    id,
    readAt,
    payEvidence,
    payBasis: payEvidence ? basis : null,
    vacancyEvidence,
    aiEvidence,
    canadianExperienceEvidence,
  };
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown } | undefined>;
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

/**
 * One call per posting id. undefined until answered; null when the reader
 * answers with no row -- the posting is outside Ontario, gone from the
 * employer's feed, or excluded by one of the two regulation exclusions. Both
 * render nothing, because no surface here prints an absence.
 *
 * `error` is read explicitly: supabase-js RESOLVES a PostgREST failure rather
 * than throwing, so a 404 in the window before the reader is deployed would
 * otherwise be indistinguishable from "this posting is out of scope".
 */
export function useOntarioPostingDisclosures(id: string | null | undefined): OntarioDisclosures | null | undefined {
  const [row, setRow] = useState<OntarioDisclosures | null | undefined>(undefined);
  useEffect(() => {
    if (!id) { setRow(undefined); return; }
    let cancelled = false;
    setRow(undefined);
    (async () => {
      try {
        const res = await rpc("get_ontario_posting_disclosures", { p_id: id });
        if (cancelled) return;
        const data = res?.data;
        if (res?.error || !Array.isArray(data)) { setRow(null); return; }
        setRow(data.length > 0 ? readOntarioDisclosureRow(data[0]) : null);
      } catch {
        if (!cancelled) setRow(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);
  return row;
}

type T = (k: string, d: string, o?: Record<string, unknown>) => string;

function Clause({ label, children, tag }: { label: string; children: ReactNode; tag: string }) {
  return (
    <li className="leading-snug" data-esa-clause={tag}>
      <span className="text-foreground font-medium">{label}</span>{" "}
      {children}
    </li>
  );
}

interface Props {
  /** The posting id the board already holds (source:token:externalId). */
  postingId: string;
  /** Where the reader can go and read the posting itself. The reader does not
   *  return it -- the caller already has it, and keeping it out of an
   *  anon-callable RPC keeps the corpus behind the board. */
  postingUrl: string;
  className?: string;
}

/**
 * The panel. Renders nothing at all until the reader answers, and nothing
 * when it answers with no row.
 */
export function OntarioEsaDisclosures({ postingId, postingUrl, className }: Props) {
  const { t, i18n } = useTranslation();
  const row = useOntarioPostingDisclosures(postingId);
  if (!row) return null;

  const tt = t as unknown as T;
  const ceiling = new Intl.NumberFormat(i18n.language || "en", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(ONTARIO_ESA.compensationExemptCad);
  const readAt = new Date(row.readAt).toLocaleDateString(i18n.language || "en", {
    year: "numeric", month: "short", day: "numeric",
  });
  const payBasisLabel = row.payBasis === "salary_field"
    ? tt("ontarioEsa.payBasisSalaryField", "from the posting's pay field")
    : tt("ontarioEsa.payBasisDescription", "from the posting's description");

  return (
    <section className={`rounded-xl border border-border bg-card p-4 max-w-xl ${className ?? ""}`} data-esa-panel="ontario">
      <h3 className="flex items-center gap-1.5 mb-1 text-[12px] font-medium text-primary">
        <Scale className="w-3.5 h-3.5 shrink-0" />
        {tt("ontarioEsa.title", "What this posting states under Ontario law")}
      </h3>

      <p className="text-[11px] text-muted-foreground mb-2.5">
        {tt("ontarioEsa.basis", "Read from this posting's own text, as we last held it on {{readAt}}. Ontario postings only, by the subdivision code {{regionCode}} the posting carries.", {
          readAt, regionCode: ONTARIO_ESA.regionCode,
        })}
      </p>

      <ul className="space-y-1.5 text-[12px] text-muted-foreground">
        <Clause tag="pay" label={tt("ontarioEsa.payLabel", "Expected compensation, s. 8.2(1):")}>
          {row.payEvidence
            ? tt("ontarioEsa.payStated", "the posting states, {{basis}}: \u201c{{evidence}}\u201d", { basis: payBasisLabel, evidence: row.payEvidence })
            : tt("ontarioEsa.payAbsent", "we found no stated figure in the posting's pay field or in its description.")}
        </Clause>

        <Clause tag="vacancy" label={tt("ontarioEsa.vacancyLabel", "Existing vacancy, s. 8.5(1)(a):")}>
          {row.vacancyEvidence
            ? tt("ontarioEsa.vacancyStated", "the posting states: \u201c{{evidence}}\u201d", { evidence: row.vacancyEvidence })
            : tt("ontarioEsa.vacancyAbsent", "we found no such statement in the posting's text.")}
        </Clause>

        {row.aiEvidence && (
          <Clause tag="ai" label={tt("ontarioEsa.aiLabel", "Screening by artificial intelligence, s. 8.4(1):")}>
            {tt("ontarioEsa.aiStated", "the posting states: \u201c{{evidence}}\u201d", { evidence: row.aiEvidence })}
          </Clause>
        )}

        {row.canadianExperienceEvidence && (
          <Clause tag="canadian-experience" label={tt("ontarioEsa.canadianExperienceLabel", "Canadian experience, s. 8.3(1):")}>
            {tt("ontarioEsa.canadianExperienceStated", "the posting's text contains the words: \u201c{{evidence}}\u201d", { evidence: row.canadianExperienceEvidence })}
          </Clause>
        )}
      </ul>

      <p className="text-[11px] text-muted-foreground mt-2.5">
        {tt("ontarioEsa.notAFinding", "This is the posting's own wording and nothing more. Part III.1 does not reach an employer with fewer than {{minEmployees}} employees, and we hold no headcount for any employer here, so nothing above is a finding about any employer.", {
          minEmployees: ONTARIO_ESA.minEmployees,
        })}
      </p>

      <p className="text-[10px] text-muted-foreground mt-1.5">
        {tt("ontarioEsa.exclusions", "Left out here: postings whose stated top-of-range pay is above {{ceiling}} a year, which O. Reg. 476/24 exempts; postings that state pay in another currency, because that ceiling is a Canadian-dollar figure and cannot judge one; and postings the employer's feed flags as remote, because we hold no work location for those.", { ceiling })}
      </p>

      <p className="text-[10px] text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
        <a href={ONTARIO_ESA_LINKS.statute} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-esa-link="statute">
          {tt("ontarioEsa.statuteLink", "Employment Standards Act, 2000, Part III.1 ↗")}
        </a>
        <a href={ONTARIO_ESA_LINKS.regulation} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-esa-link="regulation">
          {tt("ontarioEsa.regLink", "O. Reg. 476/24 ↗")}
        </a>
        <a href={postingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-esa-link="posting">
          {tt("ontarioEsa.postingLink", "This posting on the employer's site ↗")}
        </a>
      </p>

      <p className="text-[10px] text-muted-foreground mt-1.5">
        {tt("ontarioEsa.sourceLine", "Section numbers and wording of the law are from Ontario's e-Laws. © King's Printer for Ontario, 2024. This is not an official version of the legislation.")}
      </p>
    </section>
  );
}

export default OntarioEsaDisclosures;
