// @vitest-environment node
/**
 * THE OPENAPI DOCUMENT NAMES EVERY ROUTE AND PARAMETER THE ROUTER TAKES
 * (api4 W1, lane A3).
 *
 * WHAT HAPPENED. /v1 had no machine-readable description anywhere (api4 design,
 * 2026-11-18), so a builder learnt it from prose, and prose about this router
 * has drifted before: the application route was served and metered for weeks
 * while llms.txt, the /data-api bake and the DataApi page named it zero times.
 * A document typed beside a router drifts the same way, only more quietly,
 * because a client generator believes it.
 *
 * THE PROPERTY. The document supabase/functions/public-api/openapi.ts builds
 * from the router's facts
 *   - describes every route the router dispatches and no other, and the
 *     index's own endpoint list agrees with the dispatch;
 *   - lists, per route, exactly the query parameters the router accepts, with
 *     each comma list capped at the router's cap and holding the router's
 *     closed values (the withheld hiring systems carried as the 451 they get);
 *   - names, per route, exactly the status and code pairs the router can
 *     answer on it, and which of them carry Retry-After;
 *   - names every code the router can answer, and info.version is API_VERSION;
 *   - names no response header a browser cannot read and no request header a
 *     preflight refuses;
 *   - gives every row only fields the router returns, and every sample calls
 *     only documented parameters.
 *
 * HOW THE ROUTER IS READ. index.ts serves on import and keeps its constants
 * private, so they are read out of its source with LINE-LEADING comments
 * removed (a mid-line slash pair is often inside a URL). The parse is then
 * proven not vacuous by the shipped handler's own answers: its index, the
 * parameter list its 400 names, the offset it refuses, the caps it refuses
 * past, and the 451 for a withheld system.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicApiBase } from "@/config/public-endpoints";
import { APPLICATION_ENDPOINT, FIT_ENDPOINT } from "../../supabase/functions/public-api/endpoint";
import {
  CLOSED_DERIVED,
  CLOSED_READ_NOT_PUBLISHED,
  DESCRIBED_FIELDS,
  DESCRIBED_FIT_FIELDS,
  DESCRIBED_PARAMS,
  DESCRIBED_ROUTES,
  OPENAPI_PATH,
  UNDESCRIBED,
  documentedDomain,
  openApiDocument,
  publicApiServer,
  routeKeyOf,
  servedRoutes,
  type RouterFacts,
} from "../../supabase/functions/public-api/openapi";
import { BOARD_VENDORS, EMPLOYMENT_TYPES, EXPERIENCE_BANDS, JOB_CATEGORIES, WORK_MODES } from "../../supabase/functions/_shared/board-domains";
// Renamed on import: the harness's name reads as a React hook to the linter.
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb as installDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// Reading the router.
// ---------------------------------------------------------------------------

/**
 * Source with every LINE-LEADING comment blanked: a line whose first
 * non-space characters open a line comment, and a block comment opened at the
 * start of a line, through its close. Anything after the close on the closing
 * line is kept. A slash pair or a block opener in the middle of a line is left
 * alone. Removed lines stay as empty lines, so offsets still point at the line.
 */
function withoutLineLeadingComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    if (inBlock) {
      const close = line.indexOf("*/");
      if (close === -1) { out.push(""); continue; }
      inBlock = false;
      out.push(line.slice(close + 2));
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith("//")) { out.push(""); continue; }
    if (t.startsWith("/*")) {
      const close = t.indexOf("*/", 2);
      if (close === -1) { inBlock = true; out.push(""); continue; }
      out.push(t.slice(close + 2));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function one(src: string, re: RegExp, what: string): RegExpExecArray {
  const m = re.exec(src);
  if (!m) throw new Error(`the router's ${what} was not found where this guard reads it`);
  return m;
}

/** The string literals of `const NAME = [ ... ]`, refusing a block that holds anything but literals and commas. */
function constStrings(src: string, name: string): string[] {
  const block = one(src, new RegExp(`\\bconst ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`), name)[1];
  const values = [...block.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
  const rest = block.replace(/"([^"\\]*)"/g, "").replace(/[\s,]/g, "");
  if (rest !== "") throw new Error(`${name} holds something other than string literals: ${rest.slice(0, 80)}`);
  return values;
}
const constString = (src: string, name: string) => one(src, new RegExp(`\\bconst ${name}\\s*=\\s*"([^"\\\\]*)";`), name)[1];
const constNumber = (src: string, name: string) =>
  Number(one(src, new RegExp(`\\bconst ${name}\\s*=\\s*([\\d_]+);`), name)[1].replace(/_/g, ""));
const constPair = (src: string, name: string) => {
  const m = one(src, new RegExp(`\\bconst ${name}\\s*=\\s*\\{\\s*perDay:\\s*([\\d_]+),\\s*perMinute:\\s*([\\d_]+)\\s*\\}`), name);
  return { perDay: Number(m[1].replace(/_/g, "")), perMinute: Number(m[2].replace(/_/g, "")) };
};

const DOMAINS: Record<string, readonly string[]> = { WORK_MODES, EXPERIENCE_BANDS, EMPLOYMENT_TYPES, JOB_CATEGORIES, BOARD_VENDORS };
/** Constants the router compares paths with, resolved from the modules that export them. */
const PATH_CONSTANTS: Record<string, string> = { APPLICATION_ENDPOINT, FIT_ENDPOINT, OPENAPI_PATH };

type Decl = { name: string; start: number; body: string };

/** Column-0 declarations, each with its text up to the next one. */
function declarationsOf(src: string): Map<string, Decl> {
  const starts: Array<{ name: string; start: number }> = [];
  const re = /^(?:export\s+)?(?:(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\b|(Deno)\.serve\()/gm;
  for (const m of src.matchAll(re)) starts.push({ name: m[1] ?? m[2] ?? "Deno.serve", start: m.index ?? 0 });
  const out = new Map<string, Decl>();
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].start : src.length;
    out.set(s.name, { name: s.name, start: s.start, body: src.slice(s.start, end) });
  });
  return out;
}

const failPairs = (body: string) => [...body.matchAll(/\bfail\(\s*(\d{3}),\s*"([a-z_]+)"/g)].map((m) => `${m[1]} ${m[2]}`);

/** The text of each fail() call, to its closing line. */
const failCalls = (body: string) =>
  [...body.matchAll(/\bfail\(\s*(\d{3}),\s*"([a-z_]+)"/g)].map((m) => {
    const from = m.index ?? 0;
    const to = body.indexOf(");\n", from);
    return { pair: `${m[1]} ${m[2]}`, code: m[2], text: body.slice(from, to === -1 ? undefined : to) };
  });

type RouteFacts = {
  keyed: boolean;
  conditional: boolean;
  /** The router list rejectUnknownParams holds this route to; null when the handler reads no query string at all. */
  params: string[] | null;
  /** "status code" pairs it can answer, method_not_allowed aside. */
  codes: Set<string>;
};

type Router = {
  facts: RouterFacts;
  routes: Map<string, RouteFacts>;
  /** Every "status code" pair index.ts can answer. */
  allPairs: Set<string>;
  /** Codes whose refusal sends Retry-After. */
  retryAfterCodes: Set<string>;
  /** Access-Control-Allow-Headers, lower-cased. */
  allowedRequestHeaders: string[];
  /** Every query parameter name the handlers read by name. */
  paramsRead: Set<string>;
  /** Names a job row may carry beside JOB_FIELDS: written by the router or last-verified.ts. */
  rowWriterText: string;
  /** LIST_FILTERS, as param -> the closed set it checks against (null when open). */
  listFilterDomains: Record<string, readonly string[] | null>;
  /** The columns closed[] destructures away, and the keys it adds. */
  closedMapRemoved: string[];
  closedMapAdded: string[];
};

/** Everything this guard needs to know about the router, read from index.ts. */
function readRouter(indexSrc: string, lastVerifiedSrc: string): Router {
  const code = withoutLineLeadingComments(indexSrc);
  const decls = declarationsOf(code);
  const body = (name: string) => {
    const d = decls.get(name);
    if (!d) throw new Error(`the router's ${name} was not found where this guard reads it`);
    return d.body;
  };

  // The index answer: docs address and endpoint list.
  const serve = body("Deno.serve");
  const endpoints = one(serve, /endpoints:\s*\[([^\]]+)\]/, "index endpoints")[1]
    .split(",").map((x) => x.trim()).filter(Boolean)
    .map((x) => {
      if (/^"[^"]*"$/.test(x)) return x.slice(1, -1);
      if (x in PATH_CONSTANTS) return PATH_CONSTANTS[x];
      throw new Error(`the index lists ${x}, which this guard cannot resolve`);
    });

  // LIST_FILTERS: param -> cap, and param -> the domain constant it checks against.
  const lf = one(code, /\bconst LIST_FILTERS\s*=\s*\[([\s\S]*?)\]\s*as const satisfies/, "LIST_FILTERS")[1];
  const entries = [...lf.matchAll(/\{\s*param:\s*"([a-z_]+)",\s*col:\s*"[a-z_]+",\s*cap:\s*(\d+|[A-Z_]+\.length),\s*domain:\s*([A-Z_]+|null),/g)];
  const paramCount = (lf.match(/\bparam:/g) ?? []).length;
  if (entries.length !== paramCount || paramCount === 0) throw new Error(`LIST_FILTERS has ${paramCount} entries and this guard read ${entries.length}`);
  const listFilterCaps: Record<string, number> = {};
  const listFilterDomains: Record<string, readonly string[] | null> = {};
  for (const [, param, cap, domain] of entries) {
    const capDomain = /^([A-Z_]+)\.length$/.exec(cap);
    if (capDomain && !DOMAINS[capDomain[1]]) throw new Error(`LIST_FILTERS caps ${param} by ${cap}, which this guard cannot resolve`);
    listFilterCaps[param] = capDomain ? DOMAINS[capDomain[1]].length : Number(cap);
    if (domain !== "null" && !DOMAINS[domain]) throw new Error(`LIST_FILTERS checks ${param} against ${domain}, which this guard cannot resolve`);
    listFilterDomains[param] = domain === "null" ? null : DOMAINS[domain];
  }

  // /v1/changes' two selects and what closed[] does to its rows.
  const changesBody = body("changes");
  const selectOf = (table: string) =>
    one(changesBody, new RegExp(`from\\("${table}"\\)\\s*\\.select\\("([^"]+)"\\)`), `${table} select in changes()`)[1].split(",").map((x) => x.trim());
  const closedMap = one(changesBody, /closedRows\.map\(\(\{\s*([\w\s,]+?),\s*\.\.\.c\s*\}[^)]*\)\s*=>\s*\(\{\s*\.\.\.c,([\s\S]*?)\}\)\)/, "closed[] row map");

  // POST /v1/fit's body.
  const fitBody = body("fitResumeScored");
  const fit = {
    bodyFields: [...one(fitBody, /let body:\s*\{([^}]*)\}/, "fit body type")[1].matchAll(/(\w+)\?:/g)].map((m) => m[1]),
    resumeTextMinChars: Number(one(fitBody, /resumeText\.trim\(\)\.length < (\d+)/, "fit resumeText minimum")[1]),
    resumeTextMaxChars: Number(one(fitBody, /body\.resumeText\.slice\(0, (\d+)\)/, "fit resumeText maximum")[1]),
    limitMax: Number(one(fitBody, /Math\.min\((\d+), Number\(body\.limit \?\? \d+\)/, "fit limit maximum")[1]),
    limitDefault: Number(one(fitBody, /Number\(body\.limit \?\? (\d+)\)/, "fit limit default")[1]),
  };

  const facts: RouterFacts = {
    apiVersion: constString(code, "API_VERSION"),
    docsUrl: one(serve, /docs:\s*"([^"]+)"/, "index docs address")[1],
    endpoints,
    jobsParams: constStrings(code, "JOBS_PARAMS"),
    changesParams: constStrings(code, "CHANGES_PARAMS"),
    companiesParams: constStrings(code, "COMPANIES_PARAMS"),
    listFilterCaps,
    includableFields: constStrings(code, "INCLUDABLE_FIELDS"),
    jobFields: constStrings(code, "JOB_FIELDS"),
    changesOpenedFields: selectOf("job_board_postings"),
    changesClosedFields: selectOf("job_board_closures"),
    defaultLimit: constNumber(code, "DEFAULT_LIMIT"),
    maxLimit: constNumber(code, "MAX_LIMIT"),
    maxLimitWithDescription: constNumber(code, "MAX_LIMIT_WITH_DESCRIPTION"),
    maxOffset: constNumber(code, "MAX_OFFSET"),
    companiesDefaultLimit: Number(one(body("companies"), /limitAsked \|\| (\d+)\b/, "companies default limit")[1]),
    freshWindowDays: constNumber(code, "FRESH_WINDOW_DAYS"),
    closuresMaxDaysFree: constNumber(code, "CLOSURES_MAX_DAYS_FREE"),
    changesMaxDaysPaid: constNumber(code, "CHANGES_MAX_DAYS_PAID"),
    freeKeyIssued: constPair(code, "FREE_KEY_ISSUED"),
    builderProposed: constPair(code, "BUILDER_PROPOSED"),
    builderUrl: constString(code, "BUILDER_URL"),
    withheldSources: constStrings(code, "NO_REDISTRIBUTION_SOURCES"),
    withheldReason: constString(code, "NO_REDISTRIBUTION_REASON"),
    exposedHeaders: one(code, /"Access-Control-Expose-Headers":\s*"([^"]+)"/, "exposed headers")[1].split(",").map((x) => x.trim()),
    fit,
  };

  // The closure of each top-level function over the top-level functions it calls.
  const names = [...decls.keys()].filter((n) => n !== "Deno.serve");
  const callsOf = new Map<string, string[]>();
  for (const n of names) {
    const b = decls.get(n)!.body;
    callsOf.set(n, names.filter((m) => m !== n && new RegExp(`(?<![\\w.$])${m.replace(/\$/g, "\\$")}\\s*[(<]`).test(b)));
  }
  const closure = (start: string) => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) for (const m of callsOf.get(queue.shift()!) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
    return [...seen];
  };

  // The dispatch: where each route is tested, and which handler answers it.
  const authAt = serve.indexOf("const auth = req.headers");
  const tryAt = serve.indexOf("try {", authAt);
  const catchAt = serve.indexOf("} catch (e)", tryAt);
  if (authAt < 0 || tryAt < 0 || catchAt < 0) throw new Error("the router's key check or its try/catch moved");
  const norm = (p: string) => (p === "/" ? "/v1" : p.replace(/\/+$/, ""));
  const tests: Array<{ at: number; path: string }> = [];
  for (const m of serve.matchAll(/path === ("[^"]+"|[A-Z_]+)/g)) {
    const lit = m[1].startsWith("\"") ? m[1].slice(1, -1) : PATH_CONSTANTS[m[1]];
    if (lit === undefined) throw new Error(`the router compares path with ${m[1]}, which this guard cannot resolve`);
    tests.push({ at: m.index ?? 0, path: norm(lit) });
  }
  for (const m of serve.matchAll(/path\.startsWith\("([^"]+)"\)/g)) tests.push({ at: m.index ?? 0, path: `${m[1]}{id}` });
  for (const m of serve.matchAll(/applicationIdSegment\(path\)/g)) tests.push({ at: m.index ?? 0, path: APPLICATION_ENDPOINT });
  for (const m of serve.matchAll(/meteredEndpoint\(path\) === ([A-Z_]+)/g)) tests.push({ at: m.index ?? 0, path: norm(PATH_CONSTANTS[m[1]]) });
  tests.sort((a, b) => a.at - b.at);
  const postPaths = new Set([...serve.matchAll(/req\.method === "POST"[^;]*?=== "([^"]+)"/g)].map((m) => norm(m[1])));
  const keyOf = (path: string) => `${postPaths.has(path) ? "POST" : "GET"} ${path}`;

  const authPairs = failPairs(serve.slice(authAt, tryAt));
  const catchPairs = failPairs(serve.slice(catchAt));
  const routes = new Map<string, RouteFacts>();
  const routed = new Set<string>();
  for (const m of serve.slice(tryAt, catchAt).matchAll(/await (\w+)\(/g)) {
    if (!names.includes(m[1])) continue;
    const at = tryAt + (m.index ?? 0);
    const test = [...tests].reverse().find((t) => t.at < at);
    if (!test) throw new Error(`${m[1]} is called before any route test`);
    const key = keyOf(test.path);
    routed.add(test.path);
    const handlerFns = closure(m[1]);
    const codes = new Set<string>([...authPairs, ...catchPairs, ...failPairs(serve.slice(test.at, at))]);
    for (const fn of handlerFns) for (const p of failPairs(decls.get(fn)!.body)) codes.add(p);
    let params: string[] | null = null;
    for (const fn of handlerFns) {
      for (const r of decls.get(fn)!.body.matchAll(/rejectUnknownParams\(url,\s*(\[\]|[A-Z_]+)/g)) {
        params = r[1] === "[]" ? [] : constStrings(code, r[1]);
      }
    }
    const conditional = new RegExp(`conditional\\(await ${m[1]}\\(`).test(serve);
    routes.set(key, { keyed: true, conditional, params, codes: new Set([...codes].filter((p) => p !== "405 method_not_allowed")) });
  }
  // A route answered before the key check, by no handler of its own (the index).
  for (const t of tests) {
    if (t.at > authAt || routed.has(t.path) || routes.has(keyOf(t.path))) continue;
    const next = tests.find((u) => u.at > t.at);
    const stretch = serve.slice(t.at, Math.min(next ? next.at : authAt, authAt));
    routes.set(keyOf(t.path), { keyed: false, conditional: false, params: null, codes: new Set(failPairs(stretch).filter((p) => p !== "405 method_not_allowed")) });
  }

  // Every fail() in the file is a literal status and code, or the catalogue could miss one.
  const callCount = (code.match(/\bfail\(/g) ?? []).length;
  const literal = failPairs(code);
  if (callCount !== literal.length) throw new Error(`index.ts calls fail() ${callCount} times and ${literal.length} of them name a literal status and code`);

  const paramsRead = new Set<string>([
    ...[...code.matchAll(/(?:\bp|url\.searchParams)\.get\("([a-z_]+)"\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/(?:int|num|iso|bool)Param\((?:p|url\.searchParams),\s*"([a-z_]+)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/strictBool\("([a-z_]+)"\)/g)].map((m) => m[1]),
    ...entries.map((e) => e[1]),
  ]);

  return {
    facts,
    routes,
    allPairs: new Set(literal),
    retryAfterCodes: new Set(failCalls(code).filter((c) => /"Retry-After"/.test(c.text)).map((c) => c.code)),
    allowedRequestHeaders: one(code, /"Access-Control-Allow-Headers":\s*"([^"]+)"/, "allowed headers")[1].split(",").map((x) => x.trim().toLowerCase()),
    paramsRead,
    rowWriterText: `${code}\n${withoutLineLeadingComments(lastVerifiedSrc)}`,
    listFilterDomains,
    closedMapRemoved: closedMap[1].split(",").map((x) => x.trim()),
    closedMapAdded: [...closedMap[2].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]),
  };
}

// ---------------------------------------------------------------------------
// Reading the document.
// ---------------------------------------------------------------------------

// The document is walked as plain JSON, path by path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Op = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

function opsOf(doc: Doc): Map<string, Op> {
  const out = new Map<string, Op>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item as Record<string, Op>)) out.set(`${method.toUpperCase()} ${path}`, op);
  }
  return out;
}

/** Every JSON path in the document that carries the undescribed mark. */
function undescribedPaths(node: unknown, at = "$"): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((x, i) => undescribedPaths(x, `${at}[${i}]`));
  const own = (node as Record<string, unknown>)[UNDESCRIBED] === true ? [at] : [];
  return [...own, ...Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => undescribedPaths(v, `${at}.${k}`))];
}

const diff = (a: Iterable<string>, b: Iterable<string>) => { const bs = new Set(b); return [...new Set(a)].filter((x) => !bs.has(x)).sort(); };

/** Everything the document says that the router does not bear out, one sentence each. */
function problemsOf(doc: Doc, router: Router): string[] {
  const p: string[] = [];
  const f = router.facts;

  if (doc.openapi !== "3.1.0") p.push(`openapi is ${doc.openapi}, not 3.1.0`);
  if (doc.info?.version !== f.apiVersion) p.push(`info.version is ${doc.info?.version}; the router's API_VERSION is ${f.apiVersion}`);
  for (const at of undescribedPaths(doc)) p.push(`the router has something the document does not describe at ${at}`);

  // Routes: the dispatch, the index's list and the document agree.
  const ops = opsOf(doc);
  for (const r of diff(router.routes.keys(), ops.keys())) p.push(`the router answers ${r} and the document does not describe it`);
  for (const r of diff(ops.keys(), router.routes.keys())) p.push(`the document describes ${r} and the router does not answer it`);
  const advertised = new Set(f.endpoints.map(routeKeyOf));
  for (const r of router.routes.keys()) if (r !== "GET /v1" && !advertised.has(r)) p.push(`the router answers ${r} and its index does not list it`);
  for (const r of advertised) if (!router.routes.has(r)) p.push(`the index lists ${r} and the router does not dispatch it`);

  const allParams = new Set([...f.jobsParams, ...f.changesParams, ...f.companiesParams]);
  for (const name of router.paramsRead) if (!allParams.has(name)) p.push(`the router reads ?${name}= and no parameter list accepts it`);

  const exposed = new Set(f.exposedHeaders.map((h) => h.toLowerCase()));
  const catalogue = new Set<string>(((doc["x-errors"] ?? []) as Array<{ status: number; code: string }>).map((e) => `${e.status} ${e.code}`));
  for (const pair of diff(router.allPairs, catalogue)) p.push(`the router can answer ${pair} and x-errors does not name it`);
  for (const pair of diff(catalogue, router.allPairs)) p.push(`x-errors names ${pair} and the router never answers it`);
  const enumCodes: string[] = doc.components?.schemas?.Error?.properties?.error?.properties?.code?.enum ?? [];
  for (const c of diff([...router.allPairs].map((x) => x.split(" ")[1]), enumCodes)) p.push(`the Error schema's code enum leaves out ${c}`);
  for (const c of diff(enumCodes, [...router.allPairs].map((x) => x.split(" ")[1]))) p.push(`the Error schema's code enum names ${c}, which the router never answers`);

  for (const [key, op] of ops) {
    const rr = router.routes.get(key);
    if (!rr || op[UNDESCRIBED]) continue;
    const unkeyed = Array.isArray(op.security) && op.security.length === 0;
    if (rr.keyed === unkeyed) p.push(`${key}: the document says it ${unkeyed ? "needs no key" : "needs a key"} and the router ${rr.keyed ? "checks one" : "answers before the key check"}`);

    const params: Op[] = op.parameters ?? [];
    const query = params.filter((x) => x.in === "query");
    const names = query.map((x) => x.name);
    const want = rr.params ?? [];
    for (const n of diff(want, names)) p.push(`${key}: the router takes ?${n}= and the document omits it`);
    for (const n of diff(names, want)) p.push(`${key}: the document lists ?${n}= and the router ${rr.params ? "refuses it as unknown" : "reads no query string"}`);
    for (const q of query) {
      const cap = f.listFilterCaps[q.name];
      if (typeof cap === "number" && key === "GET /v1/jobs") {
        if (q.schema?.type !== "array" || q.schema?.maxItems !== cap || q.style !== "form" || q.explode !== false) {
          p.push(`${key}: ?${q.name}= is a comma list of at most ${cap} and the document gives ${JSON.stringify(q.schema)}`);
        }
        const domain = router.listFilterDomains[q.name];
        if (domain) {
          const documented = [...(q.schema?.items?.enum ?? []), ...(q["x-withheld-values"] ?? [])];
          if (diff(domain, documented).length || diff(documented, domain).length) p.push(`${key}: ?${q.name}= takes ${domain.join(",")} and the document gives ${documented.join(",")}`);
          if (diff(q["x-withheld-values"] ?? [], f.withheldSources).length) p.push(`${key}: ?${q.name}= marks as withheld what the router does not withhold`);
        }
      }
    }
    const limit = query.find((q) => q.name === "limit");
    if (limit && limit.schema?.maximum !== f.maxLimit) p.push(`${key}: limit's maximum is ${limit.schema?.maximum}; the router's MAX_LIMIT is ${f.maxLimit}`);
    if (limit && key !== "GET /v1/companies" && limit.schema?.default !== f.defaultLimit) p.push(`${key}: limit's default is ${limit.schema?.default}; the router's DEFAULT_LIMIT is ${f.defaultLimit}`);
    if (limit && key === "GET /v1/companies" && limit.schema?.default !== Math.min(f.companiesDefaultLimit, f.maxLimit)) p.push(`${key}: limit's default is ${limit.schema?.default}`);
    const offset = query.find((q) => q.name === "offset");
    if (offset && offset.schema?.maximum !== f.maxOffset) p.push(`${key}: offset's maximum is ${offset.schema?.maximum}; the router's MAX_OFFSET is ${f.maxOffset}`);

    const has304 = "304" in (op.responses ?? {});
    const hasIfNoneMatch = params.some((x) => x.in === "header" && /^if-none-match$/i.test(x.name));
    if (rr.conditional !== has304 || rr.conditional !== hasIfNoneMatch) p.push(`${key}: the router ${rr.conditional ? "answers" : "never answers"} 304 and the document ${has304 ? "documents" : "omits"} it`);

    const documented = new Set<string>();
    for (const [status, res] of Object.entries(op.responses ?? {})) {
      for (const c of (res as Op)["x-error-codes"] ?? []) documented.add(`${status} ${c}`);
      const retry: string[] = (res as Op)["x-retry-after-codes"] ?? [];
      const wantRetry = ((res as Op)["x-error-codes"] ?? []).filter((c: string) => router.retryAfterCodes.has(c));
      if (diff(retry, wantRetry).length || diff(wantRetry, retry).length) p.push(`${key} ${status}: Retry-After is sent with ${wantRetry.join(",") || "nothing"} and the document says ${retry.join(",") || "nothing"}`);
      for (const h of Object.keys((res as Op).headers ?? {})) if (!exposed.has(h.toLowerCase())) p.push(`${key} ${status}: a browser cannot read the ${h} header the document promises`);
    }
    for (const pair of diff(rr.codes, documented)) p.push(`${key}: the router can answer ${pair} and the document does not say so`);
    for (const pair of diff(documented, rr.codes)) p.push(`${key}: the document says ${pair} and the router never answers it there`);
    for (const h of params.filter((x) => x.in === "header")) if (!router.allowedRequestHeaders.includes(String(h.name).toLowerCase())) p.push(`${key}: a preflight refuses the ${h.name} header`);

    const samples: Op[] = op["x-codeSamples"] ?? [];
    const langs = samples.map((s) => s.lang).sort().join(",");
    if (langs !== "JavaScript,Python,Shell") p.push(`${key}: the samples are ${langs || "missing"}`);
    const path = key.slice(key.indexOf(" ") + 1).split("{id}")[0];
    for (const s of samples) {
      const src = String(s.source ?? "");
      if (!src.includes(`${doc.servers?.[0]?.url}${path}`)) p.push(`${key}: the ${s.label} sample does not call ${path}`);
      if (rr.keyed !== /Authorization/.test(src)) p.push(`${key}: the ${s.label} sample ${rr.keyed ? "sends no key" : "sends a key it does not need"}`);
      const used = [
        ...[...src.matchAll(/--data-urlencode "([a-z_]+)=/g)].map((m) => m[1]),
        ...[...(/new URLSearchParams\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? "").matchAll(/^\s*([a-z_]+): /gm)].map((m) => m[1]),
        ...[...(/params=\{([^}]*)\}/.exec(src)?.[1] ?? "").matchAll(/"([a-z_]+)":/g)].map((m) => m[1]),
      ];
      for (const n of diff(used, names)) p.push(`${key}: the ${s.label} sample sends ?${n}=, which the document does not list`);
    }
  }

  // Rows: only fields the router returns.
  const job = doc.components?.schemas?.Job?.properties ?? {};
  for (const c of diff(f.jobFields, Object.keys(job))) p.push(`Job leaves out ${c}, which every row carries`);
  for (const c of diff(Object.keys(job), f.jobFields)) {
    if (!new RegExp(`(?:\\b${c}:|\\.${c}\\s*=|,${c}\\b)`).test(router.rowWriterText)) p.push(`Job names ${c}, which the router never writes`);
  }
  const opened = Object.keys(doc.components?.schemas?.OpenedRow?.properties ?? {});
  if (diff(opened, f.changesOpenedFields).length || diff(f.changesOpenedFields, opened).length) p.push(`OpenedRow is ${opened.join(",")}; /v1/changes selects ${f.changesOpenedFields.join(",")}`);
  const closed = Object.keys(doc.components?.schemas?.ClosedRow?.properties ?? {});
  const closedWant = [...f.changesClosedFields.filter((c) => !router.closedMapRemoved.includes(c)), ...router.closedMapAdded];
  if (diff(closed, closedWant).length || diff(closedWant, closed).length) p.push(`ClosedRow is ${closed.join(",")}; /v1/changes publishes ${closedWant.join(",")}`);

  const fitOp = ops.get(`POST ${FIT_ENDPOINT}`);
  const fitProps = fitOp?.requestBody?.content?.["application/json"]?.schema?.properties ?? {};
  if (fitOp && (diff(Object.keys(fitProps), f.fit.bodyFields).length || diff(f.fit.bodyFields, Object.keys(fitProps)).length)) {
    p.push(`POST /v1/fit's body is ${Object.keys(fitProps).join(",")}; the router reads ${f.fit.bodyFields.join(",")}`);
  }
  if (fitOp && (fitProps.resumeText?.minLength !== f.fit.resumeTextMinChars || fitProps.limit?.maximum !== f.fit.limitMax || fitProps.limit?.default !== f.fit.limitDefault)) {
    p.push("POST /v1/fit's body bounds differ from the router's");
  }
  return p;
}

// ---------------------------------------------------------------------------
// The document the router's own facts build.
// ---------------------------------------------------------------------------

const INDEX_SRC = read("supabase/functions/public-api/index.ts");
const LAST_VERIFIED_SRC = read("supabase/functions/public-api/last-verified.ts");
const ROUTER = readRouter(INDEX_SRC, LAST_VERIFIED_SRC);
/** The address llms.txt publishes for /v1: what every sample and the server entry must name. */
const PUBLISHED = one(read("public/llms.txt"), /API address: (https:\/\/[^\s/]+)\/functions\/v1\/public-api\/v1 /, "published API address");
const SERVER = publicApiServer(PUBLISHED[1]);
const DOC = openApiDocument(ROUTER.facts, SERVER) as Doc;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("the document the router's facts build", () => {
  it("has nothing the router does not bear out", () => {
    expect(problemsOf(DOC, ROUTER)).toEqual([]);
  });

  it("describes the routes the router answers today, the withheld 451 included", () => {
    const ops = opsOf(DOC);
    expect([...ops.keys()].sort()).toEqual([...ROUTER.routes.keys()].sort());
    expect(ops.size).toBeGreaterThanOrEqual(9);
    expect(ops.get("GET /v1/jobs")?.responses?.["451"]?.["x-error-codes"]).toEqual(["source_not_redistributable"]);
    expect(ops.get(`GET ${APPLICATION_ENDPOINT}`)?.responses?.["451"]?.["x-error-codes"]).toEqual(["source_not_redistributable"]);
    expect(DOC["x-withheld-sources"]).toMatchObject({ sources: ROUTER.facts.withheldSources, status: 451 });
    expect(ROUTER.facts.withheldSources.length).toBeGreaterThan(0);
  });

  it("is JSON a client can load: unique operation ids, resolvable refs, declared path parameters", () => {
    const text = JSON.stringify(DOC);
    expect(JSON.parse(text)).toEqual(DOC);
    const ids = [...opsOf(DOC).values()].map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of text.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)) expect(DOC.components.schemas, m[1]).toHaveProperty(m[1]);
    for (const [key, op] of opsOf(DOC)) {
      const declared = (op.parameters ?? []).filter((x: Op) => x.in === "path").map((x: Op) => x.name);
      expect(declared, key).toEqual([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    }
  });

  it("names the address llms.txt publishes, and that address is the one the site builds", () => {
    expect(DOC.servers).toEqual([{ url: SERVER }]);
    expect(publicApiServer("https://abc.supabase.co/")).toBe(publicApiBase("https://abc.supabase.co/"));
    expect(publicApiServer("https://abc.supabase.co")).toBe(publicApiBase("https://abc.supabase.co"));
  });

  it("holds no words for a route, parameter or field the router does not have", () => {
    const served = new Set(ROUTER.routes.keys());
    // The document's own route is written ahead of the lane that serves it.
    expect(DESCRIBED_ROUTES.filter((r) => !served.has(r) && r !== `GET ${OPENAPI_PATH}`)).toEqual([]);
    expect(diff(DESCRIBED_PARAMS.jobs, ROUTER.facts.jobsParams)).toEqual([]);
    expect(diff(DESCRIBED_PARAMS.changes, ROUTER.facts.changesParams)).toEqual([]);
    expect(diff(DESCRIBED_PARAMS.companies, ROUTER.facts.companiesParams)).toEqual([]);
    expect(diff(DESCRIBED_FIELDS.job, ROUTER.facts.jobFields)).toEqual([]);
    expect(diff(DESCRIBED_FIELDS.changes, [...ROUTER.facts.changesOpenedFields, ...ROUTER.facts.changesClosedFields])).toEqual([]);
    expect(diff(DESCRIBED_FIT_FIELDS, ROUTER.facts.fit.bodyFields)).toEqual([]);
    expect([...ROUTER.closedMapRemoved].sort()).toEqual([...CLOSED_READ_NOT_PUBLISHED].sort());
    expect([...ROUTER.closedMapAdded].sort()).toEqual([...CLOSED_DERIVED].sort());
  });

  it("documents a closed list's members as the router's domain, less the systems it withholds", () => {
    for (const [param, cap] of Object.entries(ROUTER.facts.listFilterCaps)) {
      expect(cap, param).toBeGreaterThan(0);
      const d = documentedDomain(param, ROUTER.facts);
      if (param === "source") for (const w of ROUTER.facts.withheldSources) expect(d).not.toContain(w);
    }
  });
});

// ---------------------------------------------------------------------------
// The parse is not vacuous: the shipped handler answers what was read.
// ---------------------------------------------------------------------------

describe("the shipped handler agrees with what was read out of its source", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    ({ handler } = await loadPublicApi(() => new Response("{}", { status: 500 })));
  }, 120_000);

  const keyed = (path: string) => {
    const db = new RecordingDb();
    db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
    installDb(db);
    return callApi(handler, path);
  };
  const errorOf = (r: { body: Record<string, unknown> }) => r.body.error as { code: string; message: string };

  it("its index answers the version and the endpoint list the guard read", async () => {
    installDb(new RecordingDb());
    const r = await callApi(handler, "/v1", { auth: false });
    expect(r.status).toBe(200);
    expect(r.body.apiVersion).toBe(ROUTER.facts.apiVersion);
    expect(DOC.info.version).toBe(r.body.apiVersion);
    expect((r.body.endpoints as string[]).map(routeKeyOf).sort()).toEqual(servedRoutes(ROUTER.facts).filter((x) => x !== "GET /v1").sort());
  });

  const routesWithParams: Array<[string, string]> = [
    ["GET /v1/jobs", "/v1/jobs"],
    ["GET /v1/changes", "/v1/changes"],
    ["GET /v1/companies", "/v1/companies"],
    [`GET ${APPLICATION_ENDPOINT}`, "/v1/jobs/greenhouse%3Aacme%3A1/application"],
  ];
  for (const [key, path] of routesWithParams) {
    it(`${key}: the parameters its 400 names are the ones the document lists`, async () => {
      const r = await keyed(`${path}?zz_not_a_parameter=1`);
      expect(r.status).toBe(400);
      expect(errorOf(r).code).toBe("unknown_parameter");
      const accepts = /accepts: ([^.]*)\./.exec(errorOf(r).message)?.[1] ?? null;
      expect(accepts, errorOf(r).message).not.toBeNull();
      const named = accepts!.split(",").map((x) => x.trim()).filter(Boolean).sort();
      const documented = (opsOf(DOC).get(key)?.parameters ?? []).filter((x: Op) => x.in === "query").map((x: Op) => x.name).sort();
      expect(named).toEqual(documented);
    });
  }

  it("refuses the first offset past the MAX_OFFSET the guard read, and not that offset itself", async () => {
    const past = await keyed(`/v1/jobs?offset=${ROUTER.facts.maxOffset + 1}`);
    expect(past.status).toBe(400);
    expect(errorOf(past).code).toBe("offset_too_deep");
    const at = await keyed(`/v1/jobs?offset=${ROUTER.facts.maxOffset}`);
    expect(at.status === 400 && errorOf(at).code === "offset_too_deep").toBe(false);
  });

  it("refuses one value past each comma list's cap the guard read, and not the cap itself", async () => {
    for (const [param, cap] of Object.entries(ROUTER.facts.listFilterCaps)) {
      const values = (n: number) => Array.from({ length: n }, (_, i) => `z${String.fromCharCode(97 + (i % 26))}${i}`).join(",");
      const over = await keyed(`/v1/jobs?${param}=${values(cap + 1)}`);
      expect(over.status, param).toBe(400);
      expect(errorOf(over).message, param).toContain(`at most ${cap}`);
      const atCap = await keyed(`/v1/jobs?${param}=${values(cap)}`);
      expect(atCap.status === 400 && errorOf(atCap).message.includes("at most"), `${param} at its cap`).toBe(false);
    }
  });

  it("answers 451 for each hiring system the guard read as withheld, as the document says", async () => {
    for (const w of ROUTER.facts.withheldSources) {
      const r = await keyed(`/v1/jobs?source=${w}`);
      expect(r.status, w).toBe(451);
      expect(errorOf(r).code).toBe("source_not_redistributable");
    }
  });

  it("answers an unknown path with the 404 x-errors names", async () => {
    const r = await keyed("/v1/no-such-route");
    expect(r.status).toBe(404);
    expect(DOC["x-errors"]).toContainEqual({ status: 404, code: errorOf(r).code });
  });
});

// ---------------------------------------------------------------------------
// TEETH: each check fails when the thing it guards goes wrong.
// ---------------------------------------------------------------------------

describe("teeth", () => {
  it("a line-leading comment is not read as code, and a URL's slash pair inside a string is kept", () => {
    const src = [
      "const LIST = [",
      "  \"kept\",",
      "  // \"ghost\",",
      "  /* \"ghost_block\" */",
      "  /**",
      "   * \"ghost_doc\"",
      "   */ \"after_close\",",
      "] as const;",
      "const URL_LIKE = \"https://x.example//path\";",
    ].join("\n");
    const code = withoutLineLeadingComments(src);
    expect(constStrings(code, "LIST")).toEqual(["kept", "after_close"]);
    expect(code).toContain("https://x.example//path");
    expect(() => constStrings("const LIST = [\"a\", NOT_A_LITERAL];", "LIST")).toThrow(/other than string literals/);
  });

  it("a parameter the router takes and the document has no words for is named", () => {
    const facts = { ...clone(ROUTER.facts), jobsParams: [...ROUTER.facts.jobsParams, "ghost_param"] };
    const router = { ...ROUTER, facts, routes: new Map([...ROUTER.routes].map(([k, v]) => [k, k === "GET /v1/jobs" ? { ...v, params: [...(v.params ?? []), "ghost_param"] } : v])) } as Router;
    const problems = problemsOf(openApiDocument(facts, SERVER) as Doc, router);
    expect(problems.some((x) => /does not describe at .*parameters/.test(x))).toBe(true);
  });

  it("a parameter dropped from the document, or one the router refuses, is named", () => {
    const dropped = clone(DOC);
    const op = dropped.paths["/v1/jobs"].get;
    op.parameters = op.parameters.filter((x: Op) => x.name !== "max_age_days");
    expect(problemsOf(dropped, ROUTER)).toContain("GET /v1/jobs: the router takes ?max_age_days= and the document omits it");

    const added = clone(DOC);
    added.paths["/v1/changes"].get.parameters.push({ name: "ghost", in: "query", schema: { type: "string" } });
    expect(problemsOf(added, ROUTER)).toContain("GET /v1/changes: the document lists ?ghost= and the router refuses it as unknown");
  });

  it("a route the router dispatches and the document omits, or the reverse, is named", () => {
    const routes = new Map(ROUTER.routes);
    routes.set("GET /v1/ghost", { keyed: true, conditional: false, params: [], codes: new Set() });
    expect(problemsOf(DOC, { ...ROUTER, routes } as Router)).toContain("the router answers GET /v1/ghost and the document does not describe it");

    const extra = clone(DOC);
    extra.paths["/v1/ghost"] = { get: { responses: {} } };
    expect(problemsOf(extra, ROUTER)).toContain("the document describes GET /v1/ghost and the router does not answer it");
  });

  it("a refusal the router can give and the route's responses omit is named", () => {
    const doc = clone(DOC);
    const res = doc.paths["/v1/jobs"].get.responses["451"];
    res["x-error-codes"] = [];
    expect(problemsOf(doc, ROUTER)).toContain("GET /v1/jobs: the router can answer 451 source_not_redistributable and the document does not say so");
  });

  it("a cap or a closed list that differs from the router's is named", () => {
    const doc = clone(DOC);
    const source = doc.paths["/v1/jobs"].get.parameters.find((x: Op) => x.name === "source");
    source.schema.maxItems += 1;
    source.schema.items.enum = source.schema.items.enum.slice(1);
    const problems = problemsOf(doc, ROUTER);
    expect(problems.some((x) => x.startsWith("GET /v1/jobs: ?source= is a comma list of at most"))).toBe(true);
    expect(problems.some((x) => x.startsWith("GET /v1/jobs: ?source= takes"))).toBe(true);
  });

  it("a version, a header, a Retry-After or a sample that drifts is named", () => {
    const doc = clone(DOC);
    doc.info.version = "1999-01-01.1";
    doc.paths["/v1/stats"].get.responses["200"].headers["X-Not-Exposed"] = { schema: { type: "string" } };
    doc.paths["/v1/jobs"].get.responses["429"]["x-retry-after-codes"] = ["rate_limited"];
    const sample = doc.paths["/v1/companies"].get["x-codeSamples"].find((s: Op) => s.lang === "Shell");
    sample.source += ' \\\n  --data-urlencode "ghost_param=1"';
    const problems = problemsOf(doc, ROUTER);
    expect(problems).toContain(`info.version is 1999-01-01.1; the router's API_VERSION is ${ROUTER.facts.apiVersion}`);
    expect(problems).toContain("GET /v1/stats 200: a browser cannot read the X-Not-Exposed header the document promises");
    expect(problems.some((x) => x.startsWith("GET /v1/jobs 429: Retry-After is sent with"))).toBe(true);
    expect(problems).toContain("GET /v1/companies: the curl sample sends ?ghost_param=, which the document does not list");
  });

  it("a code the router answers and the catalogue leaves out is named", () => {
    const router = { ...ROUTER, allPairs: new Set([...ROUTER.allPairs, "418 ghost_code"]) } as Router;
    const problems = problemsOf(DOC, router);
    expect(problems).toContain("the router can answer 418 ghost_code and x-errors does not name it");
    expect(problems).toContain("the Error schema's code enum leaves out ghost_code");
  });

  it("a row field the router never writes is named", () => {
    const doc = clone(DOC);
    doc.components.schemas.Job.properties.ghost_field = { type: "string" };
    expect(problemsOf(doc, ROUTER)).toContain("Job names ghost_field, which the router never writes");
  });
});
