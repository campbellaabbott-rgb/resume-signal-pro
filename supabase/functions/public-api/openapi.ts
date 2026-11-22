/**
 * THE /v1 DOCUMENT, WRITTEN FROM WHAT THE ROUTER TAKES (api4 W1, lane A3).
 *
 * An OpenAPI 3.1 description of public-api, so a builder can load /v1 into any
 * OpenAPI tool (a client generator, an API console, a custom GPT's Action) and
 * the snippets a reader copies come from one place: each operation carries
 * x-codeSamples in curl, JavaScript fetch and Python requests.
 *
 * NOT A SECOND LIST. The routes, the query parameters each route accepts, the
 * caps on the comma lists, the page sizes, the history windows, the version and
 * the withheld hiring systems are the router's own constants, handed in as
 * RouterFacts by whatever serves the document. This file holds only the WORDS
 * for them. A route or parameter the router takes and this file has no words
 * for is still emitted, marked as undescribed, so the document never leaves out
 * something the router answers, and the guard beside it fails until it is
 * described. Words for something the router does not take are never emitted.
 *
 * WHY THE FACTS ARE PASSED IN RATHER THAN IMPORTED. index.ts serves on import
 * (Deno.serve runs at module level) and keeps its constants private, so no
 * module can import them. Until they move to an importable module, the guard
 * reads them out of index.ts, and the wiring lane passes the same constants by
 * value when it serves this document.
 *
 * WIRED (lane fix/1121-connector-errors, item 7b): index.ts serves it at
 * OPENAPI_PATH and /openapi.json, unmetered and with no key, built once per
 * isolate from routerFacts(), and the guard holds what it serves equal to the
 * document it builds from the constants it reads out of index.ts.
 *
 * Every import is a module index.ts already bundles, so serving this adds only
 * this file's own bytes to public-api and none to _shared.
 */
import { APPLICATION_ENDPOINT, FIT_ENDPOINT } from "./endpoint.ts";
import { FIT_FREE_DAILY, FIT_PAID_DAILY } from "./fit-allowance.ts";
import { APPLICATION_DESCRIPTION, FORM_UNREACHABLE_RETRY_S } from "./application.ts";
import { SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import { BOARD_VENDORS, EMPLOYMENT_TYPES, EXPERIENCE_BANDS, JOB_CATEGORIES, WORK_MODES } from "../_shared/board-domains.ts";

/** Where index.ts serves this document (also at /openapi.json). */
export const OPENAPI_PATH = "/v1/openapi.json";

/** How a key is got, in one step: said on the index, beside both 401s and here (item 7c). */
export const GET_A_KEY_STEP = "Enter your email on that page and open the link we mail you: it shows the key once.";

/**
 * NO KEYLESS SAMPLE IN THIS BUILD, AND SAID SO (item 7d): the root, the 401s
 * and this document carry it, so a caller does not hunt for one. A keyless /v1
 * read would draw the share every caller outside Claude's and ChatGPT's
 * servers already shares, and changing what needs a key is the owner's call.
 */
export const KEYLESS_SAMPLE = {
  offered: false,
  instead: "The same board answers with no key through the MCP connector (https://resumebooster.work/agents): 100 lookups a day for one connection.",
} as const;

/** The extension key that marks a route, parameter or field the router has and this file does not describe. */
export const UNDESCRIBED = "x-undescribed";

/** What the router takes and promises, as its own constants say it. */
export type RouterFacts = {
  /** API_VERSION. */
  apiVersion: string;
  /** The index answer's `docs` address. */
  docsUrl: string;
  /** The index answer's `endpoints`, as it lists them: "/v1/jobs" is a GET, "POST /v1/fit" names its method. */
  endpoints: readonly string[];
  /** JOBS_PARAMS. */
  jobsParams: readonly string[];
  /** CHANGES_PARAMS. */
  changesParams: readonly string[];
  /** COMPANIES_PARAMS. */
  companiesParams: readonly string[];
  /** LIST_FILTERS, as param -> cap: the comma-list parameters and how many values each takes. */
  listFilterCaps: Readonly<Record<string, number>>;
  /** INCLUDABLE_FIELDS. */
  includableFields: readonly string[];
  /** JOB_FIELDS, split: the columns every job row carries. */
  jobFields: readonly string[];
  /** The columns /v1/changes selects for opened[]. */
  changesOpenedFields: readonly string[];
  /** The columns /v1/changes selects for closed[], before the two it reads and does not publish. */
  changesClosedFields: readonly string[];
  /** DEFAULT_LIMIT, MAX_LIMIT, MAX_LIMIT_WITH_DESCRIPTION and MAX_OFFSET. */
  defaultLimit: number;
  maxLimit: number;
  maxLimitWithDescription: number;
  maxOffset: number;
  /** The page size /v1/companies gives when none is asked for. */
  companiesDefaultLimit: number;
  /** FRESH_WINDOW_DAYS, CLOSURES_MAX_DAYS_FREE and CHANGES_MAX_DAYS_PAID. */
  freshWindowDays: number;
  closuresMaxDaysFree: number;
  changesMaxDaysPaid: number;
  /** FREE_KEY_ISSUED and BUILDER_PROPOSED. */
  freeKeyIssued: { readonly perDay: number; readonly perMinute: number };
  builderProposed: { readonly perDay: number; readonly perMinute: number };
  /** BUILDER_URL. */
  builderUrl: string;
  /** NO_REDISTRIBUTION_SOURCES and NO_REDISTRIBUTION_REASON. */
  withheldSources: readonly string[];
  withheldReason: string;
  /** The response headers a browser may read (Access-Control-Expose-Headers), split. */
  exposedHeaders: readonly string[];
  /** What POST /v1/fit reads from its JSON body, and the bounds it applies to it. */
  fit: {
    bodyFields: readonly string[];
    resumeTextMinChars: number;
    resumeTextMaxChars: number;
    limitMax: number;
    limitDefault: number;
  };
};

/** The address /v1 paths are relative to, from the project's Supabase URL (src/config/public-endpoints.ts says the same). */
export function publicApiServer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/public-api`;
}

type Json = Record<string, unknown>;
/** A refusal a route can give: status, the machine code, and when. */
type ErrorDoc = readonly [number, string, string];
type FactText = string | ((f: RouterFacts) => string);
type FactSchema = Json | ((f: RouterFacts) => Json);

const text = (t: FactText, f: RouterFacts): string => (typeof t === "function" ? t(f) : t);
const schemaOf = (s: FactSchema, f: RouterFacts): Json => (typeof s === "function" ? s(f) : s);
const nullable = (type: string, extra: Json = {}): Json => ({ type: [type, "null"], ...extra });
const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

/** "a, b and c". */
function prose(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const withheldOf = (f: RouterFacts) => prose(f.withheldSources);
const servableVendors = (f: RouterFacts) => BOARD_VENDORS.filter((v) => !f.withheldSources.includes(v));

// ---------------------------------------------------------------------------
// The words for each query parameter, by the router list that takes it.
// ---------------------------------------------------------------------------

type ParamDoc = {
  description: FactText;
  /** A single value. */
  schema?: FactSchema;
  /** A comma list: the schema of one member. Its cap is the router's (listFilterCaps), never typed here. */
  items?: FactSchema;
  required?: boolean;
};

/** The closed sets the comma-list filters check against; null where the key space is open. */
const LIST_DOMAINS: Readonly<Record<string, readonly string[] | null>> = {
  country: null,
  category: JOB_CATEGORIES,
  company_token: null,
  work_mode: WORK_MODES,
  source: BOARD_VENDORS,
  experience_band: EXPERIENCE_BANDS,
  employment_type: EMPLOYMENT_TYPES,
};

/** The members a closed list documents: its domain, less the hiring systems that answer 451 rather than rows. */
export function documentedDomain(param: string, f: RouterFacts): readonly string[] | null {
  const d = LIST_DOMAINS[param];
  if (!d) return null;
  return param === "source" ? servableVendors(f) : d;
}

const closedItems = (param: string) => (f: RouterFacts): Json => ({ type: "string", enum: [...(documentedDomain(param, f) ?? [])] });

const limitDoc = (which: "jobs" | "changes"): ParamDoc => ({
  description: (f) =>
    which === "jobs"
      ? `Rows per page, 1 to ${f.maxLimit} (default ${f.defaultLimit}). A larger number is cut to the cap, which page.maxLimit states; with include=description the cap is ${f.maxLimitWithDescription}.`
      : `Rows per page in each list, 1 to ${f.maxLimit} (default ${f.defaultLimit}). A larger number is cut to ${f.maxLimit}.`,
  schema: (f) => ({ type: "integer", minimum: 1, maximum: f.maxLimit, default: f.defaultLimit }),
});

const TRUE_FALSE: Json = { type: "boolean" };

/** GET /v1/jobs. */
const JOBS_PARAM_DOCS: Readonly<Record<string, ParamDoc>> = {
  limit: limitDoc("jobs"),
  offset: {
    description: (f) =>
      `Rows to skip, at most ${f.maxOffset}; deeper answers 400 offset_too_deep. The default engine pages better by cursor: an offset makes the database walk every row it skips. engine=ranked pages by offset only (follow page.nextOffset).`,
    schema: (f) => ({ type: "integer", minimum: 0, maximum: f.maxOffset, default: 0 }),
  },
  cursor: {
    description:
      "page.nextCursor from the previous page; the default engine pages newest first by this keyset. A cursor this API did not issue answers 400 bad_cursor, and engine=ranked refuses a cursor with 400 unsupported_param.",
    schema: { type: "string" },
  },
  q: {
    description:
      "Words matched against the posting title (the default engine runs a web-search style match on the title only; the employer name is not searched, so filter by company_token instead). With engine=ranked it is the site's own ranked search. Only the first 200 characters are read.",
    schema: { type: "string" },
  },
  company_token: {
    description: (f) =>
      `Employer boards, by the company_token every row carries (or /v1/companies lists). A token from a withheld hiring system (${withheldOf(f)}), or an employer on one, answers 451 source_not_redistributable. A token the board has never read answers an empty page that says so in disclosures.unknownCompanies.`,
    items: { type: "string" },
  },
  source: {
    description: (f) =>
      `Hiring systems. ${withheldOf(f)} are withheld from this API: naming one answers 451 source_not_redistributable, never an empty page. Any other unknown value answers 400 unsupported_param.`,
    items: closedItems("source"),
  },
  category: { description: "Job fields. An unknown value answers 400 unsupported_param.", items: closedItems("category") },
  country: {
    description: "ISO 3166-1 alpha-2 or alpha-3 codes, or country names (Ireland, United Kingdom, USA, Deutschland), any case; disclosures.countryRead says what each name was searched as. England, Scotland, Wales and Northern Ireland are searched as GB, said in countryRead.notes. A name with two readings (Georgia), a region (EU, EMEA) or anything else answers 400 invalid_value naming it.",
    items: { type: "string", pattern: "^[A-Za-z]{2}$" },
  },
  work_mode: { description: "How the work is done.", items: closedItems("work_mode") },
  experience_band: { description: "Experience bands.", items: closedItems("experience_band") },
  employment_type: { description: "Employment types.", items: closedItems("employment_type") },
  department: {
    description: "Text found in the posting's department (case-insensitive). The default engine reads the first 80 characters.",
    schema: { type: "string" },
  },
  remote: {
    description: "true keeps remote postings and false keeps the rest. engine=ranked binds true only and answers 400 unsupported_param to false.",
    schema: TRUE_FALSE,
  },
  salary_min: {
    description:
      "An annual pay floor in approximate US dollars, compared against each posting's converted annual figure. Postings with no such figure are left out unless include_unstated_pay=true; the response's coverage says what share of postings carry one.",
    schema: { type: "number", minimum: 0 },
  },
  salary_max: {
    description: "An annual pay ceiling in approximate US dollars, compared the same way as salary_min.",
    schema: { type: "number", minimum: 0 },
  },
  include_unstated_pay: {
    description: "true keeps postings with no comparable pay figure when salary_min or salary_max is set. Only the value true does anything.",
    schema: TRUE_FALSE,
  },
  posted_after: {
    description: "Postings the employer dated at or after this date (an ISO date such as 2026-09-01, or a full ISO timestamp).",
    schema: { type: "string", format: "date-time" },
  },
  posted_before: {
    description: "Postings the employer dated at or before this date. The default engine only: engine=ranked answers 400 unsupported_param.",
    schema: { type: "string", format: "date-time" },
  },
  exclude_agencies: {
    description: "true leaves out postings from boards tagged as staffing agencies (each row's agency field). Agencies are served by default.",
    schema: TRUE_FALSE,
  },
  explain: {
    description: "1 or true adds a diagnostics block on the default engine: which filters bound, the two fences, the order, the paging mode and the count basis.",
    schema: { type: "string", enum: ["1", "true"] },
  },
  location: {
    description:
      "A place, matched the way the board matches it: a city, a state code or a country name, with the board's own expansions (\"bay area\" covers San Francisco, Oakland and San Jose).",
    schema: { type: "string" },
  },
  max_years: {
    description: "Postings that ask for at most this many years of experience.",
    schema: { type: "integer", minimum: 0 },
  },
  has_stated_pay: {
    description: "true keeps postings that state any pay figure, hourly rates included.",
    schema: TRUE_FALSE,
  },
  pay_basis: {
    description: "hourly keeps postings paid by the hour; salaried keeps postings paid by the month or year.",
    schema: { type: "string", enum: ["hourly", "salaried"] },
  },
  max_age_days: {
    description: (f) =>
      `Postings the employer dated within this many days. Every row is inside the ${f.freshWindowDays}-day window already.`,
    schema: { type: "integer", minimum: 1 },
  },
  agent_ready_only: {
    description: `true keeps postings on the hiring systems listed as agent-ready (${prose([...SENDABLE_VENDORS])}). Beside source it keeps only the systems in both.`,
    schema: TRUE_FALSE,
  },
  sort: {
    description: "engine=ranked only: newest, or salary. The default engine answers 400 unsupported_param, because its cursor is its order.",
    schema: { type: "string", enum: ["newest", "salary"] },
  },
  engine: {
    description:
      "simple (the default) or ranked. ranked runs the site's own ranked search, with relevance, alias and typo rescue and its disclosures, and needs a paid key: a free key answers 402 upgrade_required, naming the planned Builder tier.",
    schema: { type: "string", enum: ["simple", "ranked"], default: "simple" },
  },
  include: {
    description: (f) =>
      `Opt-in fields. description adds the posting body to every row and caps the page at ${f.maxLimitWithDescription} rows. The default engine only: engine=ranked answers 400 unsupported_param.`,
    items: (f) => ({ type: "string", enum: [...f.includableFields] }),
  },
};

/** GET /v1/changes. */
const CHANGES_PARAM_DOCS: Readonly<Record<string, ParamDoc>> = {
  since: {
    description: (f) =>
      `An ISO timestamp. A free key reaches back ${f.freshWindowDays} days for opened[] and ${f.closuresMaxDaysFree} for closed[]; a paid key reaches ${f.changesMaxDaysPaid} days for both. Further back answers 400 since_too_old; a closed[] window shorter than since is stated in closureSince and closureWindowNarrowed. Resume a sync with the same since and the stored cursors, never by moving since forward.`,
    schema: { type: "string", format: "date-time" },
    required: true,
  },
  limit: limitDoc("changes"),
  opened_cursor: {
    description: "page.opened.nextCursor (or page.opened.resumeCursor) from an earlier page of this feed. Pages opened[] only.",
    schema: { type: "string" },
  },
  closed_cursor: {
    description: "page.closed.nextCursor (or page.closed.resumeCursor) from an earlier page of this feed. Pages closed[] only.",
    schema: { type: "string" },
  },
  include_suspect: {
    description:
      "true also returns the closure batches our collector doubted when it wrote them (a pass that removed so much of a board that the takedown may have been our failed read), each marked suspectBatch:true. Left out by default.",
    schema: TRUE_FALSE,
  },
};

/** GET /v1/companies. */
const COMPANIES_PARAM_DOCS: Readonly<Record<string, ParamDoc>> = {
  limit: {
    description: (f) => `Employers per page, 1 to ${f.maxLimit} (default ${Math.min(f.companiesDefaultLimit, f.maxLimit)}).`,
    schema: (f) => ({ type: "integer", minimum: 1, maximum: f.maxLimit, default: Math.min(f.companiesDefaultLimit, f.maxLimit) }),
  },
  q: {
    description: "Text found in the employer's name or token (case-insensitive; the first 100 characters are read).",
    schema: { type: "string" },
  },
  cursor: {
    description: "page.nextCursor from the previous page. A cursor this API did not issue answers 400 bad_cursor.",
    schema: { type: "string" },
  },
};

const PARAM_LISTS = {
  jobs: { docs: JOBS_PARAM_DOCS, of: (f: RouterFacts) => f.jobsParams },
  changes: { docs: CHANGES_PARAM_DOCS, of: (f: RouterFacts) => f.changesParams },
  companies: { docs: COMPANIES_PARAM_DOCS, of: (f: RouterFacts) => f.companiesParams },
} as const;
type ParamList = keyof typeof PARAM_LISTS;

/** The parameter names each list has words for, so the guard can find words for a parameter no router list takes. */
export const DESCRIBED_PARAMS: Readonly<Record<ParamList, readonly string[]>> = {
  jobs: Object.keys(JOBS_PARAM_DOCS),
  changes: Object.keys(CHANGES_PARAM_DOCS),
  companies: Object.keys(COMPANIES_PARAM_DOCS),
};

function queryParameter(name: string, list: ParamList, f: RouterFacts): Json {
  const doc = PARAM_LISTS[list].docs[name];
  if (!doc) {
    return { name, in: "query", schema: { type: "string" }, description: "Taken by the router and not described here yet.", [UNDESCRIBED]: true };
  }
  const isList = doc.items !== undefined;
  const cap = f.listFilterCaps[name];
  const schema: Json = isList
    ? { type: "array", items: schemaOf(doc.items as FactSchema, f), ...(typeof cap === "number" ? { maxItems: cap } : {}) }
    : schemaOf(doc.schema ?? { type: "string" }, f);
  const capSentence = isList
    ? ` Comma-separated${typeof cap === "number" ? `, at most ${cap} values; more answers 400 invalid_value` : ""}.`
    : "";
  return {
    name,
    in: "query",
    ...(doc.required ? { required: true } : {}),
    description: `${text(doc.description, f)}${capSentence}`,
    ...(isList ? { style: "form", explode: false } : {}),
    schema,
    ...(name === "source" ? { "x-withheld-values": [...f.withheldSources] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

type FieldDoc = { schema: Json; description: FactText };

/** Every column in JOB_FIELDS. */
const JOB_FIELD_DOCS: Readonly<Record<string, FieldDoc>> = {
  id: {
    schema: { type: "string" },
    description: "The posting id, <source>:<company_token>:<the hiring system's own id>. Percent-encode it in a path (a / becomes %2F).",
  },
  source: { schema: { type: "string" }, description: "The hiring system the posting was read from." },
  company_token: { schema: { type: "string" }, description: "The employer board's token: the company_token filter, and /v1/companies." },
  company: { schema: { type: "string" }, description: "The employer's name as the board shows it." },
  title: { schema: { type: "string" }, description: "The title as the employer wrote it." },
  location: { schema: nullable("string"), description: "The location as the employer wrote it." },
  country: { schema: nullable("string"), description: "ISO 3166-1 alpha-2, or null when the posting was not placed in a country." },
  remote: { schema: nullable("boolean"), description: "Whether the posting reads as remote." },
  work_mode: { schema: nullable("string"), description: `One of ${prose([...WORK_MODES])}, or null when the posting does not say.` },
  department: { schema: nullable("string"), description: "The department as the employer gave it." },
  category: { schema: nullable("string"), description: "The job field (the category filter's values)." },
  posted_at: {
    schema: nullable("string", { format: "date-time" }),
    description: "The date the employer's own hiring system gives the posting, or null when it gives none.",
  },
  first_seen: {
    schema: nullable("string", { format: "date-time" }),
    description: "When this board first read the posting. It is not the posting's age. null on engine=ranked rows.",
  },
  apply_url: { schema: { type: "string" }, description: "The employer's own page for the posting." },
  salary: { schema: nullable("string"), description: "The pay as the posting states it." },
  salary_min_annual: { schema: nullable("number"), description: "The low end of the stated pay as a yearly figure, in salary_currency." },
  salary_max_annual: { schema: nullable("number"), description: "The high end of the stated pay as a yearly figure, in salary_currency." },
  salary_period: { schema: nullable("string"), description: "What the stated pay is per (for example hour, month or year)." },
  salary_currency: { schema: nullable("string"), description: "The currency of the stated pay." },
  experience_band: { schema: nullable("string"), description: `The experience band read from the posting (${prose([...EXPERIENCE_BANDS])}, or unspecified).` },
  min_years: { schema: nullable("integer"), description: "The fewest years of experience the posting asks for, when it says." },
  agency: {
    schema: nullable("boolean"),
    description: "true when the employer's board is a tagged staffing agency. Anyone republishing a row carries this disclosure with it.",
  },
  // OD16: the three columns a U.S. federal announcement carries (null off the federal feed).
  closes_at: {
    schema: nullable("string", { format: "date-time" }),
    description: "The closing date the employer's own system gives, when it gives one. On a U.S. federal row it is the agency's closing date, and the posting is open until then.",
  },
  who_may_apply: {
    schema: nullable("string"),
    description: "On a U.S. federal row, the agency's own statement of who may apply (for example U.S. citizens, or current federal employees). A federal row is served only once this is stored. null on every other row.",
  },
  hiring_paths: {
    schema: { type: ["array", "null"], items: { type: "string" } },
    description: "On a U.S. federal row, the hiring paths the agency lists (for example public, fed-competitive, veterans). null on every other row.",
  },
};

/** The block a U.S. federal row carries, on /v1/jobs, /v1/jobs/{id} and opened[] of /v1/changes. */
const FEDERAL_ROW_FIELD: FieldDoc = {
  schema: {
    type: "object",
    properties: {
      agency: { type: "string", description: "The hiring agency (also in company)." },
      official_url: { type: "string", description: "The announcement on USAJOBS, the official record." },
      on_board_since: { type: ["string", "null"], format: "date-time", description: "When our board first read the announcement. first_seen is null on a federal row on /v1/jobs, so it is never read as an age." },
      open_until: { type: ["string", "null"], description: "What open means for this row: until the agency's closing date, not that our last read listed it." },
      notice: { type: "string", description: "OPM's notice, carried with the row." },
    },
  },
  description: "U.S. federal rows only: the agency, the official announcement, our first sighting and what open means. meta.attribution on the same body carries OPM's credit and the date we read the feed.",
};

/** Set on every job row after the read (last-verified.ts), and the opt-in and engine-specific fields. */
const JOB_EXTRA_FIELDS: Readonly<Record<string, FieldDoc>> = {
  last_verified_at: {
    schema: nullable("string", { format: "date-time" }),
    description:
      "When the board last read the employer's feed. A large board is read in parts, so that read may not have included this posting: it is not proof the posting was listed then.",
  },
  last_seen: { schema: nullable("string", { format: "date-time" }), description: "The same value as last_verified_at." },
  description: {
    schema: nullable("string"),
    description: (f) => `The posting body. On /v1/jobs only with include=description (pages of at most ${f.maxLimitWithDescription}); always on /v1/jobs/{id}.`,
  },
  match_scope: {
    schema: { type: ["string", "null"] },
    description: "engine=ranked only: where the query matched. title when the title matched; employer when the employer's name or the department matched and the title did not; description when only the posting body did. null when the board does not say (most rows today): it is never a claim that nothing matched the title.",
  },
  federal: FEDERAL_ROW_FIELD,
};

/** The columns closed[] reads to decide suspectBatch and does not publish. */
export const CLOSED_READ_NOT_PUBLISHED = ["suspect", "batch_live_before"] as const;

/** Every column /v1/changes selects for opened[] and closed[]. */
const CHANGES_FIELD_DOCS: Readonly<Record<string, FieldDoc>> = {
  id: JOB_FIELD_DOCS.id,
  source: JOB_FIELD_DOCS.source,
  company_token: JOB_FIELD_DOCS.company_token,
  company: JOB_FIELD_DOCS.company,
  title: JOB_FIELD_DOCS.title,
  location: JOB_FIELD_DOCS.location,
  country: JOB_FIELD_DOCS.country,
  category: JOB_FIELD_DOCS.category,
  posted_at: JOB_FIELD_DOCS.posted_at,
  first_seen: { schema: { type: "string", format: "date-time" }, description: "When this board first read the posting: the time opened[] is keyed and paged on. It is not the posting's age." },
  apply_url: JOB_FIELD_DOCS.apply_url,
  event_id: { schema: { type: "integer" }, description: "The closure event's number. closed[] pages on (closed_at, event_id)." },
  posting_id: { schema: { type: "string" }, description: "The id the posting had while it was live." },
  closed_at: {
    schema: { type: "string", format: "date-time" },
    description: "When the posting was gone from the employer's feed, or, where closedAtIsObservation is true, when we could first see that it was.",
  },
  superseded: { schema: nullable("boolean"), description: "true when the posting was re-listed under a new id (outcome relisted)." },
  absence_basis: { schema: nullable("string"), description: "How the absence was established (lap_backfill marks an observation date; see closedAtIsObservation)." },
  closes_at: JOB_FIELD_DOCS.closes_at,
  who_may_apply: JOB_FIELD_DOCS.who_may_apply,
  hiring_paths: JOB_FIELD_DOCS.hiring_paths,
};

/** The keys closed[] rows gain on the way out. */
const CLOSED_DERIVED_FIELDS: Readonly<Record<string, FieldDoc>> = {
  outcome: { schema: { type: "string", enum: ["closed", "relisted"] }, description: "closed for a takedown; relisted when the same role came back under a new id." },
  suspectBatch: {
    schema: nullable("boolean"),
    description: "true for a batch the collector doubted (only with include_suspect=true); false for a batch it assessed and did not doubt; null for a closure written before batches were assessed.",
  },
  closedAtIsObservation: {
    schema: { type: "boolean" },
    description: "true when closed_at is when we could first see the posting was gone rather than when it went. Leave these rows out of any time-to-close series.",
  },
};
export const CLOSED_DERIVED = Object.keys(CLOSED_DERIVED_FIELDS);

function rowSchema(columns: readonly string[], docs: Readonly<Record<string, FieldDoc>>, f: RouterFacts, extra: Readonly<Record<string, FieldDoc>> = {}, required = true): Json {
  const properties: Json = {};
  for (const c of columns) {
    const d = docs[c];
    properties[c] = d
      ? { ...d.schema, description: text(d.description, f) }
      : { description: "Returned by the router and not described here yet.", [UNDESCRIBED]: true };
  }
  for (const [k, d] of Object.entries(extra)) properties[k] = { ...d.schema, description: text(d.description, f) };
  return { type: "object", ...(required ? { required: [...columns] } : {}), properties };
}

/** The field names each row has words for, so the guard can find words for a column the router does not return. */
export const DESCRIBED_FIELDS = {
  job: Object.keys(JOB_FIELD_DOCS),
  changes: Object.keys(CHANGES_FIELD_DOCS),
} as const;

// ---------------------------------------------------------------------------
// The words for each route.
// ---------------------------------------------------------------------------

/** A sample value: a literal, or an ISO timestamp this many days back, written in each language. */
type SampleValue = string | { readonly daysAgo: number };
type Sample = { query?: ReadonlyArray<readonly [string, SampleValue]>; resumeBody?: boolean };

type RouteDoc = {
  operationId: string;
  tag: string;
  summary: string;
  description: FactText;
  /** Needs Authorization: Bearer <key>. */
  keyed: boolean;
  /** Answered through the router's ETag check: If-None-Match can answer 304. */
  conditional: boolean;
  /** The router list that holds this route's query parameters; a route without one takes none. */
  params?: ParamList;
  /** POST /v1/fit's JSON body. */
  fitBody?: boolean;
  ok: { description: FactText; schema: FactSchema };
  /** Refusals of this route's own, beside the key check's (KEY_ERRORS). */
  errors: (f: RouterFacts) => ErrorDoc[];
  sample: Sample;
};

const QUERY_FAILED: ErrorDoc = [500, "query_failed", "The database query failed. Retry shortly."];
const UNKNOWN_PARAMETER: ErrorDoc = [400, "unknown_parameter", "A query parameter this route does not take. The message lists the ones it does."];

/** Every keyed route can answer these: the key is checked before the route runs, and a route that throws answers 500. */
const KEY_ERRORS: readonly ErrorDoc[] = [
  [401, "missing_key", "No key was sent, in Authorization: Bearer <key> or in x-api-key. The body's getAKey names the page and the one step that gets a free key, and the response carries WWW-Authenticate."],
  [401, "invalid_key", "The key is not recognised. The body carries the same getAKey block as missing_key."],
  [403, "key_revoked", "The key was revoked: a newer key replaced it, it went unused for 30 days, or it was issued before keys needed a confirmed mailbox. Get a new one from the docs page."],
  [429, "rate_limited", "Over the key's per-minute limit. Retry-After says 60."],
  [429, "quota_exceeded", "The key's daily quota is used. It resets at midnight UTC, and Retry-After counts the seconds to then."],
  [503, "auth_unavailable", "The key could not be checked just now. Retry shortly."],
  [500, "internal_error", "The request could not be completed. The rate and quota headers still say what the key has left."],
];

/** Refusals no operation owns: they answer a method or a path, not a route. */
const ANY_REQUEST_ERRORS: readonly ErrorDoc[] = [
  [405, "method_not_allowed", "A method this API does not answer: every route is GET except POST /v1/fit, and a GET to /v1/fit is refused before the key is read."],
  [404, "no_such_endpoint", "A path this API does not have. Answered before any key is read, and not metered."],
];

const ROUTES: Readonly<Record<string, RouteDoc>> = {
  "GET /v1": {
    operationId: "getIndex",
    tag: "About",
    summary: "The endpoint list, the tiers and the withheld hiring systems",
    description: (f) =>
      `Answers without a key. Lists every endpoint, what a free key includes beside the planned Builder tier, and the hiring systems this API does not hand on (${withheldOf(f)}). The same answer is served at / and /v1/.`,
    keyed: false,
    conditional: false,
    ok: { description: "The index.", schema: ref("Index") },
    errors: () => [],
    sample: {},
  },
  [`GET ${OPENAPI_PATH}`]: {
    operationId: "getOpenApi",
    tag: "About",
    summary: "This document",
    description: "Answers without a key and is not metered. The OpenAPI 3.1 description of /v1, built from the router's own constants.",
    keyed: false,
    conditional: false,
    ok: { description: "The OpenAPI document.", schema: { type: "object" } },
    errors: () => [],
    sample: {},
  },
  "GET /v1/jobs": {
    operationId: "listJobs",
    tag: "Jobs",
    summary: "Search live postings",
    description: (f) =>
      `Live postings only: not withdrawn by the employer, and dated within the last ${f.freshWindowDays} days. Rows from ${withheldOf(f)} are never returned. The default engine matches q against the title and pages newest first by cursor; engine=ranked (paid keys) runs the site's ranked search and pages by offset. An unknown parameter, or an unknown value in a closed list, answers 400 rather than an unfiltered page.`,
    keyed: true,
    conditional: true,
    params: "jobs",
    ok: { description: "A page of postings.", schema: ref("JobPage") },
    errors: (f) => [
      UNKNOWN_PARAMETER,
      [400, "unsupported_param", "A value outside a closed list (source, category, work_mode, experience_band, employment_type, include); sort on the default engine; or cursor, posted_before, include=description or remote=false with engine=ranked."],
      [400, "invalid_value", "A value that does not parse (limit, offset, max_years, max_age_days, salary_min, salary_max, a date, a true-or-false flag, engine, pay_basis), a country that is no country (a region, a name with two readings, or no reading at all), or more comma-separated values than a list takes."],
      [400, "bad_cursor", "A cursor this API did not issue."],
      [400, "offset_too_deep", `offset above ${f.maxOffset}. Page with cursor instead.`],
      [402, "upgrade_required", `engine=ranked on a free key. Ranked search is part of the planned Builder tier (${f.builderUrl}).`],
      [451, "source_not_redistributable", `source or company_token names a hiring system this API withholds (${withheldOf(f)}), or an employer on one. Drop it and the rest of the query is answered normally.`],
      QUERY_FAILED,
      [502, "ranked_unavailable", "engine=ranked: the ranked engine did not answer. Retry, or drop engine=ranked."],
    ],
    sample: { query: [["q", "nurse"], ["country", "US"], ["limit", "5"]] },
  },
  "GET /v1/jobs/{id}": {
    operationId: "getJob",
    tag: "Jobs",
    summary: "One live posting, with its description",
    description: (f) =>
      `The posting, its description included, while it is live: not withdrawn and dated within the last ${f.freshWindowDays} days.`,
    keyed: true,
    conditional: true,
    ok: { description: "The posting.", schema: { type: "object", required: ["apiVersion", "data"], properties: { apiVersion: { type: "string" }, data: ref("Job") } } },
    errors: (f) => [
      [400, "bad_id", "The id is not valid percent-encoding."],
      [400, "missing_id", "No id after /v1/jobs/."],
      [404, "not_found", `No live posting has that id: withdrawn by the employer, dated more than ${f.freshWindowDays} days ago, or from a withheld hiring system (${withheldOf(f)}).`],
      QUERY_FAILED,
    ],
    sample: {},
  },
  [`GET ${APPLICATION_ENDPOINT}`]: {
    operationId: "getApplicationForm",
    tag: "Jobs",
    summary: "The employer's application form for a live posting",
    description: APPLICATION_DESCRIPTION.replace(/^GET \S+ — /, ""),
    keyed: true,
    conditional: true,
    ok: { description: "The posting, its form, who answers each question, and the route to the employer's own page.", schema: ref("ApplicationForm") },
    errors: (f) => [
      [400, "unknown_parameter", "Any query parameter: this route takes none."],
      [400, "bad_id", "The id is not valid percent-encoding, or is not of the form <source>:<company_token>:<external id>."],
      [404, "not_found", "No live posting has that id, so there is no form to read."],
      [451, "source_not_redistributable", `The id names a hiring system this API withholds (${withheldOf(f)}).`],
      QUERY_FAILED,
      [503, "form_unreachable", `The employer's hiring system did not answer just now. Retry-After says ${FORM_UNREACHABLE_RETRY_S} seconds; the posting's apply_url still works.`],
    ],
    sample: {},
  },
  "GET /v1/changes": {
    operationId: "listChanges",
    tag: "Changes",
    summary: "What opened and what closed since a time",
    description: (f) =>
      `Two lists, each oldest first and paged on its own cursor: opened[] holds postings first read since \`since\`, and closed[] holds postings gone from the employer's feed, each marked closed or relisted. A free key reads ${f.freshWindowDays} days of opened[] and ${f.closuresMaxDaysFree} days of closed[]; a paid key reads ${f.changesMaxDaysPaid} days of both. Each list reads only up to its settledThrough. Keep a sync going by passing page.opened.resumeCursor and page.closed.resumeCursor back with the same since. Rows from ${withheldOf(f)} are never returned; the response's note says how every bound is drawn.`,
    keyed: true,
    conditional: true,
    params: "changes",
    ok: { description: "One page of each list.", schema: ref("ChangesPage") },
    errors: (f) => [
      UNKNOWN_PARAMETER,
      [400, "missing_since", "since is missing or is not a timestamp."],
      [400, "since_too_old", `since is further back than the key reaches: ${f.freshWindowDays} days on a free key, ${f.changesMaxDaysPaid} on a paid one.`],
      [400, "bad_cursor", "opened_cursor or closed_cursor was not issued by this API."],
      [400, "invalid_value", "limit is not a whole number, or include_suspect is not true or false."],
      QUERY_FAILED,
    ],
    sample: { query: [["since", { daysAgo: 1 }], ["limit", "100"]] },
  },
  "GET /v1/companies": {
    operationId: "listCompanies",
    tag: "Companies",
    summary: "The employer boards, by token",
    description: (f) =>
      `The employer boards the board carries, each with its company_token (the join key every other route filters by) and its count of open postings, counted by the board's refresh pass at asOf. Employers on ${withheldOf(f)} are left out. page.order says how the page is ordered.`,
    keyed: true,
    conditional: true,
    params: "companies",
    ok: { description: "A page of employer boards.", schema: ref("CompanyPage") },
    errors: () => [
      UNKNOWN_PARAMETER,
      [400, "invalid_value", "limit is not a whole number."],
      [400, "bad_cursor", "A cursor this API did not issue."],
      QUERY_FAILED,
    ],
    sample: { query: [["q", "health"], ["limit", "20"]] },
  },
  "GET /v1/stats": {
    operationId: "getStats",
    tag: "Stats",
    summary: "The board's own figures, each dated",
    description:
      "Live and tracked posting counts, freshness and coverage by hiring system, and the closure figures, each dated by the run that counted it. These are the board's own statistics, so they count the withheld hiring systems too.",
    keyed: true,
    conditional: true,
    ok: { description: "The figures.", schema: { type: "object", required: ["apiVersion", "data"], properties: { apiVersion: { type: "string" }, data: { type: "object" } } } },
    errors: () => [],
    sample: {},
  },
  "GET /v1/usage": {
    operationId: "getUsage",
    tag: "Account",
    summary: "This key's limits and recent use",
    description:
      "The key's per-minute and daily limits and what is left of each, its fit allowance, and its calls by day and by endpoint over the last 30 days. Only ever this key's own usage.",
    keyed: true,
    conditional: false,
    ok: { description: "The key's usage.", schema: ref("Usage") },
    errors: () => [
      [500, "no_key_context", "The key's identity was not available to the route."],
      QUERY_FAILED,
    ],
    sample: {},
  },
  [`POST ${FIT_ENDPOINT}`]: {
    operationId: "fitResume",
    tag: "Fit",
    summary: "Score a résumé against the board's best matches",
    description: (f) =>
      `Reads the occupation from resumeText (or uses q), searches the board for it, and scores up to ${f.fit.limitMax} postings against the résumé, with the terms each matched and missed. Nothing is stored. A free key whose email address was confirmed scores ${FIT_FREE_DAILY} calls a UTC day; paid keys, and keys on an account with a live paid plan, score up to ${FIT_PAID_DAILY}. On a free key a call that scored nothing is not counted. Rows from ${withheldOf(f)} are never returned.`,
    keyed: true,
    conditional: false,
    ok: { description: "The scored postings.", schema: ref("FitResult") },
    errors: (f) => [
      [400, "invalid_json", "The body is not JSON."],
      [400, "invalid_value", `resumeText is missing or shorter than ${f.fit.resumeTextMinChars} characters, or country names no country this API can read.`],
      [402, "fit_allowance_used", `The free allowance (${FIT_FREE_DAILY} scored calls a UTC day) is used. Retry-After counts the seconds to midnight UTC.`],
      [403, "confirmed_key_required", "A free key that was not issued through a confirmed link, on an account that has not proven its mailbox."],
      [429, "rate_limited", "The scorer's own daily allowance for this key is used. Retry-After says 3600."],
      [502, "scorer_unavailable", "The fit scorer did not answer. Retry shortly."],
      [503, "fit_allowance_unavailable", "The key's fit allowance could not be read just now. Retry-After says 30."],
    ],
    fitBody: true,
    sample: { resumeBody: true },
  },
};

/** The routes this file has words for. */
export const DESCRIBED_ROUTES: readonly string[] = Object.keys(ROUTES);

/** What POST /v1/fit's body fields mean. */
const FIT_BODY_DOCS: Readonly<Record<string, FieldDoc>> = {
  resumeText: {
    schema: { type: "string" },
    description: (f) => `The résumé as plain text, at least ${f.fit.resumeTextMinChars} characters. Only the first ${f.fit.resumeTextMaxChars} are read.`,
  },
  q: { schema: { type: "string" }, description: "A job title to search for instead of the occupation read from the résumé. Only the first 200 characters are read." },
  limit: { schema: { type: "integer", minimum: 1 }, description: (f) => `How many postings to score, 1 to ${f.fit.limitMax} (default ${f.fit.limitDefault}).` },
  country: { schema: { type: "string" }, description: "Codes or names to search in, comma-separated, read as ?country= on /v1/jobs reads them. A country it cannot read answers 400 invalid_value, never a search scored without it." },
  remote: { schema: { type: "boolean" }, description: "true searches remote postings only." },
};
export const DESCRIBED_FIT_FIELDS: readonly string[] = Object.keys(FIT_BODY_DOCS);

// ---------------------------------------------------------------------------
// Code samples.
// ---------------------------------------------------------------------------

const SH_DAYS_AGO = (n: number) =>
  `$(date -u -v-${n}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '${n} day ago' +%Y-%m-%dT%H:%M:%SZ)`;
const JS_DAYS_AGO = (n: number) => `new Date(Date.now() - ${n} * 86_400_000).toISOString()`;
const PY_DAYS_AGO = (n: number) => `(datetime.now(timezone.utc) - timedelta(days=${n})).isoformat()`;

function codeSamples(method: string, path: string, keyed: boolean, s: Sample, serverUrl: string): Json[] {
  const hasId = path.includes("{id}");
  const query = s.query ?? [];
  const usesDaysAgo = query.some(([, v]) => typeof v !== "string");

  // curl
  const sh: string[] = [];
  if (hasId) sh.push("# POSTING_ID: a row's id from /v1/jobs, percent-encoded (a / in it becomes %2F)");
  if (s.resumeBody) sh.push("# resume.txt: the résumé as plain text");
  const shUrl = `${serverUrl}${hasId ? path.replace("{id}", "$POSTING_ID") : path}`;
  const shLines: string[] = [];
  if (s.resumeBody) {
    shLines.push(`jq -Rs '{resumeText: .}' resume.txt | curl -X ${method} "${shUrl}"`);
  } else {
    shLines.push(`curl ${query.length ? "-G " : ""}"${shUrl}"`);
  }
  if (keyed) shLines.push(`  -H "Authorization: Bearer $RB_API_KEY"`);
  if (s.resumeBody) shLines.push(`  -H "Content-Type: application/json"`, "  --data-binary @-");
  for (const [k, v] of query) shLines.push(`  --data-urlencode "${k}=${typeof v === "string" ? v : SH_DAYS_AGO(v.daysAgo)}"`);
  sh.push(shLines.join(" \\\n"));

  // JavaScript fetch
  const js: string[] = [];
  if (s.resumeBody) js.push(`import { readFile } from "node:fs/promises";`, "", `const resumeText = await readFile("resume.txt", "utf8");`);
  if (hasId) js.push(`const id = "POSTING_ID"; // a row's id from /v1/jobs`);
  const jsPath = hasId ? path.replace("{id}", "${encodeURIComponent(id)}") : path;
  if (query.length) {
    const entries = query.map(([k, v]) => `  ${k}: ${typeof v === "string" ? JSON.stringify(v) : JS_DAYS_AGO(v.daysAgo)},`);
    js.push("const params = new URLSearchParams({", ...entries, "});");
  }
  const init: string[] = [];
  if (method !== "GET") init.push(`  method: ${JSON.stringify(method)},`);
  const headers: string[] = [];
  if (keyed) headers.push("Authorization: `Bearer ${process.env.RB_API_KEY}`");
  if (s.resumeBody) headers.push(`"Content-Type": "application/json"`);
  if (headers.length) init.push(`  headers: { ${headers.join(", ")} },`);
  if (s.resumeBody) init.push("  body: JSON.stringify({ resumeText }),");
  const jsUrl = `\`${serverUrl}${jsPath}${query.length ? "?${params}" : ""}\``;
  js.push(init.length ? `const res = await fetch(${jsUrl}, {\n${init.join("\n")}\n});` : `const res = await fetch(${jsUrl});`);
  js.push("const body = await res.json();", "if (!res.ok) throw new Error(`${res.status} ${body.error?.code}: ${body.error?.message}`);");

  // Python requests
  const imports = [
    ...(hasId ? ["from urllib.parse import quote"] : []),
    ...(usesDaysAgo ? ["from datetime import datetime, timedelta, timezone"] : []),
    ...(keyed ? ["import os"] : []),
    "import requests",
  ];
  const py: string[] = [...imports, ""];
  if (hasId) py.push(`posting_id = "POSTING_ID"  # a row's id from /v1/jobs`);
  if (s.resumeBody) py.push(`with open("resume.txt", encoding="utf-8") as fh:`, "    resume_text = fh.read()", "");
  const pyUrl = hasId ? `f"${serverUrl}${path.replace("{id}", "{quote(posting_id, safe='')}")}"` : JSON.stringify(`${serverUrl}${path}`);
  const args: string[] = [`    ${pyUrl},`];
  if (query.length) {
    const entries = query.map(([k, v]) => `${JSON.stringify(k)}: ${typeof v === "string" ? JSON.stringify(v) : PY_DAYS_AGO(v.daysAgo)}`);
    args.push(`    params={${entries.join(", ")}},`);
  }
  if (s.resumeBody) args.push(`    json={"resumeText": resume_text},`);
  if (keyed) args.push(`    headers={"Authorization": f"Bearer {os.environ['RB_API_KEY']}"},`);
  args.push(`    timeout=${s.resumeBody ? 60 : 30},`);
  py.push(`r = requests.${method.toLowerCase()}(`, ...args, ")", "r.raise_for_status()", "print(r.json())");

  return [
    { lang: "Shell", label: "curl", source: sh.join("\n") },
    { lang: "JavaScript", label: "fetch", source: js.join("\n") },
    { lang: "Python", label: "requests", source: py.join("\n") },
  ];
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

/** "/v1/jobs" -> "GET /v1/jobs"; "POST /v1/fit" stays. */
export function routeKeyOf(endpoint: string): string {
  const s = endpoint.trim();
  return /^(GET|POST|PUT|PATCH|DELETE) /.test(s) ? s : `GET ${s}`;
}

/** The route this document is served at, which the index names in its own `openapi` field. */
export const DOCUMENT_ROUTE = `GET ${OPENAPI_PATH}`;

/** The routes the document describes: the index itself, this document, and every endpoint the index lists. */
export function servedRoutes(f: RouterFacts): string[] {
  return ["GET /v1", DOCUMENT_ROUTE, ...f.endpoints.map(routeKeyOf).filter((r) => r !== "GET /v1" && r !== DOCUMENT_ROUTE)];
}

const HEADER = (description: string, type = "integer"): Json => ({ description, schema: { type } });

function rateHeaders(): Json {
  return {
    "X-RateLimit-Limit": HEADER("The key's requests per minute."),
    "X-RateLimit-Remaining": HEADER("Requests left this minute."),
    "X-Quota-Limit": HEADER("The key's requests per UTC day."),
    "X-Quota-Remaining": HEADER("Requests left today."),
    "X-Api-Version": HEADER("The API version that answered (info.version).", "string"),
  };
}

/** Group a route's refusals into one response per status, each naming its codes. */
function errorResponses(errors: readonly ErrorDoc[]): Json {
  const byStatus = new Map<number, ErrorDoc[]>();
  for (const e of errors) {
    const list = byStatus.get(e[0]) ?? [];
    list.push(e);
    byStatus.set(e[0], list);
  }
  const out: Json = {};
  for (const [status, list] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    const codes = [...new Set(list.map((e) => e[1]))];
    const retrySentWith = codes.filter((c) => list.some((e) => e[1] === c && /Retry-After/.test(e[2])));
    const headers: Json = retrySentWith.length
      ? { "Retry-After": HEADER(`Seconds to wait before retrying; sent with ${prose(retrySentWith)}.`) }
      : {};
    out[String(status)] = {
      description: list.map((e) => `${e[1]}: ${e[2]}`).join("\n\n"),
      ...(retrySentWith.length ? { headers, "x-retry-after-codes": retrySentWith } : {}),
      content: { "application/json": { schema: ref("Error") } },
      "x-error-codes": codes,
    };
  }
  return out;
}

function operation(route: string, doc: RouteDoc | undefined, f: RouterFacts, serverUrl: string): Json {
  const [method, path] = route.split(" ");
  if (!doc) {
    return {
      summary: "Answered by the router and not described here yet.",
      responses: { default: { description: "Not described here yet." } },
      [UNDESCRIBED]: true,
    };
  }
  const parameters: Json[] = [];
  if (path.includes("{id}")) {
    parameters.push({
      name: "id",
      in: "path",
      required: true,
      description: "A posting id as /v1/jobs returns it, <source>:<company_token>:<external id>, percent-encoded.",
      schema: { type: "string" },
    });
  }
  if (doc.params) for (const name of PARAM_LISTS[doc.params].of(f)) parameters.push(queryParameter(name, doc.params, f));
  if (doc.conditional) {
    parameters.push({
      name: "If-None-Match",
      in: "header",
      description: "An ETag from an earlier answer. When nothing changed the answer is 304 with no body; the call still counts against the key's limits.",
      schema: { type: "string" },
    });
  }
  const okHeaders: Json = { ...(doc.keyed ? rateHeaders() : {}), ...(doc.conditional ? { ETag: HEADER("Send it back as If-None-Match.", "string") } : {}) };
  const responses: Json = {
    "200": {
      description: text(doc.ok.description, f),
      ...(Object.keys(okHeaders).length ? { headers: okHeaders } : {}),
      content: { "application/json": { schema: schemaOf(doc.ok.schema, f) } },
    },
    ...(doc.conditional ? { "304": { description: "Not modified: If-None-Match matched. No body; the call still counts.", headers: { ETag: HEADER("The same ETag.", "string") } } } : {}),
    ...errorResponses([...doc.errors(f), ...(doc.keyed ? KEY_ERRORS : [])]),
  };
  let requestBody: Json | undefined;
  if (doc.fitBody) {
    const properties: Json = {};
    for (const field of f.fit.bodyFields) {
      const d = FIT_BODY_DOCS[field];
      properties[field] = d
        ? { ...d.schema, description: text(d.description, f), ...(field === "limit" ? { maximum: f.fit.limitMax, default: f.fit.limitDefault } : {}), ...(field === "resumeText" ? { minLength: f.fit.resumeTextMinChars } : {}) }
        : { description: "Read by the router and not described here yet.", [UNDESCRIBED]: true };
    }
    requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object", required: ["resumeText"], properties } } },
    };
  }
  return {
    operationId: doc.operationId,
    tags: [doc.tag],
    summary: doc.summary,
    description: text(doc.description, f),
    ...(doc.keyed ? {} : { security: [] }),
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
    "x-codeSamples": codeSamples(method, path, doc.keyed, doc.sample, serverUrl),
  };
}

/** Every refusal the served routes can give, once each, as status and code. */
function errorCatalogue(f: RouterFacts): Array<{ status: number; code: string }> {
  const all = [
    ...servedRoutes(f).flatMap((r) => ROUTES[r]?.errors(f) ?? []),
    ...KEY_ERRORS,
    ...ANY_REQUEST_ERRORS,
  ];
  const seen = new Map<string, { status: number; code: string }>();
  for (const [status, code] of all) seen.set(`${status} ${code}`, { status, code });
  return [...seen.values()].sort((a, b) => a.status - b.status || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function components(f: RouterFacts): Json {
  const codes = [...new Set(errorCatalogue(f).map((e) => e.code))].sort();
  const page = (props: Json): Json => ({ type: "object", properties: props });
  const cursorOrNull = nullable("string");
  return {
    securitySchemes: {
      bearerKey: {
        type: "http",
        scheme: "bearer",
        description: `A key from ${f.docsUrl}. ${GET_A_KEY_STEP} Send it as Authorization: Bearer <key>, or in x-api-key. A free key is issued with ${f.freeKeyIssued.perMinute} requests a minute and ${f.freeKeyIssued.perDay} a day; every response's X-RateLimit-* and X-Quota-* headers carry the key's own.`,
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "The same key, in x-api-key, for a client that already sends another credential in Authorization (a Supabase publishable key, say): a key starting rb_live_ in either header is the one read.",
      },
    },
    responses: {
      NoSuchEndpoint: { description: ANY_REQUEST_ERRORS[1][2], content: { "application/json": { schema: ref("Error") } } },
      MethodNotAllowed: { description: ANY_REQUEST_ERRORS[0][2], content: { "application/json": { schema: ref("Error") } } },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "apiVersion"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", enum: codes, description: "What a program branches on." },
              message: { type: "string", description: "What a person reads." },
            },
          },
          apiVersion: { type: "string" },
          getAKey: { type: "object", description: "401 missing_key and invalid_key only: url (the page), step (the one step that gets a free key), free (the limits a free key is issued with) and send (the two headers that carry it)." },
          keylessSample: { type: "object", description: "401s only: offered is false in this build; instead names the keyless route to the same board." },
          openapi: { type: "string", description: "401s only: where this document is served, with no key." },
        },
      },
      Job: rowSchema(f.jobFields, JOB_FIELD_DOCS, f, JOB_EXTRA_FIELDS),
      JobPage: {
        type: "object",
        required: ["apiVersion", "data", "page", "total"],
        properties: {
          apiVersion: { type: "string" },
          engine: { type: "string", enum: ["ranked"], description: "Present only on an engine=ranked answer." },
          data: { type: "array", items: ref("Job") },
          page: page({
            limit: { type: "integer" },
            maxLimit: { type: "integer", description: "The cap that applied to this request. A larger limit was cut to it, and disclosures.limitCapped says so." },
            offset: { type: "integer" },
            returned: { type: "integer" },
            nextCursor: { ...cursorOrNull, description: "Pass as cursor= for the next page (default engine); null on the last page." },
            nextOffset: { ...nullable("integer"), description: "Pass as offset= for the next page; null past the offset cap or on the last page." },
            refillReads: { type: "integer", description: "engine=ranked only: how many more board reads (at most two) filled this page after rows from the withheld hiring systems, or unlabelled federal rows, were dropped from it." },
            pageShortBecause: {
              type: "string",
              enum: ["refill_limit", "deepest_offset", "time_budget", "board_moved", "board_error", "no_next_offset"],
              description: "engine=ranked only, and only on a page shorter than limit while nextOffset says more exist: why it was not filled. Ask for the next page with offset = nextOffset.",
            },
          }),
          total: { type: "object", description: "value is the count of matching postings, or null when it could not be counted in time; basis says how it was counted." },
          coverage: {
            type: "object",
            description: "The serving window, and with a salary floor the share of postings a floor can see.",
            properties: {
              feedFreshness: {
                type: "object",
                description: "How long ago the employer feeds behind live postings were re-read, measured: p50Minutes, p95Minutes, asOf (when it was measured) and basis. Our re-check cadence, not a posting's age. Absent when the measurement could not be read in time.",
                properties: { p50Minutes: { type: "number" }, p95Minutes: { type: "number" }, asOf: { type: "string", format: "date-time" }, basis: { type: "string" } },
              },
            },
          },
          disclosures: {
            type: "object",
            description: "What the engine did that a caller would otherwise not see: a capped page, unknown employer tokens, a country read from its name, and on engine=ranked the board's own notes and the withheld hiring systems.",
            properties: {
              limitCapped: { type: "object", description: "requested, applied and reason (max_limit, or include=description): the limit asked for was above the cap and was cut." },
              countryRead: { type: "object", description: "read maps each country entry that was not already its ISO code to the code it was searched as (Ireland -> IE); notes says when a part of a country (Scotland) was searched as the whole country." },
            },
          },
          diagnostics: { type: "object", description: "explain=1 only." },
        },
      },
      ApplicationForm: {
        type: "object",
        required: ["apiVersion", "data"],
        properties: {
          apiVersion: { type: "string" },
          data: { type: "object", description: "The posting's fields, its form (questions, each with answeredBy), route (route.submitter is always you) and postingTerms." },
          answeredByMeans: { type: "object", description: "What each answeredBy value means." },
          note: { type: "string" },
        },
      },
      OpenedRow: rowSchema(f.changesOpenedFields, CHANGES_FIELD_DOCS, f, { federal: FEDERAL_ROW_FIELD }),
      ClosedRow: rowSchema(
        f.changesClosedFields.filter((c) => !(CLOSED_READ_NOT_PUBLISHED as readonly string[]).includes(c)),
        CHANGES_FIELD_DOCS,
        f,
        CLOSED_DERIVED_FIELDS,
      ),
      ChangesPage: {
        type: "object",
        required: ["apiVersion", "since", "opened", "closed", "page"],
        properties: {
          apiVersion: { type: "string" },
          since: { type: "string", format: "date-time" },
          opened: { type: "array", items: ref("OpenedRow") },
          closed: { type: "array", items: ref("ClosedRow") },
          page: page({
            limit: { type: "integer" },
            maxLimit: { type: "integer", description: "The cap that applied to this request." },
            openedReturned: { type: "integer", description: "The opened rows this page served." },
            closedReturned: { type: "integer" },
            opened: ref("ChangesCursor"),
            closed: ref("ChangesCursor"),
          }),
          closureHistoryDays: { type: "integer" },
          openedHistoryDays: { type: "integer" },
          closureSince: { type: "string", format: "date-time" },
          closureWindowNarrowed: { type: "boolean" },
          suspectBatchesIncluded: { type: "boolean" },
          excludedSources: { type: "object" },
          disclosures: { type: "object", description: "limitCapped, when the limit asked for was above the cap." },
          note: { type: "string" },
        },
      },
      ChangesCursor: page({
        hasMore: { type: "boolean" },
        nextCursor: { ...cursorOrNull, description: "The next page of this list." },
        resumeCursor: { ...cursorOrNull, description: "Store it and pass it back with the same since to keep a sync going." },
        settledThrough: { type: "string", format: "date-time", description: "This list reads only up to here." },
      }),
      CompanyPage: {
        type: "object",
        required: ["apiVersion", "data", "page"],
        properties: {
          apiVersion: { type: "string" },
          data: {
            type: "array",
            items: page({ company_token: cursorOrNull, company: nullable("string"), open_postings: nullable("integer") }),
          },
          page: page({
            limit: { type: "integer" },
            maxLimit: { type: "integer", description: "The cap that applied to this request." },
            returned: { type: "integer" },
            matched: { type: "integer" },
            hasMore: { type: "boolean" },
            nextCursor: cursorOrNull,
            order: { type: "string" },
          }),
          excludedSources: { type: "object" },
          disclosures: { type: "object", description: "limitCapped, when the limit asked for was above the cap." },
          asOf: nullable("string", { format: "date-time" }),
          countsCarried: { type: "boolean" },
          basis: { type: "string" },
        },
      },
      Usage: {
        type: "object",
        required: ["apiVersion"],
        properties: {
          apiVersion: { type: "string" },
          limits: page({ perMinute: { type: "integer" }, perDay: { type: "integer" } }),
          remaining: page({ thisMinute: { type: "integer" }, today: { type: "integer" } }),
          fit: { type: "object", description: "The key's fit allowance, by the same rule POST /v1/fit applies." },
          byDay: { type: "object", additionalProperties: { type: "integer" } },
          byEndpoint: { type: "array", items: page({ day: { type: "string" }, endpoint: { type: "string" }, calls: { type: "integer" } }) },
        },
      },
      FitResult: {
        type: "object",
        required: ["apiVersion", "data"],
        properties: {
          apiVersion: { type: "string" },
          terms: { type: "array", items: { type: "string" }, description: "The occupations read from the résumé." },
          query: { ...nullable("string"), description: "What the board was searched for; null when no occupation was read and no q was sent." },
          data: {
            type: "array",
            items: page({
              id: { type: "string" },
              title: { type: "string" },
              company: { type: "string" },
              company_token: { type: "string" },
              location: nullable("string"),
              apply_url: { type: "string" },
              fit: { ...nullable("number"), description: "The scorer's fit for this posting." },
              matched: { type: "array", items: { type: "string" } },
              missing: { type: "array", items: { type: "string" } },
            }),
          },
          allowance: { type: "object", description: "The fit allowance after this call." },
          note: { type: "string" },
        },
      },
      Index: {
        type: "object",
        required: ["apiVersion", "endpoints"],
        properties: {
          apiVersion: { type: "string" },
          docs: { type: "string" },
          openapi: { type: "string", description: "Where this document is served, with no key." },
          endpoints: { type: "array", items: { type: "string" } },
          auth: { type: "string" },
          getAKey: { type: "object", description: "url, step, free and send: where a free key comes from, in one step, and the two headers that carry it." },
          keylessSample: { type: "object", description: "offered is false in this build; instead names the keyless route to the same board." },
          modes: { type: "object" },
          tiers: { type: "object" },
          restrictions: { type: "object" },
        },
      },
    },
  };
}

/**
 * The OpenAPI 3.1 document for /v1, from the router's facts and the address
 * the paths are relative to (publicApiServer of the project's Supabase URL).
 */
export function openApiDocument(f: RouterFacts, serverUrl: string): Json {
  const paths: Record<string, Json> = {};
  for (const route of servedRoutes(f)) {
    const path = route.slice(route.indexOf(" ") + 1);
    const method = route.slice(0, route.indexOf(" ")).toLowerCase();
    paths[path] = { ...(paths[path] ?? {}), [method]: operation(route, ROUTES[route], f, serverUrl) };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Resume Booster hiring data API",
      version: f.apiVersion,
      summary: "Live job postings read from employers' own hiring systems, and what opened and closed.",
      description: [
        `Every row is a live posting: not withdrawn by the employer, and dated within the last ${f.freshWindowDays} days.`,
        `${f.withheldReason} Naming one in ?source=, or asking for the application form of one of their postings, answers 451 source_not_redistributable rather than an empty page.`,
        "Every error is JSON, { error: { code, message }, apiVersion }: a program reads code, a person reads message. A route other than POST /v1/fit answers GET (and HEAD, as GET with no body) only (405 method_not_allowed), and an unknown path answers 404 no_such_endpoint before any key is read. One trailing slash is ignored.",
        `Get a key at ${f.docsUrl}: ${GET_A_KEY_STEP} Send it as Authorization: Bearer <key> or x-api-key: <key>. There is no keyless sample of /v1 in this build: ${KEYLESS_SAMPLE.instead} This document, at ${OPENAPI_PATH}, needs no key and is not metered.`,
        `A free key is issued with ${f.freeKeyIssued.perMinute} requests a minute and ${f.freeKeyIssued.perDay} a day. The planned Builder tier (${f.builderUrl}) proposes ${f.builderProposed.perMinute} a minute and ${f.builderProposed.perDay} a day, ranked search, and ${f.changesMaxDaysPaid} days of closure history; it is not on sale yet.`,
      ].join("\n\n"),
    },
    externalDocs: { description: "Keys, limits and licensing", url: f.docsUrl },
    servers: [{ url: serverUrl }],
    security: [{ bearerKey: [] }, { apiKey: [] }],
    tags: [
      { name: "About" },
      { name: "Jobs" },
      { name: "Changes" },
      { name: "Companies" },
      { name: "Stats" },
      { name: "Account" },
      { name: "Fit" },
    ],
    paths,
    components: components(f),
    "x-errors": errorCatalogue(f),
    "x-withheld-sources": { sources: [...f.withheldSources], reason: f.withheldReason, status: 451, code: "source_not_redistributable" },
    "x-get-a-key": { url: f.docsUrl, step: GET_A_KEY_STEP, free: { perDay: f.freeKeyIssued.perDay, perMinute: f.freeKeyIssued.perMinute }, send: ["Authorization: Bearer <key>", "x-api-key: <key>"] },
    "x-keyless-sample": KEYLESS_SAMPLE,
    "x-tiers": {
      free: {
        issuedWith: { perDay: f.freeKeyIssued.perDay, perMinute: f.freeKeyIssued.perMinute },
        fitPerDay: FIT_FREE_DAILY,
        closureHistoryDays: f.closuresMaxDaysFree,
        openedHistoryDays: f.freshWindowDays,
        rankedEngine: false,
      },
      builder: {
        status: "planned",
        proposed: { perDay: f.builderProposed.perDay, perMinute: f.builderProposed.perMinute, fitPerDay: FIT_PAID_DAILY, closureHistoryDays: f.changesMaxDaysPaid, rankedEngine: true },
        url: f.builderUrl,
      },
    },
  };
}
