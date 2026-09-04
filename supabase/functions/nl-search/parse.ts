// The plain-language parser's CONTRACT, as ONE table.
//
// WHY THIS FILE EXISTS
// nl-search had three hand-maintained copies of "what the board can filter by":
// the prompt's "EXACTLY these filters" list, the tool schema's `properties`, and
// the server-side validator. They agreed on ELEVEN filters. The board's own
// normalizeFilters() reads TWENTY-THREE wire params. So a sentence like
//
//   "part-time hourly nursing jobs under 3 years experience that state pay"
//
// arrived as {q:"nursing jobs", category:"healthcare"} — four of its five
// clauses deleted, with nothing on screen saying so, because a filter the
// prompt never names is a filter the model cannot ask for and the validator
// would not have recognised anyway.
//
// That is the same defect job-board/filters.ts was written to end, one runtime
// upstream: a filter is never silently ignored. Three lists that must agree is
// not a thing to test for agreement — it is a thing to stop having. So the
// prompt line, the tool-schema property and the validation rule for every
// filter live in ONE entry of NL_FILTERS below, and the three artefacts are
// DERIVED from it. A filter cannot be added to one without the others because
// there are no longer three places to add it to.
//
// WHAT IS DELIBERATELY NOT HERE
// See NL_DECLINED. Five of the board's wire params are refused on purpose, each
// with its reason; the guard test asserts that emitted + declined is EXACTLY
// the board's param list, so a filter added to filters.ts fails this repo's
// tests until somebody decides which pile it belongs in.
//
// WHAT THE PAGE OWES THIS FILE
// Every key in the response's `applied` must be either APPLIED from the parse
// or RESET by applyNlSearch in src/pages/Jobs.tsx — a filter left switched on
// from before is a constraint the interpretation chips do not mention and the
// reader cannot see the source of. The guard test asserts that fork for every
// emitted filter, and today the eight new ones take the RESET branch: they
// narrow nothing until the page reads them. That is safe but not finished. An
// interpreted chip is written by the model, so until the page applies them a
// chip can say "Part-time" over a board that is not filtered to part-time —
// which is why the page wiring belongs in the SAME deploy as this file, and why
// `applied` exists for the disclosure line to be rendered from.
//
// WHY THE DOMAINS ARE COPIED RATHER THAN IMPORTED
// filters.ts is the authority for every value list below, and importing it
// would be the honest shape — except that it reaches ../job-board/sources.ts
// (2.6MB), and a nl-search bundle that crosses the deploy size cliff deploys
// "successfully" while serving the previous version. The lists are copied and
// then PINNED, in both directions, by
// src/test/a-sentence-the-parser-could-only-half-hear.test.ts, which imports
// the real modules and compares. Same contract BOARD_VENDORS itself holds
// against sources.ts, enforced by a test instead of the typechecker because
// this side of the wire cannot afford the import.

/** Mirrors JOB_CATEGORIES in ../job-board/categories.ts. */
export const CATEGORIES = [
  "engineering", "data_ai", "design", "product", "marketing", "sales",
  "customer", "finance", "legal", "people_hr", "operations", "healthcare",
  "science", "education", "hospitality_retail", "security", "admin", "other",
] as const;
/** Mirrors EXPERIENCE_BANDS in ../job-board/experience.ts. */
export const EXPERIENCE = ["entry", "mid", "senior", "expert"] as const;
/** Mirrors WORK_MODES in ../job-board/filters.ts. */
export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
/** Mirrors EMPLOYMENT_TYPES in ../job-board/filters.ts. */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;
/** Mirrors PAY_BASES in ../job-board/filters.ts. */
export const PAY_BASES = ["hourly", "salaried"] as const;
/** Mirrors BOARD_VENDORS in ../job-board/filters.ts. */
export const VENDORS = [
  "greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr",
  "recruitee", "teamtailor", "personio", "breezy", "rippling", "workday",
  "pinpoint", "oracle", "icims", "usajobs", "paylocity", "ukg", "adp", "jazzhr",
] as const;

/**
 * The board's own caps, by wire name. Not a nicety: normalizeFilters TRUNCATES
 * an over-long list and REPORTS the truncation in ignoredFilters, so a parse
 * that emits six categories produces a visible "we couldn't do that" on a
 * request the parser itself over-reached on. Capping here means the refusal
 * belongs to the parse, where it can be named in `dropped`, instead of to the
 * board, where it reads as the board declining the reader's own request.
 */
export const CAPS = {
  category: 3,
  country: 5,
  experience: EXPERIENCE.length,
  workMode: WORK_MODES.length,
  employmentType: EMPLOYMENT_TYPES.length,
  vendor: 8,
} as const;

export type NlValue = string | number | boolean;

export type NlFilter = {
  /** The WIRE name — what job-board/filters.ts reads off the body. Not a
   *  page-side spelling: `vendor` is singular, `hasStatedPay` is the checkbox
   *  labelled "States pay". A page-side spelling is a filter the server
   *  silently ignores. */
  key: string;
  /** The prompt's line for this filter, after "- <key>: ". */
  prompt: string;
  /** JSON-schema type. Lists ride as comma-separated STRINGS, the same shape
   *  the board takes and the same shape the page's URL carries. */
  type: "string" | "number" | "boolean";
  /** The tool schema's description. */
  schema: string;
  /**
   * The value to SEND, or undefined to DROP it.
   *
   * `already` is the filter object built so far, in NL_FILTERS order — which is
   * why salaryCeiling sits after salaryFloor: an inverted band is refused here
   * rather than forwarded for the board to refuse, because the board's refusal
   * arrives as ignoredFilters on a search the reader never mis-stated.
   */
  take: (raw: unknown, already: Readonly<Record<string, NlValue>>) => NlValue | undefined;
};

/**
 * Lowercase, trim, and fold separators to the underscore the board's domains
 * actually use. "Part-Time" and "part time" are the SAME VALUE as part_time
 * spelled differently — canonicalising a separator is not guessing at an
 * unknown value, and no member of any domain here contains a space or hyphen,
 * so nothing else can change meaning under it. Anything still outside the
 * domain after this is dropped, never mapped to a neighbour.
 */
const canon = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * A closed-domain list, as the comma-joined string the board takes.
 *
 * Accepts an ARRAY too: the gateway routinely answers a string-typed tool
 * parameter with a one-element array, and a filter lost to the model's JSON
 * shaping is the same lost filter as one lost to a bad value.
 *
 * Unknown members are DROPPED (they cannot match a posting) but a request whose
 * members are ALL unknown returns undefined, so the caller is told the filter
 * was refused rather than silently searching without it.
 */
const list = (domain: readonly string[], cap: number) => (raw: unknown): string | undefined => {
  const asked = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map(canon)
    .filter(Boolean);
  const good = [...new Set(asked.filter((v) => domain.includes(v)))].slice(0, cap);
  return good.length ? good.join(",") : undefined;
};

/** Literal true only, the sendableOnly rule — a narrowing must never ride a
 *  truthy string, and the board takes `=== true`. */
const flag = (raw: unknown): boolean | undefined => (raw === true ? true : undefined);

/** An annual pay figure. Strict `number`: a model that answers "150k" has not
 *  answered the question the schema asked, and parsing its prose here is how a
 *  filter starts meaning whatever the string happened to look like. */
const money = (raw: unknown): number | undefined => {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(Math.round(raw), 2_000_000);
};

/**
 * EVERY FILTER THE PARSER CAN EMIT, in the order the prompt lists them and the
 * order the validator applies them. Grouped the way a person describes a job:
 * what it is, how senior, where and how, what it pays, who published it, how
 * fresh.
 */
export const NL_FILTERS: readonly NlFilter[] = [
  {
    key: "q",
    prompt:
      'the role/title/skill keywords to search (e.g. "product manager", "kubernetes"). Put here anything that describes the JOB itself — and NOTHING you expressed as a filter below. q is matched against the posting TITLE, so a leftover "part time" or "100k" ANDs against every title and returns almost nothing.',
    type: "string",
    schema: "Role/title/skill keywords, with every word you turned into a filter removed",
    take: (raw) => (typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 120) : undefined),
  },
  {
    key: "category",
    prompt: `up to ${CAPS.category}, comma-separated, from [${CATEGORIES.join(", ")}]. The posting's FIELD. Map only when it is unambiguous.`,
    type: "string",
    schema: `Comma-separated, max ${CAPS.category}, from: ${CATEGORIES.join(", ")}`,
    take: list(CATEGORIES, CAPS.category),
  },
  {
    key: "experience",
    prompt:
      `up to ${CAPS.experience}, comma-separated, from [${EXPERIENCE.join(", ")}]. What the POSTING demands: "entry"=junior/new-grad, "mid"=3-5y, "senior"=6-9y, "expert"=10y+/principal.`,
    type: "string",
    schema: `Comma-separated bands from: ${EXPERIENCE.join(", ")}`,
    take: list(EXPERIENCE, CAPS.experience),
  },
  {
    key: "maxYears",
    prompt:
      'a whole number 1-20. What the PERSON has, not what the posting wants: "under 3 years experience", "nothing asking for more than 5 years" -> 3, 5. Leave out unless the user states a ceiling on the years demanded.',
    type: "number",
    schema: "Whole number 1-20: the most years of experience a posting may demand",
    // 1..20, REFUSED outside it rather than clamped, and WHOLE — both rules are
    // filters.ts's, for its reasons: clamping 99 to 20 invents a narrowing the
    // caller never asked for, and min_years is a SMALLINT, so {maxYears:3.5}
    // renders as a literal Postgres refuses (22P02) and 400s the list query.
    take: (raw) => (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 20 ? raw : undefined),
  },
  {
    key: "remote",
    prompt: "true only if the user clearly wants remote work.",
    type: "boolean",
    schema: "true only when the user clearly wants remote work",
    take: flag,
  },
  {
    key: "workMode",
    prompt:
      `comma-separated from [${WORK_MODES.join(", ")}] when the user names work modes ("hybrid or remote in Berlin", "in-office jobs"). Set remote true as well when workMode is exactly "remote".`,
    type: "string",
    schema: `Comma-separated from: ${WORK_MODES.join(", ")}`,
    take: list(WORK_MODES, CAPS.workMode),
  },
  {
    key: "employmentType",
    prompt:
      `comma-separated from [${EMPLOYMENT_TYPES.join(", ")}] — exactly these spellings. "part-time"->part_time, "contract/contractor/freelance"->contract, "temp/seasonal"->temporary, "intern/placement"->internship. Only nine of sixteen hiring systems state this, so the rest are hidden while it is on.`,
    type: "string",
    schema: `Comma-separated from: ${EMPLOYMENT_TYPES.join(", ")}`,
    take: list(EMPLOYMENT_TYPES, CAPS.employmentType),
  },
  {
    key: "salaryFloor",
    prompt:
      'a number (ANNUAL, no currency symbol, no "k") when the user states a minimum. An hourly rate is not an annual figure — for "over $30/hr" set payBasis "hourly" and leave this out.',
    type: "number",
    schema: "Annual minimum as a plain number, no currency symbol",
    take: money,
  },
  {
    key: "salaryCeiling",
    prompt: 'a number (ANNUAL) when the user states a maximum ("up to 90k", "under 120k"). Must be above salaryFloor.',
    type: "number",
    schema: "Annual maximum as a plain number, above salaryFloor",
    // A band that closes below its own floor is REFUSED here, not forwarded.
    // filters.ts refuses it too — and names it in ignoredFilters, which on this
    // path would tell the reader the BOARD declined a filter, when what actually
    // happened is that the parse contradicted itself. Refusing here puts the
    // refusal in `dropped`, where it belongs to the parse.
    take: (raw, already) => {
      const n = money(raw);
      if (n === undefined) return undefined;
      const floor = already.salaryFloor;
      return typeof floor === "number" && n < floor ? undefined : n;
    },
  },
  {
    key: "payBasis",
    prompt:
      '"hourly" when the user asks for hourly / per-hour / "$X an hour" work; "salaried" for salaried / annual pay. Only ~10% of postings state a pay period and the rest are hidden while this is on, so set it only when the user really means it.',
    type: "string",
    schema: `One of: ${PAY_BASES.join(", ")}`,
    take: (raw) => {
      const v = canon(raw);
      return (PAY_BASES as readonly string[]).includes(v) ? v : undefined;
    },
  },
  {
    key: "hasStatedPay",
    prompt:
      'true when the user asks for postings that STATE the pay ("that say what they pay", "salary listed", "no hidden pay"). ~20% of postings do.',
    type: "boolean",
    schema: "true only when the user asks for postings that publish a pay figure",
    take: flag,
  },
  {
    key: "country",
    prompt: `up to ${CAPS.country} 2-letter ISO codes, comma-separated, only if countries are named (US, GB, CA, DE...).`,
    type: "string",
    schema: `Comma-separated 2-letter ISO codes, max ${CAPS.country}`,
    take: (raw) => {
      const asked = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
        .map((c) => String(c ?? "").trim())
        .filter((c) => /^[A-Za-z]{2}$/.test(c))
        .map((c) => c.toUpperCase());
      const good = [...new Set(asked)].slice(0, CAPS.country);
      return good.length ? good.join(",") : undefined;
    },
  },
  {
    key: "location",
    prompt: "a city/region string if a specific place is named (not a country).",
    type: "string",
    schema: "City or region (not a country)",
    take: (raw) => (typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 80) : undefined),
  },
  {
    key: "department",
    prompt:
      'a team/department name, matched as a substring of the posting\'s own department field ("in the nursing department", "the growth team"). Use `category` when the user names a FIELD; use this only when they name a team. ~40% of postings state one.',
    type: "string",
    schema: "A department/team name, matched as a substring",
    // ILIKE '%s%', so the ILIKE WILDCARDS COME OUT — the same set filters.ts
    // strips, for the same reason: a surviving `%` turns "eng%" into a prefix
    // match nobody asked for and `_` matches any single character. A non-string
    // is refused rather than coerced; String({}) is "[object Object]", which
    // would bind as a real predicate and return an empty page under a filter
    // the reader never expressed.
    take: (raw) => {
      if (typeof raw !== "string" && typeof raw !== "number") return undefined;
      const d = String(raw).replace(/[%_\\|"]/g, "").trim().slice(0, 60).trim();
      return d || undefined;
    },
  },
  {
    key: "vendor",
    prompt:
      `up to ${CAPS.vendor}, comma-separated, from [${VENDORS.join(", ")}] — the hiring system a posting was published on. ONLY when the user names one of these by name. An employer is not a vendor.`,
    type: "string",
    schema: `Comma-separated hiring systems, max ${CAPS.vendor}, from: ${VENDORS.join(", ")}`,
    take: list(VENDORS, CAPS.vendor),
  },
  {
    key: "excludeAgencies",
    prompt:
      'true when the user asks to leave out staffing agencies / recruiters ("direct employers only", "no agencies", "no recruiters"). Agencies are carried and badged by default; this is the reader declining them.',
    type: "boolean",
    schema: "true only when the user asks to exclude staffing agencies",
    take: flag,
  },
  {
    key: "maxAgeDays",
    prompt:
      '1 for "today", 7 for "this week"/"recent"/"new", or N for "last N days" / "past N weeks" (a whole number of days, up to 30).',
    type: "number",
    schema: "Whole days, 1-30: 1 for today, 7 for this week/recent, or N for 'last N days'",
    // 1..30, the same window the board and applyNlSearch accept — NOT just 1 or
    // 7. A "last 14 days" intent used to be dropped here while its interpreted
    // chip still claimed it; that is the whole reason `dropped` now exists, and
    // why the window is the API's rather than the two the chips once offered.
    take: (raw) => {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      const days = Math.round(raw);
      return days >= 1 && days <= 30 ? days : undefined;
    },
  },
  {
    key: "activelyHiring",
    prompt: "true when the user asks for companies that really hire / actually fill roles / proven hirers / no ghost jobs.",
    type: "boolean",
    schema: "true only when the user wants companies with a proven fill record",
    take: flag,
  },
  {
    key: "sort",
    prompt: '"salary" when they ask for highest-paying/best-paid first; "newest" when they explicitly ask newest-first.',
    type: "string",
    schema: "salary for highest-paying first, newest for newest first",
    take: (raw) => (raw === "salary" || raw === "newest" ? raw : undefined),
  },
];

/**
 * The board wire params this parser refuses to produce, and why.
 *
 * A LIST WITH REASONS, not an omission. The guard test asserts that these plus
 * NL_FILTERS' keys are EXACTLY the params job-board/filters.ts reads, so the
 * day the board grows a filter this file fails until somebody puts it in one
 * pile or the other. "Nobody thought about it" stops being a possible state.
 */
export const NL_DECLINED: Readonly<Record<string, string>> = {
  // A WIDENER, and the parser has never emitted it. Recorded on the board side
  // too (Jobs.tsx resets it before every interpreted search): a stale
  // "+ unsorted" reactivating under an interpretation that never mentions it is
  // exactly the defect the reset exists for. A sentence cannot ask to be shown
  // MORE than it asked for, and a model that decided to widen a search on its
  // own would be un-auditable from the chips.
  includeUncategorised: "widens the result set; a parse may only narrow",
  // The other widener, same rule. It relaxes an active pay floor to re-admit
  // postings with no stated pay — the opposite of every clause a sentence
  // contains.
  includeUnstatedPay: "widens the result set; a parse may only narrow",
  // Needs an opaque company TOKEN (19,701 of them), not a name. A model cannot
  // know the token, and inventing one returns an empty page that reads as "this
  // employer has nothing open". Employer names belong in notMapped.
  companies: "requires an opaque company token the model cannot know",
  // An ABSOLUTE date, and this function is never told today's date. A relative
  // window is what sentences actually carry ("this week", "last 14 days") and
  // maxAgeDays carries it exactly.
  postedAfter: "an absolute date the model has no clock for; maxAgeDays carries the intent",
  // The paid agent's "only jobs it can apply to" — 5.4% of the board, gated on
  // an entitlement this function cannot see. A sentence like "jobs I can apply
  // to" means the ordinary thing, not the product.
  sendableOnly: "a paid-capability gate, not a description of a job",
};

/** The prompt's filter list, DERIVED — never written out a second time. */
export const FILTER_LIST = NL_FILTERS.map((f) => `- ${f.key}: ${f.prompt}`).join("\n");

export const SYSTEM_PROMPT =
  `You convert a job seeker's plain-language search into structured filters for a job board. Output ONLY via the tool call.

The board has EXACTLY these filters — never invent others:
${FILTER_LIST}

RULES:
- Only set a filter when the query clearly implies it. When unsure, leave it out and let it fall into q or notMapped.
- Use the EXACT spellings listed above. A value outside the list is dropped by the server, not guessed at.
- NEVER widen. Every filter here narrows; there is no way to ask for more than the board already shows.
- Concepts the board CANNOT filter (company size, "startup", funding stage, "no degree required", visa sponsorship, benefits, a named employer, industry-of-company) must go in notMapped as short phrases — never faked into a filter.
- interpreted: 2-6 short human-readable chips describing ONLY what you put into the filters above (e.g. "Remote", "Part-time", "$150k+ minimum"). This is shown to the user, so a chip for something you did not filter on is a lie — put that in notMapped instead.`;

/** The tool's `parameters`, DERIVED from the same table as the prompt.
 *  No `enum` in the schema (some gateways reject it in tool params); the valid
 *  values are stated in the prompt and enforced by validateParse below, which
 *  is the real guard either way. */
export const TOOL_PARAMETERS = {
  type: "object",
  properties: {
    ...Object.fromEntries(NL_FILTERS.map((f) => [f.key, { type: f.type, description: f.schema }])),
    interpreted: { type: "array", items: { type: "string" }, description: "2-6 short chips of what was understood" },
    notMapped: { type: "array", items: { type: "string" }, description: "Concepts with no matching filter" },
  },
  required: ["interpreted"],
} as const;

export type NlParse = {
  /** Exactly the board's wire params, with the board's own spellings. */
  filters: Record<string, NlValue>;
  /** Every filter that survived, by wire name — the disclosure line's data. */
  applied: string[];
  /** Filters the model ASKED for and validation refused: an unknown enum
   *  member, a number out of range, a band that closes below its floor. Without
   *  this they vanished between the model and the client while the model's own
   *  chip went on claiming them. */
  dropped: string[];
  interpreted: string[];
  notMapped: string[];
};

/**
 * The model's tool arguments, reduced to what the board will actually bind.
 *
 * Iterates NL_FILTERS, never the parsed object: a key the table does not carry
 * cannot reach the client no matter what the gateway returns. That is the whole
 * point of validating here — the client trusts what we send, so anything
 * off-contract dies at this line and is named, not forwarded.
 */
export function validateParse(parsed: Record<string, unknown>): NlParse {
  const filters: Record<string, NlValue> = {};
  const dropped: string[] = [];

  for (const f of NL_FILTERS) {
    const raw = parsed[f.key];
    // NOT ASKED is not the same as REFUSED, and only the second is reported.
    // `false` is a boolean control at rest, `0` is the off position for every
    // numeric one (filters.ts reads them the same way), and an empty string or
    // list is the model declining to answer. Naming those would hang a
    // "we couldn't do that" on filters nobody requested.
    if (raw === undefined || raw === null || raw === false || raw === 0) continue;
    if (typeof raw === "string" && !raw.trim()) continue;
    if (Array.isArray(raw) && raw.length === 0) continue;

    const v = f.take(raw, filters);
    if (v === undefined) dropped.push(f.key);
    else filters[f.key] = v;
  }

  const strings = (v: unknown, n: number): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, n)
      : [];

  return {
    filters,
    applied: Object.keys(filters),
    dropped,
    interpreted: strings(parsed.interpreted, 6),
    notMapped: strings(parsed.notMapped, 4),
  };
}
