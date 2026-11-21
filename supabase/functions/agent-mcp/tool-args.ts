// A TOOL'S ARGUMENTS, READ AS THE CALLER MEANT THEM OR REFUSED BY NAME
// (lane fix/1121-connector-errors, items 2, 11 and 12; the live reads of
// 2026-11-21: search_jobs {keyword: "Recruiter", country: "IE"} answered every
// job in Ireland, total 3,525, with no error and no note, because a name the
// tool does not declare was dropped without a word).
//
// PURE. The dispatcher hands this module the tool's accepted names, read off
// the registry (TOOLS and SEARCH_PROPERTIES in index.ts), so it holds no
// second list of them; it reads nothing and counts nothing. Every refusal it
// makes is answered in band BEFORE anything is counted.
//
// 'SENT', DEFINED ONCE, for every reader of this lane: a value is sent unless
// it is undefined, null, a string that is empty after trimming, or an empty
// array. A key whose value is not sent is dropped before anything else is
// read: never aliased, never refused, never listed, never in conflict. So the
// shape a client sends when it fills unused optional fields with null or ""
// is the search it would have been without them.

import { BOARD_VENDORS, EMPLOYMENT_TYPES, EXPERIENCE_BANDS, JOB_CATEGORIES, WORK_MODES } from "../_shared/board-domains.ts";

/** A value the caller actually gave: not undefined, null, a blank string or an empty array. */
export function isSent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** The arguments with every key whose value was not sent dropped. */
export function dropUnsent(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => isSent(v)));
}

/** A name as compared after the exact match: lower case, no underscores or hyphens. */
const loose = (name: string): string => name.toLowerCase().replace(/[_-]/g, "");

/**
 * THE ONE FIXED ALIAS TABLE, keyed by the loose form of the name sent. An
 * alias maps only to a name the tool accepts; on the two employer tools the
 * employer names map to companyTokens instead (EMPLOYER_ALIASES).
 */
const ALIASES: Readonly<Record<string, string>> = {
  keyword: "query", keywords: "query", q: "query", search: "query", term: "query", title: "query", role: "query",
  city: "location", place: "location", where: "location",
  countries: "country", countrycode: "country",
  company: "companies", employer: "companies", employers: "companies", companyname: "companies",
  companytoken: "companies", companytokens: "companies",
  experienceband: "experience",
  source: "vendor",
  pagesize: "limit", perpage: "limit", size: "limit", maxresults: "limit", count: "limit",
  jobid: "id", url: "id", link: "id",
  jobids: "ids",
};
/** On employer_hiring_record and employer_growth: every employer name the caller may send. */
const EMPLOYER_ALIASES: ReadonlySet<string> = new Set([
  "company", "companies", "companytoken", "companytokens", "companyname", "employer", "employers", "name", "names",
]);

/** A declared argument as the registry declares it: its type, and its enum where it has one. */
export type DeclaredArg = { type?: unknown; enum?: readonly unknown[] };

export type ToolArgSpec = {
  tool: string;
  /** The names the tool accepts, with their declared shapes. */
  accepted: Readonly<Record<string, DeclaredArg>>;
  /** True on the search tools: a name still unknown is refused, not ignored. */
  strict: boolean;
  /** True on the search tools: `page` (which no tool declares) is read as the first page or refused. */
  pages: boolean;
  /** On `search` only: search_jobs' names, so a filter sent here is pointed there. */
  searchJobsNames?: readonly string[];
  /** On the employer tools: employer names map to this argument. */
  employerArg?: string;
};

export type ArgNotes = {
  /** Each name not sent as declared, and the name it was read as. */
  argumentsRead?: Record<string, string>;
  /** Names that cannot change this tool's answer, answered without them. */
  ignoredArguments?: string[];
  /** Said when `page` was read as the first page. */
  pageNote?: string;
};

export type ArgReading =
  | { ok: true; args: Record<string, unknown>; notes: ArgNotes }
  | { ok: false; message: string; fix: string };

const refuse = (message: string, fix: string): ArgReading => ({ ok: false, message, fix });

/** A string of JSON, read as the object it holds; anything else as sent. */
function asObject(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  let v = raw;
  if (typeof v === "string") {
    if (!v.trim()) return { ok: true, value: {} };
    try {
      v = JSON.parse(v);
    } catch {
      return { ok: false };
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false };
  return { ok: true, value: v as Record<string, unknown> };
}

/** true, false, or the strings "true" and "false" in any case: the boolean, else null. */
function asBoolean(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return null;
}

/**
 * THE READER. (1) arguments sent as a JSON string are parsed; anything that is
 * then not a plain object is an argument error. Unsent keys are dropped. (2) A
 * sent name is matched exactly; then ignoring case, underscores and hyphens
 * (so /v1's spellings work); then through the fixed alias table. (3) Two sent
 * names that land on one accepted name with different values are refused
 * naming both. (4) On the search tools a name still unknown is refused with
 * the names the tool takes; `search` points a filter at search_jobs. (4a) On
 * the search tools `page` 0 or 1 is the first page, said; any other page is
 * refused. (5) Elsewhere an unknown name is answered without, and listed.
 * (6) A declared boolean takes true, false, "true" or "false"; a declared enum
 * takes one of its values (in any case); anything else is refused naming what
 * it takes. (7) argumentsRead names every name not sent as declared.
 */
export function readToolArgs(spec: ToolArgSpec, raw: unknown): ArgReading {
  const parsed = asObject(raw);
  if (!parsed.ok) {
    return refuse(
      `${spec.tool} takes its arguments as one JSON object of names and values.`,
      `Send arguments like {"query": "nurse", "location": "Dublin"}${spec.tool === "search_jobs" ? "" : ` (the names ${spec.tool} takes are in tools/list)`}.`,
    );
  }
  const sent = dropUnsent(parsed.value);
  const acceptedNames = Object.keys(spec.accepted);
  const byLoose = new Map(acceptedNames.map((n) => [loose(n), n]));
  const args: Record<string, unknown> = {};
  const from: Record<string, string> = {};
  const argumentsRead: Record<string, string> = {};
  const ignored: string[] = [];
  const unknown: string[] = [];
  const pointed: string[] = [];
  let pageNote: string | undefined;

  for (const [name, value] of Object.entries(sent)) {
    let target: string | undefined = Object.prototype.hasOwnProperty.call(spec.accepted, name) ? name : byLoose.get(loose(name));
    if (!target && spec.employerArg && EMPLOYER_ALIASES.has(loose(name))) target = spec.employerArg;
    if (!target) {
      const alias = Object.prototype.hasOwnProperty.call(ALIASES, loose(name)) ? ALIASES[loose(name)] : undefined;
      if (alias && Object.prototype.hasOwnProperty.call(spec.accepted, alias)) target = alias;
    }
    if (!target) {
      if (loose(name) === "page" && spec.pages) {
        const n = Number(typeof value === "string" ? value.trim() : value);
        if (n === 0 || n === 1) {
          ignored.push(name);
          pageNote = "page is not read here: this is the first page, and the next page is offset = nextOffset.";
          continue;
        }
        return refuse(`${spec.tool} pages by offset: send offset = nextOffset from the previous answer.`, "Leave page out; send offset = nextOffset (0 for the first page).");
      }
      if (spec.searchJobsNames) {
        const alias = Object.prototype.hasOwnProperty.call(ALIASES, loose(name)) ? ALIASES[loose(name)] : undefined;
        const sj = spec.searchJobsNames.find((n) => n === name || loose(n) === loose(name)) ?? (alias && spec.searchJobsNames.includes(alias) ? alias : undefined);
        if (sj) { pointed.push(name); continue; }
      }
      if (spec.strict) unknown.push(name);
      else ignored.push(name);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(args, target)) {
      if (JSON.stringify(args[target]) !== JSON.stringify(value)) {
        return refuse(
          `${spec.tool} was sent both "${from[target]}" and "${name}", which are the same argument (${target}), with different values.`,
          `Send ${target} once.`,
        );
      }
      continue;
    }
    args[target] = value;
    from[target] = name;
    if (target !== name) argumentsRead[name] = target;
  }

  if (pointed.length) {
    return refuse(
      `${spec.tool} takes only query; search_jobs takes location, country and the other filters.`,
      `Send {query} here, or call search_jobs with ${pointed.map((n) => JSON.stringify(n)).join(", ")}.`,
    );
  }
  if (unknown.length) {
    return refuse(
      `${spec.tool} does not take ${unknown.map((n) => `"${n}"`).join(", ")}. It takes: ${acceptedNames.join(", ")}.`,
      `Send only those names${unknown.length === 1 ? "" : ""}; a search word goes in query, a place in location or country.`,
    );
  }

  // (6) THE VALUES OF THE DECLARED BOOLEANS AND ENUMS.
  for (const [target, value] of Object.entries(args)) {
    const decl = spec.accepted[target] ?? {};
    if (decl.type === "boolean") {
      const b = asBoolean(value);
      if (b === null) {
        return refuse(`${target} takes true or false, got ${JSON.stringify(value)}.`, `Send ${target}: true, or leave it out.`);
      }
      args[target] = b;
      continue;
    }
    if (Array.isArray(decl.enum) && decl.enum.length) {
      const choices = decl.enum.map((x) => String(x));
      const t = typeof value === "string" ? value.trim().toLowerCase() : "";
      const hit = choices.find((c) => c.toLowerCase() === t);
      if (!hit) {
        return refuse(`${target} takes one of: ${choices.join(", ")}; got ${JSON.stringify(value)}.`, `Send ${target} as one of those, or leave it out.`);
      }
      args[target] = hit;
    }
  }

  const notes: ArgNotes = {};
  if (Object.keys(argumentsRead).length) notes.argumentsRead = argumentsRead;
  if (ignored.length) notes.ignoredArguments = ignored;
  if (pageNote) notes.pageNote = pageNote;
  return { ok: true, args, notes };
}

// ── item 11: the four closed-set filters and the vendor list ────────────────

/** The board's own sets (the EXISTING, unchanged _shared/board-domains.ts). */
export const FILTER_SETS: Readonly<Record<"workMode" | "employmentType" | "experience" | "category", readonly string[]>> = {
  workMode: WORK_MODES,
  employmentType: EMPLOYMENT_TYPES,
  experience: EXPERIENCE_BANDS,
  category: JOB_CATEGORIES,
};
/** The board's caps (job-board/filters.ts CATEGORY_LIMIT and the vendor cap). */
export const CATEGORIES_PER_SEARCH = 3;
export const VENDORS_PER_SEARCH = 8;

/** What a model types, read as the board's word: one short fixed table, applied after the spelling rule. */
const VALUE_SYNONYMS: Readonly<Record<string, string>> = {
  junior: "entry", entry_level: "entry", mid_level: "mid", intern: "internship", temp: "temporary",
  contractor: "contract", wfh: "remote", work_from_home: "remote",
};

/** One entry's spelling: lower case, spaces and hyphens to underscores, fulltime and parttime and on_site to the board's forms. */
function filterSpelling(entry: string): string {
  const s = entry.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const spelled = s === "fulltime" ? "full_time" : s === "parttime" ? "part_time" : s === "on_site" ? "onsite" : s;
  return Object.prototype.hasOwnProperty.call(VALUE_SYNONYMS, spelled) ? VALUE_SYNONYMS[spelled] : spelled;
}

export type FilterValues =
  | { ok: true; values: Partial<Record<"workMode" | "employmentType" | "experience" | "category" | "vendor", string>>; valuesRead: Record<string, string> }
  | { ok: false; message: string; fix: string };

/** A sent filter value as its comma entries (an array's entries, or a string split on commas), blanks dropped. */
function entriesOf(v: unknown): string[] {
  return (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x ?? "").trim()).filter(Boolean);
}

/**
 * workMode, employmentType, experience, category and vendor, each SENT entry
 * read under its obvious spelling or refused with the set (never dropped, so
 * a page never answers a wider question than was asked). Unsent is no filter.
 */
export function readFilterValues(args: Record<string, unknown>): FilterValues {
  const values: Partial<Record<"workMode" | "employmentType" | "experience" | "category" | "vendor", string>> = {};
  const valuesRead: Record<string, string> = {};
  for (const name of ["workMode", "employmentType", "experience", "category"] as const) {
    if (!isSent(args[name])) continue;
    const set = FILTER_SETS[name];
    const out: string[] = [];
    for (const e of entriesOf(args[name])) {
      const v = filterSpelling(e);
      if (!set.includes(v)) {
        return {
          ok: false,
          message: `${name} ${JSON.stringify(e)} is not one this board files postings under. It takes: ${set.join(", ")}.`,
          fix: `Send ${name} as a comma list of those values, or leave it out.`,
        };
      }
      if (v !== e) valuesRead[e] = v;
      if (!out.includes(v)) out.push(v);
    }
    if (name === "category" && out.length > CATEGORIES_PER_SEARCH) {
      return { ok: false, message: `category names ${out.length} categories; one search takes up to ${CATEGORIES_PER_SEARCH}.`, fix: "Send the three that matter most." };
    }
    if (out.length) values[name] = out.join(",");
  }
  if (isSent(args.vendor)) {
    const out: string[] = [];
    for (const e of entriesOf(args.vendor)) {
      const v = e.toLowerCase();
      if (!(BOARD_VENDORS as readonly string[]).includes(v)) {
        return {
          ok: false,
          message: `vendor ${JSON.stringify(e)} is not a hiring system this board reads. It reads: ${BOARD_VENDORS.join(", ")}.`,
          fix: "Send vendor as a comma list of those, or leave it out.",
        };
      }
      if (v !== e) valuesRead[e] = v;
      if (!out.includes(v)) out.push(v);
    }
    if (out.length > VENDORS_PER_SEARCH) {
      return { ok: false, message: `vendor names ${out.length} hiring systems; one search takes up to ${VENDORS_PER_SEARCH}.`, fix: "Send up to eight, or leave vendor out." };
    }
    if (out.length) values.vendor = out.join(",");
  }
  return { ok: true, values, valuesRead };
}

/**
 * THE BACKSTOP (items 3 and 11): a board answer that names, in ignoredFilters,
 * a filter the caller sent answered a wider question than was asked. The
 * names it can hold for a value this reader passed.
 */
export const BACKSTOPPED_FILTERS: readonly string[] = ["country", "workMode", "employmentType", "experience", "category", "vendor"];

// ── item 12: job ids sent as one string ─────────────────────────────────────

/**
 * Ids as sent, each entry read: a string that starts with [ is a JSON array; a
 * string is split on commas, new lines and runs of spaces only when that gives
 * two or more pieces and EVERY piece reads as a job id or link (isId), so an
 * id that itself holds a comma or a space is never broken. An array's entries
 * are read the same way. An empty entry is dropped.
 */
export function splitIds(v: unknown, isId: (s: string) => boolean): string[] {
  const out: string[] = [];
  const one = (x: unknown): void => {
    if (x === undefined || x === null) return;
    if (Array.isArray(x)) { for (const y of x) one(y); return; }
    const s = String(x).trim();
    if (!s) return;
    if (s.startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) { for (const y of arr) one(y); return; }
      } catch { /* not JSON: read as text below */ }
    }
    const pieces = s.split(/[,\n\r]+|\s{1,}/).map((p) => p.trim()).filter(Boolean);
    if (pieces.length >= 2 && pieces.every(isId)) out.push(...pieces);
    else out.push(s);
  };
  one(v);
  return out;
}
