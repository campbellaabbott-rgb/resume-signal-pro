/**
 * What the agent will actually be able to do with this profile — and what each
 * gap costs, named.
 *
 * WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED. A live dry run against a real
 * Pinpoint form on 2026-08-01 reported FIVE blockers. With the identical code
 * and a COMPLETE profile it reported ONE, and seven questions filled that had
 * previously stopped it: preferred name, city, postcode, notice period, salary,
 * work authorisation, consent. Nothing about the agent changed. The profile did.
 *
 * So an incomplete profile is not a minor inconvenience, it is the single
 * largest cause of refusals — and a plain "60% complete" bar communicates none
 * of that. It says a number. It does not say that a missing postcode is why an
 * employer's form will stop.
 *
 * EVERY CONSEQUENCE BELOW IS A QUESTION WE HAVE ACTUALLY HARVESTED from a live
 * employer form, not a guess about what forms might ask. The corpus is the 118
 * real labels read off Breezy and Pinpoint boards the same day. Where a field's
 * cost is unmeasured, it is not claimed.
 *
 * THE TRINARIES ARE THE SUBTLE ONES. `null` means "not stated" and is a legal,
 * respected value — the agent refuses rather than guessing, which is correct.
 * But the candidate should know that choosing not to answer means those
 * postings get skipped, because from the outside "no applications" looks
 * identical to "no matching jobs".
 */

export type ReadinessSeverity = "blocks-everything" | "blocks-some" | "reduces-quality";

export type ReadinessGap = {
  field: string;
  severity: ReadinessSeverity;
  /** What an employer's form does when this is missing. Measured, not guessed. */
  consequence: string;
};

export type ApplyReadiness = {
  /** Fields present out of those that carry a measured consequence. */
  ready: number;
  total: number;
  gaps: ReadinessGap[];
  /** True only when nothing would stop a send on a form we have measured. */
  canSendUnattended: boolean;
};

/** The shape this reads. Deliberately loose — the panel's row lags migrations. */
export type ProfileLike = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  postcode?: string | null;
  resume_file_url?: string | null;
  salary_expectation?: string | null;
  earliest_start?: string | null;
  cover_note?: string | null;
  linkedin?: string | null;
  work_authorized?: boolean | null;
  requires_sponsorship?: boolean | null;
  willing_to_relocate?: boolean | null;
  consent_to_processing?: boolean | null;
};

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const stated = (v: unknown) => v === true || v === false;

/**
 * Ordered by severity, then by how often the question appeared in the harvested
 * corpus. The first gap in the list is the one worth fixing first, and the UI
 * can rely on that without re-sorting.
 */
export function applyReadiness(p: ProfileLike): ApplyReadiness {
  const gaps: ReadinessGap[] = [];

  // --- blocks everything -------------------------------------------------
  // A résumé file is required by every form in the corpus without exception.
  if (!has(p.resume_file_url)) {
    gaps.push({
      field: "resume_file_url",
      severity: "blocks-everything",
      consequence: "Every application form requires a CV file. Without one the agent cannot send anything at all.",
    });
  }
  if (!has(p.full_name)) {
    gaps.push({ field: "full_name", severity: "blocks-everything", consequence: "Your name is on every form." });
  }
  if (!has(p.email)) {
    gaps.push({ field: "email", severity: "blocks-everything", consequence: "Your email is on every form — it is how employers reply." });
  }

  // --- blocks some -------------------------------------------------------
  // Each of these is a REAL question from the harvested corpus.
  if (!stated(p.work_authorized)) {
    gaps.push({
      field: "work_authorized",
      severity: "blocks-some",
      consequence: "“Do you currently have the legal right to work…” — the agent refuses rather than guessing, so those postings are skipped.",
    });
  }
  if (!has(p.salary_expectation)) {
    gaps.push({
      field: "salary_expectation",
      severity: "blocks-some",
      consequence: "“What are your salary expectations?” is a required field on forms we drive.",
    });
  }
  if (!has(p.earliest_start)) {
    gaps.push({
      field: "earliest_start",
      severity: "blocks-some",
      consequence: "“If offered the position, what is the earliest date you could start?” — asked as a required question.",
    });
  }
  if (!has(p.postcode)) {
    gaps.push({
      field: "postcode",
      severity: "blocks-some",
      consequence: "Some forms ask for a postcode or Zipcode separately from your address — it is not parsed out of it.",
    });
  }
  if (!has(p.city)) {
    gaps.push({ field: "city", severity: "blocks-some", consequence: "Asked as its own field on forms we drive." });
  }
  if (!has(p.phone)) {
    gaps.push({ field: "phone", severity: "blocks-some", consequence: "Required on most forms, and some ask for a second number too." });
  }
  if (p.consent_to_processing !== true) {
    gaps.push({
      field: "consent_to_processing",
      severity: "blocks-some",
      consequence: "“Allow us to process your personal information” is a required tick. Left off, those forms go to your queue instead.",
    });
  }

  // --- reduces quality ---------------------------------------------------
  // These never block a send; they change how the application reads.
  if (!has(p.cover_note)) {
    gaps.push({
      field: "cover_note",
      severity: "reduces-quality",
      consequence: "Forms with a cover-letter box are left empty. Nothing is invented to fill them.",
    });
  }
  if (!has(p.linkedin)) {
    gaps.push({ field: "linkedin", severity: "reduces-quality", consequence: "Left blank where a form asks for it." });
  }
  if (!stated(p.requires_sponsorship)) {
    gaps.push({
      field: "requires_sponsorship",
      severity: "reduces-quality",
      consequence: "Sponsorship questions go to your queue rather than being answered.",
    });
  }

  const TOTAL = 13; // every field checked above
  return {
    ready: TOTAL - gaps.length,
    total: TOTAL,
    gaps,
    // "Unattended" means nothing we have MEASURED would stop it. It is not a
    // promise that no form will ever ask something new — the agent still
    // refuses unknown questions rather than answering them.
    canSendUnattended: gaps.every((g) => g.severity === "reduces-quality"),
  };
}

/** Highest severity present, for a single headline. */
export function worstSeverity(r: ApplyReadiness): ReadinessSeverity | null {
  if (r.gaps.some((g) => g.severity === "blocks-everything")) return "blocks-everything";
  if (r.gaps.some((g) => g.severity === "blocks-some")) return "blocks-some";
  if (r.gaps.length) return "reduces-quality";
  return null;
}
