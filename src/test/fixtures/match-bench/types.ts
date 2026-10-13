/**
 * The ground-truth shape for every bench résumé (dev and held-out).
 *
 * Rubric fields (applied by judge.ts):
 *   target     title patterns the candidate is SEEKING and would be shortlisted for
 *   adjacent   title patterns a recruiter would still shortlist them for
 *   related    same field, a role a recruiter would NOT shortlist them for (counts
 *              against precision, but not as "wrong field")
 *   oldCareer  a career changer's previous occupation: they could be hired for it,
 *              they are explicitly leaving it, so it is NOT a match (reported apart)
 *   tooJunior  title words that make a posting a seniority mismatch (overqualified)
 *   tooSenior  title words that make a posting a seniority mismatch (underqualified)
 *   maxMinYears the largest stated posting minimum this person clears
 *   metro      places they can commute to; "city|ST" constrains the state/region
 *   relocate   "none" | "country" | list of regions (state codes / region names)
 *   authorized ISO2 countries they can work in today without new sponsorship
 *   sponsorshipFuture  needs sponsorship for a new job (F-1 OPT, H-1B transfer,
 *              a UK Graduate visa, a German job-seeker permit): a posting that says
 *              it will not sponsor fails
 *   citizen    false = a posting that requires citizenship of the country fails
 *   held       licences with their jurisdiction (the licence rule reads these)
 *   clearance  holds an active security clearance (an "active clearance required"
 *              posting fails without one, citizen or not)
 */
export type Profile = "new_grad" | "mid" | "senior" | "career_changer";
export type Level = "entry" | "mid" | "senior" | "exec";

/**
 * The licence families the rubric knows. `cpa` means a professional accounting
 * licence (US CPA, CPA Canada, ICAEW ACA); `cdl` a heavy-vehicle driving licence
 * (US CDL, a Canadian Class 1, a UK C+E).
 */
export type LicenceKind =
  | "rn" | "lpn" | "np" | "pharmacist" | "pt" | "pta" | "teacher"
  | "electrician" | "epa608" | "cdl" | "cpa" | "pe";

export interface LicenceHeld {
  kind: LicenceKind;
  /** US state / CA province / AU state code, or an ISO2 country for a national register (GB NMC, AU AHPRA). */
  region: string | null;
  /** RN multistate (Nurse Licensure Compact) licence. */
  compact?: boolean;
  /** electrician: apprentice < journeyman < master. cdl: "A" or "B". */
  grade?: "apprentice" | "journeyman" | "master" | "A" | "B";
  label: string;
}

export interface ResumeTruth {
  id: string;
  file: string;
  field: string;
  profile: Profile;
  country: string;
  home: string;
  years: number;
  gap: boolean;
  target: RegExp[];
  adjacent: RegExp[];
  related: RegExp[];
  oldCareer: RegExp[];
  tooJunior: RegExp[];
  tooSenior: RegExp[];
  maxMinYears: number;
  metro: string[];
  relocate: "none" | "country" | string[];
  remoteOk: boolean;
  authorized: string[];
  sponsorshipFuture: boolean;
  citizen: boolean;
  licences: string[];
  held: LicenceHeld[];
  clearance: boolean;
  /** Declares permanent residence (a green card): a "citizens or permanent residents" posting passes. */
  permanentResident?: boolean;
  notes: string;
}

/** What the résumé itself declares about the right to work (never inferred). */
export type DeclaredAuth = "citizen" | "permanent_resident" | "authorized" | "needs_sponsorship" | "unknown";

/**
 * Held-out truth adds what the profile reader is scored on (spec §5 held-out
 * targets): city, country, declared authorisation, level, years.
 */
export interface HeldOutTruth extends ResumeTruth {
  level: Level;
  newGrad: boolean;
  careerChanger: boolean;
  /** The home city a reader should take from the résumé; null when the résumé names none. */
  city: string | null;
  /** Other spellings or a more specific suburb that also count as right. */
  cityAlt?: string[];
  region: string | null;
  /** The country a reader should take from the text; null when nothing in the text names one. */
  countryTruth: string | null;
  /** When countryTruth is null, answers that are still not wrong (e.g. unknown or the persona's country). */
  countryAcceptable?: (string | null)[];
  declaredAuth: DeclaredAuth;
  /** Years in the target occupation for a career changer. */
  targetYears?: number;
  layout: "single" | "two-column";
  dateFormat: "en" | "de" | "fr" | "es";
  headerHasLocation: boolean;
  licensedElsewhere: boolean;
}
