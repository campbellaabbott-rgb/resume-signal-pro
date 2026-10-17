// Rationale: docs/job-board-index-notes.md#n1051-import-job_categories-from-categories-ts
import { JOB_CATEGORIES } from "./categories.ts";
import { isExperienceBand } from "./experience.ts";
import { SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import type { JobSourceKind } from "./sources.ts";

// Defined in ../_shared/board-domains.ts so public-api's bundle can read the
// same list; re-exported here because this file is the board's filter contract.
export { WORK_MODES } from "../_shared/board-domains.ts";
import { WORK_MODES } from "../_shared/board-domains.ts";
/** Closed domain, matching the column CHECK — values come from vendors'
 *  structured fields only (nine of sixteen carry one, measured 2026-08-28). */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;

/** "hourly" -> salary_period = 'hour'; "salaried" -> salary_period IN ('year','month'). */
export const PAY_BASES = ["hourly", "salaried"] as const;

// Rationale: docs/job-board-index-notes.md#n1256-export-const-salaried_periods-year-month
export const SALARIED_PERIODS = ["year", "month"] as const;

// Rationale: docs/job-board-index-notes.md#n1257-export-board_vendors-from-_shared-board
export { BOARD_VENDORS } from "../_shared/board-domains.ts";
import { BOARD_VENDORS } from "../_shared/board-domains.ts";
// Extras are still caught here, where JobSourceKind lives: a vendor in the
// shared list that sources.ts does not know fails this assignment.
const _vendorsAreKinds: readonly JobSourceKind[] = BOARD_VENDORS;
void _vendorsAreKinds;

type _UnlistedKind = Exclude<JobSourceKind, (typeof BOARD_VENDORS)[number]>;
// Rationale: docs/job-board-index-notes.md#n1052-type-_kindsarecovered-_unlistedkind-exte
type _KindsAreCovered = [_UnlistedKind] extends [never] ? true
  : ["BOARD_VENDORS is missing a JobSourceKind:", _UnlistedKind];
const _kindsAreCovered: _KindsAreCovered = true;
void _kindsAreCovered;

export type AppliedFilters = {
  q: string;
  location: string;
  country: string | null;
  remote: boolean;
  workMode: string | null;
  /** Comma-joined subset of EMPLOYMENT_TYPES, same list contract as workMode. */
  employmentType: string | null;
  // Rationale: docs/job-board-index-notes.md#n1258-category-string-null
  category: string | null;
  // Rationale: docs/job-board-index-notes.md#n1259-includeuncategorised-boolean
  includeUncategorised: boolean;
  // Rationale: docs/job-board-index-notes.md#n1260-sendableonly-boolean
  sendableOnly: boolean;
  experience: string[];
  salaryFloor: number | null;
  // Rationale: docs/job-board-index-notes.md#n1261-includeunstatedpay-boolean
  includeUnstatedPay: boolean;
  // Rationale: docs/job-board-index-notes.md#n1262-salaryceiling-number-null
  salaryCeiling: number | null;
  // Rationale: docs/job-board-index-notes.md#n1263-paybasis-string-null
  payBasis: string | null;
  // Rationale: docs/job-board-index-notes.md#n1264-hasstatedpay-boolean
  hasStatedPay: boolean;
  // Rationale: docs/job-board-index-notes.md#n1265-maxyears-number-null
  maxYears: number | null;
  // Rationale: docs/job-board-index-notes.md#n1266-department-string-null
  department: string | null;
  // Rationale: docs/job-board-index-notes.md#n1267-vendors-string
  vendors: string[];
  companies: string[];
  maxAgeDays: number | null;
  postedAfter: string | null;
  // Rationale: docs/job-board-index-notes.md#n1268-newsince-string-null
  newSince: string | null;
  // Rationale: docs/job-board-index-notes.md#n1269-excludeagencies-boolean
  excludeAgencies: boolean;
  // Rationale: docs/job-board-index-notes.md#n1270-hasdescription-boolean
  hasDescription: boolean;
};

// Rationale: docs/job-board-index-notes.md#n1271-const-rpc_bound_filters-new-set-keyof-ap
const RPC_BOUND_FILTERS = new Set<keyof AppliedFilters>([
  "q",
  "location",
  "country",
  "remote",
  "workMode",
  "employmentType",
  "category",
  "includeUncategorised",
  "sendableOnly",
  "experience",
  "salaryFloor",
  // Rationale: docs/job-board-index-notes.md#n1053-excludeagencies
  "excludeAgencies",
  // Rationale: docs/job-board-index-notes.md#n1054-hasstatedpay
  "hasStatedPay",
  "includeUnstatedPay",
  "companies",
  "maxAgeDays",
  "postedAfter",
  // Rationale: docs/job-board-index-notes.md#n1055-salaryceiling
  "salaryCeiling",
  "payBasis",
  "maxYears",
  "department",
  "vendors",
]);

// Rationale: docs/job-board-index-notes.md#n1272-export-function-payparams-a-appliedfilte
// Rationale: docs/job-board-index-notes.md#n1273-export-function-payparams-a-appliedfilte
export function payParams(a: AppliedFilters): Record<string, unknown> {
  return {
    // Rationale: docs/job-board-index-notes.md#n1056-a-hasstatedpay-p_pay_stated-true
    ...(a.hasStatedPay ? { p_pay_stated: true } : {}),
    ...(a.includeUnstatedPay ? { p_include_unstated: true } : {}),
  };
}

export function rpcBlindFilters(a: AppliedFilters): string[] {
  return Object.entries(a as Record<string, unknown>)
    .filter(([k, v]) => {
      if (RPC_BOUND_FILTERS.has(k as keyof AppliedFilters)) return false;
      if (Array.isArray(v)) return v.length > 0;
      return typeof v === "boolean" ? v : v !== null && v !== "";
    })
    .map(([k]) => k);
}

export type NormalizedFilters = {
  applied: AppliedFilters;
  ignored: string[];
  // Rationale: docs/job-board-index-notes.md#n1274-maxageclamped-boolean
  maxAgeClamped: boolean;
};

// Rationale: docs/job-board-index-notes.md#n1057-const-asbands-v-unknown-string
const asBands = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const sent = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "";

/** A company token as the catalogue spells them: nothing PostgREST would read as list syntax. */
export const COMPANY_TOKEN_SHAPE = /^[A-Za-z0-9~_.:-]{1,128}$/;

/** An ISO-8601 date, or date and time with an optional Z or +hh:mm / +hhmm zone. Group 1 is the zone. */
export const POSTED_AFTER_SHAPE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

// Rationale: docs/job-board-index-notes.md#n1275-export-function-canonicalinstant-raw-unk
export function canonicalInstant(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const m = POSTED_AFTER_SHAPE.exec(t);
  if (!m) return null;
  const iso = t.replace(" ", "T");
  const ms = Date.parse(/T\d/.test(iso) && !m[1] ? `${iso}Z` : iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Rationale: docs/job-board-index-notes.md#n1276-export-const-iso_alpha2-readonlyset-stri
/** ISO 3166-1 alpha-2, the 249 assigned codes, plus XK (Kosovo, in common use). */
export const ISO_ALPHA2: ReadonlySet<string> = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" "),
);
/** The usual wrong spelling, read as the code it means. */
export const COUNTRY_ALIASES: ReadonlyMap<string, string> = new Map([["UK", "GB"]]);

export const SALARY_IN_QUERY =/^\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k?)\+?$/i;

/**
 * Only a figure that cannot be anything else is money: a $, a thousands
 * comma, a trailing +, or a k (never 401k), or a bare number of six digits or
 * more. "new grad 2026", "1099 sales", "rtx 4090" and a zip code are not pay
 * floors (2,026 / 1,099 / 4,090 / 94,105). Rationale: docs/job-board-index-notes.md#n430-a-pay-figure-must-be-unambiguous
 */
function unambiguousMoney(t: string, b: string): boolean {
  if (t.startsWith("$") || t.endsWith("+") || b.includes(",")) return true;
  if (b.endsWith("k")) return b !== "401k";
  return /^\d{6,}$/.test(b);
}

/** The pay figure in the search box: the floor, and exactly the token it came from (L8-03). */
export function salaryTokenInQuery(raw: unknown): { floor: number; token: string } | null {
  for (const t of String(raw ?? "").toLowerCase().split(/\s+/)) {
    const m = SALARY_IN_QUERY.exec(t);
    if (!m || !unambiguousMoney(t, m[1])) continue;
    const b = m[1];
    const n = b.endsWith("k") ? Number(b.slice(0, -1)) * 1_000 : Number(b.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 1_000 || n > 2_000_000) continue;
    return { floor: n, token: t };
  }
  return null;
}

export function salaryFromQueryText(raw: unknown): number | null {
  return salaryTokenInQuery(raw)?.floor ?? null;
}

export function normalizeFilters(
  body: Record<string, unknown>,
  companyTokenLimit: number,
): NormalizedFilters {
  const ignored: string[] = [];

  // Rationale: docs/job-board-index-notes.md#n1058-const-country_limit
  const COUNTRY_LIMIT = 5;
  // ISO-3166 alpha-2, with "UK" read as GB: "XX" or "UK" matched no row and
  // answered 0 jobs with nothing named (L8-10). An unknown code is dropped and named.
  const countrySent = (Array.isArray(body.country) ? body.country : String(body.country ?? "").split(","))
    .map((c) => String(c ?? "").trim().toUpperCase())
    .filter(Boolean)
    .map((c) => COUNTRY_ALIASES.get(c) ?? c);
  const countryList = countrySent.filter((c) => ISO_ALPHA2.has(c));
  const countryAsked = [...new Set(countryList)];
  const country = countryAsked.length
    ? countryAsked.slice(0, COUNTRY_LIMIT).join(",")
    : null;
  if (countryList.length !== countrySent.length) ignored.push("country");
  // Rationale: docs/job-board-index-notes.md#n1059-if-sent-body-country-country-countryaske
  if (sent(body.country) && (!country || countryAsked.length > COUNTRY_LIMIT) && !ignored.includes("country")) ignored.push("country");

  // Rationale: docs/job-board-index-notes.md#n1060-const-category_limit
  const CATEGORY_LIMIT = 3;
  const categoryList = (Array.isArray(body.category) ? body.category : String(body.category ?? "").split(","))
    .map((c) => String(c ?? "").trim().toLowerCase())
    .filter((c) => (JOB_CATEGORIES as readonly string[]).includes(c));
  const categoryAsked = [...new Set(categoryList)];
  const category = categoryAsked.length
    ? categoryAsked.slice(0, CATEGORY_LIMIT).join(",")
    : null;
  // Same truncation-is-reported rule as country above.
  if (sent(body.category) && (!category || categoryAsked.length > CATEGORY_LIMIT)) ignored.push("category");

  // Rationale: docs/job-board-index-notes.md#n1061-const-wantsuncategorised-category-null-c
  const wantsUncategorised = category !== null && !category.split(",").includes("other") && body.includeUncategorised === true;

  // Rationale: docs/job-board-index-notes.md#n1062-const-sortingbysalary-string-body-sort-s
  const sortingBySalary = String(body.sort ?? "") === "salary";
  const includeUncategorised = wantsUncategorised && !sortingBySalary;
  if (wantsUncategorised && sortingBySalary) ignored.push("includeUncategorised");

  // Literal true only, same contract as includeUncategorised: a truthy string
  // from a query param must not silently narrow a search to 5.4% of the board.
  const sendableOnly = body.sendableOnly === true;

  // Rationale: docs/job-board-index-notes.md#n1063-const-excludeagencies-body-excludeagenci
  const excludeAgencies = body.excludeAgencies === true;
  const hasDescription = body.hasDescription === true;

  // Rationale: docs/job-board-index-notes.md#n1064-const-wmasked-array-isarray-body-workmod
  const wmAsked = (Array.isArray(body.workMode) ? body.workMode : String(body.workMode ?? "").split(","))
    .map((m) => String(m ?? "").trim().toLowerCase())
    .filter((m) => m.length > 0);
  const wmValid = [...new Set(wmAsked.filter((m) => (WORK_MODES as readonly string[]).includes(m)))]
    .slice(0, WORK_MODES.length);
  const workMode = wmValid.length ? wmValid.join(",") : null;
  // Rationale: docs/job-board-index-notes.md#n1065-if-sent-body-workmode-wmvalid-length
  if (sent(body.workMode) && wmValid.length !== new Set(wmAsked).size) ignored.push("workMode");

  // Rationale: docs/job-board-index-notes.md#n1066-const-etasked-array-isarray-body-employm
  const etAsked = (Array.isArray(body.employmentType) ? body.employmentType : String(body.employmentType ?? "").split(","))
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);
  const etValid = [...new Set(etAsked.filter((t) => (EMPLOYMENT_TYPES as readonly string[]).includes(t)))]
    .slice(0, EMPLOYMENT_TYPES.length);
  const employmentType = etValid.length ? etValid.join(",") : null;
  // Deduped comparison, same reason as workMode: "contract,contract" must not
  // report the filter as ignored.
  if (sent(body.employmentType) && etValid.length !== new Set(etAsked).size) ignored.push("employmentType");

  // Rationale: docs/job-board-index-notes.md#n1067-const-bandsasked-asbands-body-experience
  const bandsAsked = asBands(body.experience);
  const experience = bandsAsked.filter(isExperienceBand);
  if (bandsAsked.length && experience.length !== bandsAsked.length) ignored.push("experience");

  // Rationale: docs/job-board-index-notes.md#n1068-const-explicitfloor-number-body-salaryfl
  const explicitFloor = Number(body.salaryFloor);
  const hasExplicit = sent(body.salaryFloor) && Number.isFinite(explicitFloor) && explicitFloor > 0;
  const queryFloor = hasExplicit ? null : salaryFromQueryText(body.q);
  const floorN = hasExplicit ? explicitFloor : (queryFloor ?? Number(body.salaryFloor));
  const salaryFloor = Number.isFinite(floorN) && floorN > 0 ? Math.min(floorN, 2_000_000) : null;
  if (sent(body.salaryFloor) && salaryFloor === null && floorN !== 0) ignored.push("salaryFloor");

  // Rationale: docs/job-board-index-notes.md#n1069-const-ceiln-number-body-salaryceiling
  const ceilN = Number(body.salaryCeiling);
  const ceilUsable = Number.isFinite(ceilN) && ceilN > 0;
  const ceilUnderFloor = ceilUsable && salaryFloor !== null && ceilN < salaryFloor;
  const salaryCeiling = ceilUsable && !ceilUnderFloor ? ceilN : null;
  // 0 is the off position here for the same reason it is for salaryFloor and
  // maxAgeDays — a control at rest must not hang a warning on the page.
  if (sent(body.salaryCeiling) && salaryCeiling === null && ceilN !== 0) ignored.push("salaryCeiling");

  // Rationale: docs/job-board-index-notes.md#n1070-const-pbraw-string-body-paybasis-trim
  const pbRaw = String(body.payBasis ?? "").trim().toLowerCase();
  const payBasis = (PAY_BASES as readonly string[]).includes(pbRaw) ? pbRaw : null;
  if (sent(body.payBasis) && !payBasis) ignored.push("payBasis");

  // Rationale: docs/job-board-index-notes.md#n1071-const-hasstatedpay-body-hasstatedpay-tru
  const hasStatedPay = body.hasStatedPay === true;
  // Rationale: docs/job-board-index-notes.md#n1072-const-unstatedpayasked-body-includeunsta
  const unstatedPayAsked = body.includeUnstatedPay === true;
  if (body.hasStatedPay !== undefined && body.hasStatedPay !== null && typeof body.hasStatedPay !== "boolean") {
    ignored.push("hasStatedPay");
  }
  // Rationale: docs/job-board-index-notes.md#n1073-if-body-includeunstatedpay-undefined-bod
  if (body.includeUnstatedPay !== undefined && body.includeUnstatedPay !== null && typeof body.includeUnstatedPay !== "boolean") {
    ignored.push("includeUnstatedPay");
  }
  // Rationale: docs/job-board-index-notes.md#n1074-const-includeunstatedpay-unstatedpayaske
  const includeUnstatedPay = unstatedPayAsked && !hasStatedPay;
  if (unstatedPayAsked && hasStatedPay) ignored.push("includeUnstatedPay");

  // Rationale: docs/job-board-index-notes.md#n1075-const-yearsn-number-body-maxyears
  const yearsN = Number(body.maxYears);
  const maxYears = Number.isInteger(yearsN) && yearsN >= 1 && yearsN <= 20 ? yearsN : null;
  if (sent(body.maxYears) && maxYears === null) ignored.push("maxYears");

  // Rationale: docs/job-board-index-notes.md#n1076-const-deptshapeok-typeof-body-department
  const deptShapeOk = typeof body.department === "string" || typeof body.department === "number";
  const DEPARTMENT_LIMIT = 60;
  const department = (deptShapeOk ? String(body.department) : "")
    .replace(/[%_\\|"]/g, "")
    .trim()
    .slice(0, DEPARTMENT_LIMIT)
    .trim() || null;
  if (sent(body.department) && !department) ignored.push("department");

  // Rationale: docs/job-board-index-notes.md#n1077-const-vendor_limit
  const VENDOR_LIMIT = 8;
  const vendorsAsked = [
    ...new Set(
      (Array.isArray(body.vendor) ? body.vendor : String(body.vendor ?? "").split(","))
        .map((v) => String(v ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const vendors = vendorsAsked
    .filter((v) => (BOARD_VENDORS as readonly string[]).includes(v))
    .slice(0, VENDOR_LIMIT);
  if (sent(body.vendor) && vendors.length !== vendorsAsked.length) ignored.push("vendor");
  // The plural key is named, never aliased. Rationale: docs/job-board-index-notes.md#n425-plural-vendor-key-is-named
  if (sent(body.vendors) && !sent(body.vendor)) ignored.push("vendors");

  const ageN = Number(body.maxAgeDays);
  // Whole days only: the RPC binds an integer, and 1.5 dropped relevance ranking with 22P02 (L13-68).
  const maxAgeDays = Number.isInteger(ageN) && ageN >= 1 ? Math.min(ageN, 30) : null;
  if (sent(body.maxAgeDays) && maxAgeDays === null && ageN !== 0) ignored.push("maxAgeDays");
  // Rationale: docs/job-board-index-notes.md#n1078-const-maxageclamped-number-isinteger-age
  const maxAgeClamped = Number.isInteger(ageN) && ageN > 30;

  // Rationale: docs/job-board-index-notes.md#n1079-const-compasked-array-isarray-body-compa
  const compAsked = Array.isArray(body.companies) ? body.companies : [];
  const companies = compAsked
    .filter((c): c is string => typeof c === "string" && COMPANY_TOKEN_SHAPE.test(c))
    .slice(0, companyTokenLimit);
  if (compAsked.length && companies.length !== Math.min(compAsked.length, companyTokenLimit)) {
    ignored.push("companies");
  }

  // Rationale: docs/job-board-index-notes.md#n1080-if-body-remote-undefined-body-remote
  if (body.remote !== undefined && body.remote !== null && typeof body.remote !== "boolean") {
    ignored.push("remote");
  }
  // Rationale: docs/job-board-index-notes.md#n1081-if-body-remote-true-workmode-workmode
  if (body.remote === true && workMode && workMode !== "remote") ignored.push("remote");
  if (body.companies !== undefined && body.companies !== null && !Array.isArray(body.companies)) {
    ignored.push("companies");
  }
  // Rationale: docs/job-board-index-notes.md#n1082-if-body-sendableonly-undefined-body-send
  if (body.sendableOnly !== undefined && body.sendableOnly !== null && typeof body.sendableOnly !== "boolean") {
    ignored.push("sendableOnly");
  }
  if (body.includeUncategorised !== undefined && body.includeUncategorised !== null && typeof body.includeUncategorised !== "boolean") {
    ignored.push("includeUncategorised");
  }
  // Rationale: docs/job-board-index-notes.md#n1083-if-body-hasdescription-undefined-body-ha
  if (body.hasDescription !== undefined && body.hasDescription !== null && typeof body.hasDescription !== "boolean") {
    ignored.push("hasDescription");
  }
  if (body.excludeAgencies !== undefined && body.excludeAgencies !== null && typeof body.excludeAgencies !== "boolean") {
    ignored.push("excludeAgencies");
  }

  // One instant, in one spelling, for the database AND the sensor (.88): see
  // canonicalInstant. The caller's own string is never bound.
  const paRaw = body.postedAfter;
  const postedAfter = canonicalInstant(paRaw);
  if (sent(paRaw) && !postedAfter) ignored.push("postedAfter");
  const nsRaw = body.newSince;
  const newSince = canonicalInstant(nsRaw);
  if (sent(nsRaw) && !newSince) ignored.push("newSince");

  return {
    applied: {
      q: String(body.q ?? "").trim(),
      location: String(body.location ?? "").trim(),
      country,
      // Rationale: docs/job-board-index-notes.md#n1084-remote-body-remote-true-workmode
      remote: body.remote === true && !workMode,
      workMode,
      employmentType,
      category,
      includeUncategorised,
      sendableOnly,
      experience,
      salaryFloor,
      salaryCeiling,
      payBasis,
      hasStatedPay,
      includeUnstatedPay,
      maxYears,
      department,
      vendors,
      companies,
      maxAgeDays,
      postedAfter,
      newSince,
      excludeAgencies,
      hasDescription,
    },
    ignored,
    maxAgeClamped,
  };
}

// Rationale: docs/job-board-index-notes.md#n1085-block
// Rationale: docs/job-board-index-notes.md#n1277-export-const-widening_filters-readonlyse
export const WIDENING_FILTERS: ReadonlySet<string> = new Set(["includeUncategorised", "includeUnstatedPay"]);

// Rationale: docs/job-board-index-notes.md#n1278-export-const-isunfiltered-a-appliedfilte
export const isUnfiltered = (a: AppliedFilters): boolean =>
  !Object.entries(a as Record<string, unknown>).some(([k, v]) =>
    WIDENING_FILTERS.has(k)
      ? false
      : Array.isArray(v)
      ? v.length > 0
      : typeof v === "boolean"
      ? v
      : v !== null && v !== ""
  );

export type FilterViolation = { field: string; want: string; got: string };

// Rationale: docs/job-board-index-notes.md#n1086-block
// Rationale: docs/job-board-index-notes.md#n1279-export-function-textfieldshape-body-reco
// Rationale: docs/job-board-index-notes.md#n1280-export-function-textfieldshape-body-reco
export function textFieldShape(body: Record<string, unknown>, locationTermsOf: (raw: unknown) => { terms: string[] }): { body: Record<string, unknown>; ignored: string[] } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) out[k] = typeof v === "string" ? v.replace(/\u0000/g, "") : v;
  const ignored: string[] = [];
  for (const k of ["q", "location"] as const) {
    const v = out[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") { ignored.push(k); delete out[k]; continue; }
    if (!v.trim()) continue;
    const empty = k === "q" ? !/[\p{L}\p{N}]/u.test(v) : locationTermsOf(v).terms.length === 0;
    if (empty) { ignored.push(k); delete out[k]; }
  }
  return { body: out, ignored };
}

export const DEFAULT_TZ_OFFSET_MIN = 720;
export function viewerTzOffset(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= -840 && n <= 720 ? n : DEFAULT_TZ_OFFSET_MIN;
}
export function ageCutoffMs(maxAgeDays: number, now: number, tzOffset?: unknown): number {
  const local = new Date(now - viewerTzOffset(tzOffset) * 60_000);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - (maxAgeDays - 1) * 86_400_000;
  return Math.min(now - maxAgeDays * 86_400_000, dayStart);
}

export function filterViolations(
  rows: Array<Record<string, unknown>>,
  a: AppliedFilters,
  ageCutoff?: number,
): FilterViolation[] {
  const out: FilterViolation[] = [];
  const push = (field: string, want: string, got: unknown) => {
    if (out.length < 20) out.push({ field, want, got: String(got ?? "null") });
  };
  const cutoff = a.maxAgeDays === null ? null : ageCutoff ?? ageCutoffMs(a.maxAgeDays, Date.now());
  // Rationale: docs/job-board-index-notes.md#n1087-const-wantcountry-a-country-a-country
  const wantCountry = a.country ? a.country.split(",") : null;
  const wantModes = a.workMode ? a.workMode.split(",") : null;
  const wantCats = a.category ? a.category.split(",") : null;
  const wantEt = a.employmentType ? a.employmentType.split(",") : null;
  const postedFloor = a.postedAfter ? Date.parse(a.postedAfter) : null;
  for (const r of rows) {
    if (wantCountry && !wantCountry.includes(String(r.country ?? ""))) push("country", a.country as string, r.country);
    if (wantModes && !wantModes.includes(String(r.workMode ?? "").toLowerCase())) {
      push("workMode", a.workMode as string, r.workMode);
    }
    // Rationale: docs/job-board-index-notes.md#n1088-if-wantcats-wantcats-includes-string-r
    if (wantCats && !wantCats.includes(String(r.category ?? ""))) {
      const allowedOther = a.includeUncategorised && String(r.category ?? "") === "other";
      if (!allowedOther) push("category", a.category as string, r.category);
    }
    // Rationale: docs/job-board-index-notes.md#n1089-if-wantet-wantet-includes-string-r
    if (wantEt && !wantEt.includes(String(r.employmentType ?? ""))) {
      push("employmentType", a.employmentType as string, r.employmentType);
    }
    // Rationale: docs/job-board-index-notes.md#n1090-if-postedfloor-null-number-isfinite-post
    if (postedFloor !== null && Number.isFinite(postedFloor)) {
      const pp = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(pp) || pp < postedFloor) push("postedAfter", `>=${a.postedAfter}`, r.postedAt);
    }
    // Rationale: docs/job-board-index-notes.md#n1091-if-a-sendableonly-sendable_vendors-inclu
    if (a.sendableOnly && !SENDABLE_VENDORS.includes(String(r.source ?? ""))) {
      push("sendableOnly", SENDABLE_VENDORS.join("|"), r.source);
    }
    if (a.experience.length && !a.experience.includes(String(r.experienceBand ?? ""))) {
      push("experience", a.experience.join("|"), r.experienceBand);
    }
    // Rationale: docs/job-board-index-notes.md#n1092-if-a-paybasis
    if (a.payBasis) {
      const per = String(r.salaryPeriod ?? "");
      const ok = a.payBasis === "hourly" ? per === "hour" : (SALARIED_PERIODS as readonly string[]).includes(per);
      if (!ok) push("payBasis", a.payBasis, r.salaryPeriod);
    }
    // THE SENSOR READS THE COLUMN THE PREDICATE READS, or it reports every row
    // the filter correctly admitted as a violation. This checked the annualised
    // figure while the query bound it too; on 2026-09-27 the query moved to the
    // employer's verbatim pay field, and a sensor left behind would have flagged
    // roughly 33,000 legitimately-admitted postings board-wide — an integrity
    // channel that floods is an integrity channel somebody switches off.
    // rowToJob maps the column straight through, so a served row that carries no
    // pay text under this filter is the defect, exactly as an undated row under
    // maxAgeDays is.
    //
    // DELIBERATELY STRICTER THAN THE QUERY ON ONE CASE, AND THAT ASYMMETRY IS
    // NAMED RATHER THAN GLOSSED. Every query arm is a bare NOT-NULL test — the
    // edge builder's and all three SQL bodies' — so a pay field holding only
    // whitespace is ADMITTED by all four, while this test also rejects a blank.
    // The asymmetry cannot stop such a row being served, and claiming the two
    // tests are the same one would be exactly the kind of comment this change
    // exists to retire. What it can do, and all it does, is turn one bad row into
    // a reported incident on every page that serves it — a FALSE incident by the
    // predicate's own definition, since the query admitted the row on purpose.
    // The cost is bounded and the population is unobserved: 0 blank or
    // whitespace-only pay strings in 12,000 rows walked live 2026-09-27T03:30Z
    // and 0 in the earlier 18,000-row walk. It is kept strict because a vendor
    // sending whitespace is a real ingest defect worth one console line — clean()
    // strips NUL bytes and the writers' `|| null` turns "" into null, but neither
    // trims, so "   " can reach the column. Closing it properly means trimming at
    // the writers (an ingest change) or a btrim arm in four runtimes, one of
    // which — PostgREST — cannot express btrim; not a comment's decision to make.
    if (a.hasStatedPay && (typeof r.salary !== "string" || r.salary.trim() === "")) {
      push("hasStatedPay", "stated", r.salary);
    }
    // Rationale: docs/job-board-index-notes.md#n1093-if-a-maxyears-null
    if (a.maxYears !== null) {
      const y = r.minYears;
      if (typeof y !== "number" || y > a.maxYears) push("maxYears", `<=${a.maxYears}`, r.minYears);
    }
    // Rationale: docs/job-board-index-notes.md#n1094-if-a-department-string-r-department
    if (a.department && !String(r.department ?? "").toLowerCase().includes(a.department.toLowerCase())) {
      push("department", a.department, r.department);
    }
    if (a.vendors.length && !a.vendors.includes(String(r.source ?? ""))) {
      push("vendor", a.vendors.join("|"), r.source);
    }
    if (a.remote && r.remote !== true) push("remote", "true", r.remote);
    // Rationale: docs/job-board-index-notes.md#n1095-if-a-excludeagencies-r-agency-true
    if (a.excludeAgencies && r.agency === true) push("excludeAgencies", "agency=false", r.agency);
    // NO SELF-CHECK FOR hasDescription, deliberately. rowToJob does not emit
    // `description` on list rows — it is the largest field on the table and the
    // list route leaves it out on purpose — so any check here reads undefined
    // and flags every row, which is the companyToken mistake recorded a few
    // lines below, repeated. The sensor this filter would need is a column the
    // rows do not carry; adding one to carry it would cost every list request
    // the field the route exists to avoid.
    // `token` is what rowToJob actually emits for the company feed token — NOT
    // `companyToken`, which is what this line read when it was first written.
    // Consequence had it shipped: with a companies filter active every row would
    // have compared undefined against the token list and been flagged, so every
    // company lander page — a primary SEO surface — would have logged an error,
    // written a false incident, and returned filterIntegrity to the client. A
    // permanent red light on a board that was working.
    //
    // Caught by reading rowToJob's emitted keys, not by the tests: all 26 passed,
    // because the fixtures were written with the same wrong name the code used.
    // A test that invents its own field names only proves the code agrees with
    // the test. The guard in board-filter-contract.test.ts now parses the real
    // emitted names out of index.ts so this cannot drift again.
    // No `?? r.companyToken` fallback: the guard rejected it, correctly. rowToJob
    // is the only producer of these rows, it emits `token`, and a fallback to a
    // name nothing emits is dead code that quietly re-legitimises the mistake.
    const tok = String(r.token ?? "");
    if (a.companies.length && !a.companies.includes(tok)) {
      push("companies", `${a.companies.length} token(s)`, tok);
    }
    // Undated rows are EXCLUDED by the maxAgeDays predicate at the database, so
    // a row with no postedAt reaching us under that filter is itself the defect.
    if (cutoff !== null) {
      const p = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(p) || p < cutoff) push("maxAgeDays", `<=${a.maxAgeDays}d`, r.postedAt);
    }
  }
  return out;
}

// Rationale: docs/job-board-index-notes.md#n1281-export-function-categoryparam-a-pick-app
export function categoryParam(a: Pick<AppliedFilters, "category" | "includeUncategorised">): string | null {
  if (!a.category) return null;
  return a.includeUncategorised ? `${a.category},other` : a.category;
}

// Rationale: docs/job-board-index-notes.md#n1282-function-mergedsourcelist-a-pick-applied
// Rationale: docs/job-board-index-notes.md#n1283-function-mergedsourcelist-a-pick-applied
// Rationale: docs/job-board-index-notes.md#n1284-function-mergedsourcelist-a-pick-applied
function mergedSourceList(a: Pick<AppliedFilters, "sendableOnly"> & Partial<Pick<AppliedFilters, "vendors">>): string[] | null {
  const v = a.vendors?.length ? a.vendors : null;
  const send = a.sendableOnly ? [...SENDABLE_VENDORS] : null;
  if (v && send) {
    const set = new Set<string>(send);
    const both = v.filter((x) => set.has(x));
    return both.length ? both : [""];
  }
  return v ?? send;
}

export function rescueVendorsParam(a: Pick<AppliedFilters, "sendableOnly"> & Partial<Pick<AppliedFilters, "vendors">>): { p_vendors: string[] } | Record<string, never> {
  const list = mergedSourceList(a);
  return list ? { p_vendors: list } : {};
}

export function sendableSourcesParam(a: Pick<AppliedFilters, "sendableOnly"> & Partial<Pick<AppliedFilters, "vendors">>): { p_sources: string[] } | Record<string, never> {
  const list = mergedSourceList(a);
  return list ? { p_sources: list } : {};
}

// Rationale: docs/job-board-index-notes.md#n1285-export-function-extrafilterparams-a-appl
export function extraFilterParams(a: AppliedFilters): Record<string, unknown> {
  return {
    ...(a.salaryCeiling !== null ? { p_salary_ceiling: a.salaryCeiling } : {}),
    ...(a.payBasis ? { p_pay_basis: a.payBasis } : {}),
    ...(a.maxYears !== null ? { p_max_years: a.maxYears } : {}),
    ...(a.department ? { p_department: a.department } : {}),
  };
}

// Rationale: docs/job-board-index-notes.md#n1286-export-type-pagesplit
export type PageSplit = {
  aOffset: number; aLimit: number;
  bOffset: number; bLimit: number;
};

export function splitPage(offset: number, limit: number, countA: number): PageSplit {
  const off = Math.max(0, Math.floor(offset));
  const lim = Math.max(0, Math.floor(limit));
  const ca = Math.max(0, Math.floor(countA));

  // How many of this page's slots the first subset can still fill.
  const aLimit = Math.max(0, Math.min(ca - off, lim));
  return {
    // Past the end of A, aLimit is 0 and the offset is irrelevant — clamped so
    // it can never be a negative range.
    aOffset: Math.min(off, ca),
    aLimit,
    // B starts where A ran out. On pages entirely inside A this is 0 and
    // bLimit is 0, so B is never queried at all.
    bOffset: Math.max(0, off - ca),
    bLimit: lim - aLimit,
  };
}
