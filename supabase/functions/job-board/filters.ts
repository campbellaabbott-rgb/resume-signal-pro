import { JOB_CATEGORIES } from "./categories.ts";
import { isExperienceBand } from "./experience.ts";
import { SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import type { JobSourceKind } from "./sources.ts";
export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;
export const PAY_BASES = ["hourly", "salaried"] as const;
export const SALARIED_PERIODS = ["year", "month"] as const;
export const BOARD_VENDORS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "bamboohr",
  "recruitee",
  "teamtailor",
  "personio",
  "breezy",
  "rippling",
  "workday",
  "pinpoint",
  "oracle",
  "icims",
  "usajobs",
  "paylocity",
  "ukg",
  "adp",
] as const satisfies readonly JobSourceKind[];
type _UnlistedKind = Exclude<JobSourceKind, (typeof BOARD_VENDORS)[number]>;
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
  employmentType: string | null;
  category: string | null;
  includeUncategorised: boolean;
  sendableOnly: boolean;
  experience: string[];
  salaryFloor: number | null;
  includeUnstatedPay: boolean;
  salaryCeiling: number | null;
  payBasis: string | null;
  hasStatedPay: boolean;
  maxYears: number | null;
  department: string | null;
  vendors: string[];
  companies: string[];
  maxAgeDays: number | null;
  postedAfter: string | null;
  excludeAgencies: boolean;
};
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
  "excludeAgencies",
  "hasStatedPay",
  "includeUnstatedPay",
  "companies",
  "maxAgeDays",
  "postedAfter",
  "salaryCeiling",
  "payBasis",
  "maxYears",
  "department",
  "vendors",
]);
export function payParams(a: AppliedFilters): Record<string, unknown> {
  return {
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
  maxAgeClamped: boolean;
};
const asBands = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
const sent = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "";
export const SALARY_IN_QUERY = /^\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k?)\+?$/i;
export function salaryFromQueryText(raw: unknown): number | null {
  for (const t of String(raw ?? "").toLowerCase().split(/\s+/)) {
    const m = SALARY_IN_QUERY.exec(t);
    if (!m) continue;
    const b = m[1];
    const n = b.endsWith("k") ? Number(b.slice(0, -1)) * 1_000 : Number(b.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 1_000 || n > 2_000_000) continue;
    return n;
  }
  return null;
}
export function normalizeFilters(
  body: Record<string, unknown>,
  companyTokenLimit: number,
): NormalizedFilters {
  const ignored: string[] = [];
  const COUNTRY_LIMIT = 5;
  const countryList = (Array.isArray(body.country) ? body.country : String(body.country ?? "").split(","))
    .map((c) => String(c ?? "").trim())
    .filter((c) => /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  const countryAsked = [...new Set(countryList)];
  const country = countryAsked.length
    ? countryAsked.slice(0, COUNTRY_LIMIT).join(",")
    : null;
  if (sent(body.country) && (!country || countryAsked.length > COUNTRY_LIMIT)) ignored.push("country");
  const CATEGORY_LIMIT = 3;
  const categoryList = (Array.isArray(body.category) ? body.category : String(body.category ?? "").split(","))
    .map((c) => String(c ?? "").trim().toLowerCase())
    .filter((c) => (JOB_CATEGORIES as readonly string[]).includes(c));
  const categoryAsked = [...new Set(categoryList)];
  const category = categoryAsked.length
    ? categoryAsked.slice(0, CATEGORY_LIMIT).join(",")
    : null;
  if (sent(body.category) && (!category || categoryAsked.length > CATEGORY_LIMIT)) ignored.push("category");
  const wantsUncategorised = category !== null && !category.split(",").includes("other") && body.includeUncategorised === true;
  const sortingBySalary = String(body.sort ?? "") === "salary";
  const includeUncategorised = wantsUncategorised && !sortingBySalary;
  if (wantsUncategorised && sortingBySalary) ignored.push("includeUncategorised");
  const sendableOnly = body.sendableOnly === true;
  const excludeAgencies = body.excludeAgencies === true;
  const wmAsked = (Array.isArray(body.workMode) ? body.workMode : String(body.workMode ?? "").split(","))
    .map((m) => String(m ?? "").trim().toLowerCase())
    .filter((m) => m.length > 0);
  const wmValid = [...new Set(wmAsked.filter((m) => (WORK_MODES as readonly string[]).includes(m)))]
    .slice(0, WORK_MODES.length);
  const workMode = wmValid.length ? wmValid.join(",") : null;
  if (sent(body.workMode) && wmValid.length !== new Set(wmAsked).size) ignored.push("workMode");
  const etAsked = (Array.isArray(body.employmentType) ? body.employmentType : String(body.employmentType ?? "").split(","))
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);
  const etValid = [...new Set(etAsked.filter((t) => (EMPLOYMENT_TYPES as readonly string[]).includes(t)))]
    .slice(0, EMPLOYMENT_TYPES.length);
  const employmentType = etValid.length ? etValid.join(",") : null;
  if (sent(body.employmentType) && etValid.length !== new Set(etAsked).size) ignored.push("employmentType");
  const bandsAsked = asBands(body.experience);
  const experience = bandsAsked.filter(isExperienceBand);
  if (bandsAsked.length && experience.length !== bandsAsked.length) ignored.push("experience");
  const explicitFloor = Number(body.salaryFloor);
  const hasExplicit = sent(body.salaryFloor) && Number.isFinite(explicitFloor) && explicitFloor > 0;
  const queryFloor = hasExplicit ? null : salaryFromQueryText(body.q);
  const floorN = hasExplicit ? explicitFloor : (queryFloor ?? Number(body.salaryFloor));
  const salaryFloor = Number.isFinite(floorN) && floorN > 0 ? Math.min(floorN, 2_000_000) : null;
  if (sent(body.salaryFloor) && salaryFloor === null && floorN !== 0) ignored.push("salaryFloor");
  const ceilN = Number(body.salaryCeiling);
  const ceilUsable = Number.isFinite(ceilN) && ceilN > 0;
  const ceilUnderFloor = ceilUsable && salaryFloor !== null && ceilN < salaryFloor;
  const salaryCeiling = ceilUsable && !ceilUnderFloor ? ceilN : null;
  if (sent(body.salaryCeiling) && salaryCeiling === null && ceilN !== 0) ignored.push("salaryCeiling");
  const pbRaw = String(body.payBasis ?? "").trim().toLowerCase();
  const payBasis = (PAY_BASES as readonly string[]).includes(pbRaw) ? pbRaw : null;
  if (sent(body.payBasis) && !payBasis) ignored.push("payBasis");
  const hasStatedPay = body.hasStatedPay === true;
  const includeUnstatedPay = body.includeUnstatedPay === true;
  if (body.hasStatedPay !== undefined && body.hasStatedPay !== null && typeof body.hasStatedPay !== "boolean") {
    ignored.push("hasStatedPay");
  }
  if (body.includeUnstatedPay !== undefined && body.includeUnstatedPay !== null && typeof body.includeUnstatedPay !== "boolean") {
    ignored.push("includeUnstatedPay");
  }
  const yearsN = Number(body.maxYears);
  const maxYears = Number.isInteger(yearsN) && yearsN >= 1 && yearsN <= 20 ? yearsN : null;
  if (sent(body.maxYears) && maxYears === null) ignored.push("maxYears");
  const deptShapeOk = typeof body.department === "string" || typeof body.department === "number";
  const DEPARTMENT_LIMIT = 60;
  const department = (deptShapeOk ? String(body.department) : "")
    .replace(/[%_\\|"]/g, "")
    .trim()
    .slice(0, DEPARTMENT_LIMIT)
    .trim() || null;
  if (sent(body.department) && !department) ignored.push("department");
  // MULTI-SELECT over a CLOSED set, validated per element like country and
  // category, and capped like both.
  //
  // Unknown members are NAMED, which is the opposite of how an unknown company
  // token is treated — and the difference is the size of the space. There are
  // 19,701 company tokens and a caller can legitimately ask about one the board
  // does not carry, so an empty page is the true answer. There are SIXTEEN
  // vendors; a name outside that set is a typo or a guess, never a question the
  // board can answer, and returning an empty page for it would be answering it.
  //
  // EIGHT, and the cap follows the experience rule rather than the country one:
  // a truncated list is reported. Slicing silently would mean a caller asking
  // for nine systems gets eight and is told they got nine — the same shape as
  // the clamp that reads as "there is nothing older".
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
  const ageN = Number(body.maxAgeDays);
  const maxAgeDays = Number.isFinite(ageN) && ageN >= 1 ? Math.min(ageN, 30) : null;
  if (sent(body.maxAgeDays) && maxAgeDays === null && ageN !== 0) ignored.push("maxAgeDays");
  // A CLAMP IS A NARROWING AND HAS TO BE SAID. maxAgeDays:90, :365 and :30 all
  // returned identical results with nothing in the body admitting the window
  // had been cut — the ignoredFilters line above cannot fire, because a clamped
  // value is non-null and therefore "honoured". A caller asking for 90 days is
  // told nothing and reasonably concludes the board has no older postings,
  // rather than that it declined to look.
  const maxAgeClamped = Number.isFinite(ageN) && ageN > 30;
  // An unknown company token is not invalid — it matches nothing, and a truthful
  // empty result is the correct answer to "jobs at a company we don't carry".
  // A non-string member IS invalid and gets named.
  const compAsked = Array.isArray(body.companies) ? body.companies : [];
  const companies = compAsked
    .filter((c): c is string => typeof c === "string")
    .slice(0, companyTokenLimit);
  if (compAsked.length && companies.length !== Math.min(compAsked.length, companyTokenLimit)) {
    ignored.push("companies");
  }
  // `remote` and `companies` were the two fields that could be REQUESTED and
  // dropped without ever being named — the exact breach this file exists to
  // close, still open in the file that closes it.
  //
  //   remote:"true"  (the natural shape from a query string) -> `=== true` is
  //     false, the filter evaporates, and the caller who asked for remote work
  //     receives the entire 600k-row board.
  //   companies:"tok" (a bare token instead of a one-element array) -> the
  //     Array.isArray guard yields [], the employer scope evaporates, and the
  //     caller receives every posting under a total they will read as that
  //     employer's.
  if (body.remote !== undefined && body.remote !== null && typeof body.remote !== "boolean") {
    ignored.push("remote");
  }
  if (body.remote === true && workMode && workMode !== "remote") ignored.push("remote");
  if (body.companies !== undefined && body.companies !== null && !Array.isArray(body.companies)) {
    ignored.push("companies");
  }
  if (body.sendableOnly !== undefined && body.sendableOnly !== null && typeof body.sendableOnly !== "boolean") {
    ignored.push("sendableOnly");
  }
  if (body.includeUncategorised !== undefined && body.includeUncategorised !== null && typeof body.includeUncategorised !== "boolean") {
    ignored.push("includeUncategorised");
  }
  if (body.excludeAgencies !== undefined && body.excludeAgencies !== null && typeof body.excludeAgencies !== "boolean") {
    ignored.push("excludeAgencies");
  }
  const paRaw = body.postedAfter;
  const postedAfter = typeof paRaw === "string" && !Number.isNaN(Date.parse(paRaw)) ? paRaw : null;
  if (sent(paRaw) && !postedAfter) ignored.push("postedAfter");
  return {
    applied: {
      q: String(body.q ?? "").trim(),
      location: String(body.location ?? "").trim(),
      country,
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
      excludeAgencies,
    },
    ignored,
    maxAgeClamped,
  };
}
export const WIDENING_FILTERS: ReadonlySet<string> = new Set(["includeUncategorised", "includeUnstatedPay"]);
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
export function filterViolations(
  rows: Array<Record<string, unknown>>,
  a: AppliedFilters,
): FilterViolation[] {
  const out: FilterViolation[] = [];
  const push = (field: string, want: string, got: unknown) => {
    if (out.length < 20) out.push({ field, want, got: String(got ?? "null") });
  };
  const cutoff = a.maxAgeDays === null ? null : Date.now() - a.maxAgeDays * 86_400_000;
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
    if (wantCats && !wantCats.includes(String(r.category ?? ""))) {
      const allowedOther = a.includeUncategorised && String(r.category ?? "") === "other";
      if (!allowedOther) push("category", a.category as string, r.category);
    }
    if (wantEt && !wantEt.includes(String(r.employmentType ?? ""))) {
      push("employmentType", a.employmentType as string, r.employmentType);
    }
    if (postedFloor !== null && Number.isFinite(postedFloor)) {
      const pp = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(pp) || pp < postedFloor) push("postedAfter", `>=${a.postedAfter}`, r.postedAt);
    }
    if (a.sendableOnly && !SENDABLE_VENDORS.includes(String(r.source ?? ""))) {
      push("sendableOnly", SENDABLE_VENDORS.join("|"), r.source);
    }
    if (a.experience.length && !a.experience.includes(String(r.experienceBand ?? ""))) {
      push("experience", a.experience.join("|"), r.experienceBand);
    }
    if (a.payBasis) {
      const per = String(r.salaryPeriod ?? "");
      const ok = a.payBasis === "hourly" ? per === "hour" : (SALARIED_PERIODS as readonly string[]).includes(per);
      if (!ok) push("payBasis", a.payBasis, r.salaryPeriod);
    }
    if (a.hasStatedPay && r.salaryMinAnnual == null) push("hasStatedPay", "stated", r.salaryMinAnnual);
    if (a.maxYears !== null) {
      const y = r.minYears;
      if (typeof y !== "number" || y > a.maxYears) push("maxYears", `<=${a.maxYears}`, r.minYears);
    }
    if (a.department && !String(r.department ?? "").toLowerCase().includes(a.department.toLowerCase())) {
      push("department", a.department, r.department);
    }
    if (a.vendors.length && !a.vendors.includes(String(r.source ?? ""))) {
      push("vendor", a.vendors.join("|"), r.source);
    }
    if (a.remote && r.remote !== true) push("remote", "true", r.remote);
    if (a.excludeAgencies && r.agency === true) push("excludeAgencies", "agency=false", r.agency);
    const tok = String(r.token ?? "");
    if (a.companies.length && !a.companies.includes(tok)) {
      push("companies", `${a.companies.length} token(s)`, tok);
    }
    if (cutoff !== null) {
      const p = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(p) || p < cutoff) push("maxAgeDays", `<=${a.maxAgeDays}d`, r.postedAt);
    }
  }
  return out;
}
export function categoryParam(a: Pick<AppliedFilters, "category" | "includeUncategorised">): string | null {
  if (!a.category) return null;
  return a.includeUncategorised ? `${a.category},other` : a.category;
}
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
export function extraFilterParams(a: AppliedFilters): Record<string, unknown> {
  return {
    ...(a.salaryCeiling !== null ? { p_salary_ceiling: a.salaryCeiling } : {}),
    ...(a.payBasis ? { p_pay_basis: a.payBasis } : {}),
    ...(a.maxYears !== null ? { p_max_years: a.maxYears } : {}),
    ...(a.department ? { p_department: a.department } : {}),
  };
}
export type PageSplit = {
  aOffset: number; aLimit: number;
  bOffset: number; bLimit: number;
};
export function splitPage(offset: number, limit: number, countA: number): PageSplit {
  const off = Math.max(0, Math.floor(offset));
  const lim = Math.max(0, Math.floor(limit));
  const ca = Math.max(0, Math.floor(countA));
  const aLimit = Math.max(0, Math.min(ca - off, lim));
  return {
    aOffset: Math.min(off, ca),
    aLimit,
    bOffset: Math.max(0, off - ca),
    bLimit: lim - aLimit,
  };
}