/**
 * resume-match's HTTP door: who may call, with what, how often.
 *
 * TWO SURFACES.
 *   site     {action:"match", profile, widen?, followUp?}. The device read the
 *            résumé (_shared/resume-profile.ts in the browser) and sends only the
 *            confirmed profile and up to three titles. Résumé text is REFUSED
 *            here: on the site's paste path it never reaches the matcher.
 *   mcp, v1  {action:"match", resumeText, overrides?, surface}, accepted only
 *            from a caller holding the service-role key (agent-mcp, public-api in
 *            phase 2). The text is read in memory and dropped; those surfaces
 *            withhold the sources /v1 may not redistribute.
 *
 * ABUSE (owner decision 2). Before any work, an anonymous caller is checked
 * against job-board's own meter (job_board_anon_check, so the networks and
 * countries the board refuses are refused here too, and each call is one read
 * of the address's board day), then against this function's own bucket: 30
 * calls an hour per /24 or /48 network (_shared/network-bucket.ts; everyone on
 * one campus or carrier NAT shares it). A widening follow-up that carries the
 * first page's followUp token is not counted against the 30; it spends a
 * separate 150 an hour per network. A limiter that cannot answer is a 503,
 * never a pass. Requirement quotes are cut to about 160 characters.
 *
 * NOTHING ABOUT THE READER IS LOGGED: one line per call, counts and timings.
 */
import { isServiceRoleCaller } from "../_shared/service-caller.ts";
import { networkBucket } from "../_shared/network-bucket.ts";
import { readProfile, RADIUS_CHOICES } from "../_shared/resume-profile.ts";
import { MAX_RESUME_LENGTH } from "../_shared/input-limits.ts";
import { toCode } from "../_shared/work-countries.ts";
import type { Licence, LicenceKind } from "../_shared/licence-rules.ts";
import { NO_OCCUPATION } from "../_shared/match-tiers.ts";
import {
  ADDRESS_DAILY_CAP, ANON_BUDGET_DEADLINE_MS, BUILD_DAILY_CAP, bucketFor, budgetRefusal, classifyCaller, type CountedCaller, PROBE_DAILY_CAP,
} from "../job-board/anon-budget.ts";
import { type Client, type MatchInput, runMatch } from "./pipeline.ts";

/**
 * Sources the mcp and v1 surfaces may not redistribute: public-api's and
 * agent-mcp's NO_REDISTRIBUTION_SOURCES (src/test/match-serving-parity.test.ts
 * holds the three lists equal).
 */
export const SERVER_SURFACE_EXCLUDED_SOURCES: readonly string[] = ["usajobs", "smartrecruiters"];
export const SITE_PER_NETWORK_HOUR = 30;
export const WIDEN_PER_NETWORK_HOUR = 150;
export const RATE_FUNCTION = "resume-match";
export const WIDEN_RATE_FUNCTION = "resume-match-widen";
export const MAX_BODY_BYTES = 131_072;
export const STRING_MAX = 120;
export const ARRAY_MAX = 20;
export const RESUME_MIN_CHARS = 100;
export const FOLLOW_UP_TTL_MS = 30 * 60_000;

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-fn-build, retry-after",
};

export interface Deps {
  /** The build string index.ts stamps on every response (x-fn-build), echoed in the body. */
  build: string;
  client(): Client | null;
  serviceKey(): string;
  clock(): number;
  now(): number;
  order(): "rank" | "recent";
  log(line: string): void;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

class Invalid extends Error {
  constructor(public field: string, msg: string) { super(msg); }
}

const str = (v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | null => {
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new Invalid(field, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") throw new Invalid(field, `${field} must be a string`);
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (t.length > (opts.max ?? STRING_MAX)) throw new Invalid(field, `${field} is longer than ${opts.max ?? STRING_MAX} characters`);
  return t || null;
};
const arr = (v: unknown, field: string, max = ARRAY_MAX): unknown[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Invalid(field, `${field} must be an array`);
  if (v.length > max) throw new Invalid(field, `${field} holds at most ${max} items`);
  return v;
};
const cc = (v: unknown, field: string): string => {
  const s = str(v, field, { required: true, max: 60 })!;
  const code = /^[A-Za-z]{2}$/.test(s) ? (s.toUpperCase() === "UK" ? "GB" : s.toUpperCase()) : toCode(s);
  if (!code) throw new Invalid(field, `${field} is not a country this matcher knows`);
  return code;
};
const bool = (v: unknown, field: string, dflt = false): boolean => {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "boolean") throw new Invalid(field, `${field} must be true or false`);
  return v;
};
const num = (v: unknown, field: string, min: number, max: number): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Invalid(field, `${field} must be a number from ${min} to ${max}`);
  return v;
};
const oneOf = <T extends string>(v: unknown, field: string, allowed: readonly T[], dflt: T): T => {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new Invalid(field, `${field} must be one of ${allowed.join(", ")}`);
  return v as T;
};

const LEVELS = ["entry", "mid", "senior", "exec"] as const;
const AUTH = ["citizen", "permanent_resident", "student_visa", "work_visa", "unknown"] as const;
const DEGREES = ["high_school", "associate", "bachelor", "master", "doctorate"] as const;
const LICENCE_KINDS: readonly LicenceKind[] = ["rn", "lpn", "np", "pharmacist", "pt", "ot", "cpa", "teacher", "electrician", "cdl", "pe", "epa608", "nmc", "ahpra", "clearance"];
const CLEARANCES = ["secret", "top secret", "ts/sci", "public trust"] as const;

function place(v: unknown, field: string): MatchInput["home"] {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new Invalid(field, `${field} must be an object`);
  const o = v as Record<string, unknown>;
  return { city: str(o.city, `${field}.city`, { required: true })!, region: str(o.region, `${field}.region`, { max: 60 }), country: o.country === undefined || o.country === null ? null : cc(o.country, `${field}.country`) };
}

function relocateOf(v: unknown, field: string): MatchInput["relocate"] {
  if (v === undefined || v === null || v === "none") return "none";
  if (v === "country") return "country";
  return arr(v, field).map((x, i) => {
    const s = str(x, `${field}[${i}]`, { required: true, max: 3 })!.toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(s)) throw new Invalid(field, `${field} holds region codes (TX, ON, QLD)`);
    return s;
  });
}

/** The site's confirmed profile, validated. Unknown keys are ignored and never echoed. */
export function siteInput(v: unknown): MatchInput {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Invalid("profile", "profile is required");
  const p = v as Record<string, unknown>;
  const roles = arr(p.roles, "profile.roles", 3).map((x, i) => str(x, `profile.roles[${i}]`)).filter((x): x is string => !!x);
  const home = place(p.home, "profile.home");
  const extraPlaces = arr(p.extraPlaces, "profile.extraPlaces", 5).map((x, i) => place(x, `profile.extraPlaces[${i}]`)!).filter(Boolean);
  let canWorkIn = arr(p.canWorkIn, "profile.canWorkIn").map((x, i) => cc(x, `profile.canWorkIn[${i}]`));
  if (!canWorkIn.length && home?.country) canWorkIn = [home.country];
  const years = p.years === undefined || p.years === null ? null : (() => {
    const y = p.years as Record<string, unknown>;
    const low = num(y.low, "profile.years.low", 0, 60) ?? 0;
    const high = num(y.high, "profile.years.high", 0, 60) ?? low;
    return { low, high: Math.max(low, high) };
  })();
  const licences: Licence[] = arr(p.licences, "profile.licences").map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      kind: oneOf(o.kind, `profile.licences[${i}].kind`, LICENCE_KINDS, "rn"),
      jurisdiction: str(o.jurisdiction, `profile.licences[${i}].jurisdiction`, { max: 10 })?.toUpperCase() ?? null,
      compact: bool(o.compact, `profile.licences[${i}].compact`),
      grade: str(o.grade, `profile.licences[${i}].grade`, { max: 20 })?.toLowerCase() ?? null,
      basis: "",
    };
  });
  const wa = (p.workAuth ?? {}) as Record<string, unknown>;
  return {
    roles,
    home: home ? { ...home, country: home.country ?? canWorkIn[0] ?? null } : null,
    extraPlaces,
    relocate: relocateOf(p.relocate, "profile.relocate"),
    remote: bool(p.remote, "profile.remote"),
    radiusKm: (() => {
      const r = num(p.radiusKm, "profile.radiusKm", 1, 200) ?? 40;
      if (!(RADIUS_CHOICES as readonly number[]).includes(r)) throw new Invalid("profile.radiusKm", `profile.radiusKm must be ${RADIUS_CHOICES.join(", ")}`);
      return r;
    })(),
    canWorkIn,
    level: oneOf(p.level, "profile.level", LEVELS, "mid"),
    years,
    targetYears: num(p.targetYears, "profile.targetYears", 0, 60),
    careerChanger: bool(p.careerChanger, "profile.careerChanger"),
    former: str(p.former, "profile.former"),
    student: bool(p.student, "profile.student"),
    degree: p.degree === undefined || p.degree === null ? null : oneOf(p.degree, "profile.degree", DEGREES, "bachelor"),
    licences,
    workAuth: {
      status: oneOf(wa.status, "profile.workAuth.status", AUTH, "unknown"),
      needsSponsorship: bool(wa.needsSponsorship, "profile.workAuth.needsSponsorship"),
      citizenOf: arr(wa.citizenOf, "profile.workAuth.citizenOf").map((x, i) => cc(x, `profile.workAuth.citizenOf[${i}]`)),
      clearance: wa.clearance === undefined || wa.clearance === null ? null : oneOf(wa.clearance, "profile.workAuth.clearance", CLEARANCES, "secret"),
    },
  };
}

/** mcp / v1: the profile read from the résumé on this server, then the caller's overrides (only what the user said). */
export function serverInput(resumeText: string, overrides: unknown, nowYear: number): MatchInput {
  const p = readProfile(resumeText, { nowYear });
  const o = (overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {}) as Record<string, unknown>;
  const query = str(o.query, "overrides.query");
  const location = str(o.location, "overrides.location");
  const country = o.country === undefined || o.country === null ? null : cc(o.country, "overrides.country");
  let home = p.home;
  if (location) {
    const [city, region] = location.split(",").map((s) => s.trim());
    home = { city, region: region || null, country: country ?? home?.country ?? null };
  } else if (country && home && home.country !== country) home = null;
  const canWorkIn = arr(o.canWorkIn, "overrides.canWorkIn").map((x, i) => cc(x, `overrides.canWorkIn[${i}]`));
  const auth = o.workAuthorisation === undefined ? null : oneOf(o.workAuthorisation, "overrides.workAuthorisation", ["citizen", "permanent_resident", "needs_sponsorship", "unknown"] as const, "unknown");
  const workAuth = { ...p.workAuth };
  if (auth === "needs_sponsorship") { workAuth.needsSponsorship = true; workAuth.status = workAuth.status === "citizen" ? "unknown" : workAuth.status; }
  else if (auth === "citizen" || auth === "permanent_resident") { workAuth.status = auth; workAuth.needsSponsorship = false; }
  else if (auth === "unknown") { workAuth.status = "unknown"; workAuth.needsSponsorship = false; workAuth.citizenOf = []; }
  return {
    roles: query ? [query, ...p.roles.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 3) : p.roles,
    home,
    extraPlaces: p.extraPlaces,
    relocate: o.relocate === undefined ? p.relocate : relocateOf(o.relocate, "overrides.relocate"),
    remote: o.remote === undefined ? p.remote : bool(o.remote, "overrides.remote"),
    radiusKm: p.radiusKm,
    canWorkIn: canWorkIn.length ? canWorkIn : country ? [country] : p.canWorkIn,
    level: p.level,
    years: p.years,
    targetYears: p.targetYears,
    careerChanger: p.careerChanger,
    former: p.former,
    student: p.student,
    degree: p.degree,
    licences: p.licences,
    workAuth,
  };
}

// ---------------------------------------------------------------------------
// The follow-up token: a widening call for the same search is not a new search.
// ---------------------------------------------------------------------------

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${key}:resume-match-follow-up`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))).slice(0, 32);
}
function searchKey(i: MatchInput): string {
  return JSON.stringify([i.roles, i.home, i.extraPlaces, i.relocate, i.remote, i.radiusKm, i.canWorkIn]);
}
export async function followUpToken(serviceKey: string, input: MatchInput, nowMs: number): Promise<string> {
  const exp = nowMs + FOLLOW_UP_TTL_MS;
  return `v1.${exp}.${await hmac(serviceKey, `${exp}|${searchKey(input)}`)}`;
}
export async function followUpValid(serviceKey: string, token: unknown, input: MatchInput, nowMs: number): Promise<boolean> {
  if (typeof token !== "string" || token.length > 80 || !serviceKey) return false;
  const m = /^v1\.(\d{10,16})\.([0-9a-f]{32})$/.exec(token);
  if (!m || Number(m[1]) < nowMs) return false;
  const want = await hmac(serviceKey, `${m[1]}|${searchKey(input)}`);
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return d === 0;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed", message: "POST {\"action\":\"match\", ...}" }, 405);
  const started = deps.clock();

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large", message: `Request body over ${MAX_BODY_BYTES} bytes.` }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json", message: "The body must be a JSON object." }, 400);
  }
  if (body.action !== "match") return json({ error: "unknown_action", message: "action must be \"match\"." }, 400);
  const surface = body.surface === undefined ? "site" : body.surface;
  if (surface !== "site" && surface !== "mcp" && surface !== "v1") return json({ error: "invalid_surface", message: "surface must be site, mcp or v1." }, 400);

  const serviceKey = deps.serviceKey();
  const isService = isServiceRoleCaller(req.headers, serviceKey);
  if (surface !== "site" && !isService) {
    return json({ error: "server_surface", message: "The mcp and v1 surfaces answer only our own servers." }, 403);
  }
  if (body.resumeText !== undefined && (!isService || surface === "site")) {
    return json({ error: "resume_text_refused", message: "Résumé text is accepted only from our own servers. Send the confirmed profile instead." }, 400);
  }
  const widen = body.widen === undefined || body.widen === null ? 0 : Number(body.widen);
  if (!Number.isInteger(widen) || widen < 0 || widen > 6) return json({ error: "invalid_widen", message: "widen must be a whole number from 1 to 6." }, 400);

  let input: MatchInput;
  try {
    if (surface === "site") input = siteInput(body.profile);
    else {
      const text = typeof body.resumeText === "string" ? body.resumeText : "";
      if (text.trim().length < RESUME_MIN_CHARS) throw new Invalid("resumeText", `resumeText (${RESUME_MIN_CHARS}+ characters) is required`);
      if (text.length > MAX_RESUME_LENGTH) throw new Invalid("resumeText", `resumeText is longer than ${MAX_RESUME_LENGTH} characters`);
      input = serverInput(text, body.overrides, new Date(deps.now()).getUTCFullYear());
    }
  } catch (e) {
    if (e instanceof Invalid) return json({ error: "invalid_input", field: e.field, message: e.message }, 400);
    throw e;
  }
  if (!input.roles.length) return json({ error: "no_occupation", message: NO_OCCUPATION }, 422);

  const client = deps.client();
  if (!client) return json({ error: "unavailable", message: "Matching is unavailable right now." }, 503, { "Retry-After": "60" });

  // ---- abuse: the board's meter, then this function's own bucket, before any work
  let anonMs = 0;
  if (!isService) {
    const a0 = deps.clock();
    try {
      const caller = await classifyCaller(req.headers, serviceKey, "");
      if (!caller.exempt) {
        const c = caller as CountedCaller;
        const args = {
          p_bucket: await bucketFor(c, serviceKey), p_kind: c.kind, p_country: c.country,
          p_address_cap: ADDRESS_DAILY_CAP, p_build_cap: BUILD_DAILY_CAP, p_probe_cap: PROBE_DAILY_CAP,
          p_bare: c.bare, p_net: c.net, p_pass: "unconfigured", p_pass_id: null,
        };
        const q = client.rpc("job_board_anon_check", args);
        const { data, error } = await raceLimiter(q, ANON_BUDGET_DEADLINE_MS);
        if (error) return limiterDown(deps, "anon");
        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
        if (row && row.is_allowed === false) {
          deps.log(`[resume-match] surface=site status=429 refused=board_${row.network_rule === true ? "network" : row.country_rule === true ? "country" : "address"}`);
          return budgetRefusal({
            code: row.network_rule === true ? "network" : row.country_rule === true ? "country" : "address",
            limit: Number(row.cap_today) || 0, used: Number(row.used_today) || 0,
          }, CORS);
        }
      }
      const follow = widen > 0 && await followUpValid(serviceKey, body.followUp, input, deps.now());
      const fn = follow ? WIDEN_RATE_FUNCTION : RATE_FUNCTION;
      const max = follow ? WIDEN_PER_NETWORK_HOUR : SITE_PER_NETWORK_HOUR;
      const bucket = await networkBucket(req.headers, serviceKey, RATE_FUNCTION);
      const { data: allowed, error: limitErr } = await raceLimiter(client.rpc("check_rate_limit", { p_ip: bucket, p_function: fn, p_max_requests: max, p_window_minutes: 60 }), ANON_BUDGET_DEADLINE_MS);
      if (limitErr || typeof allowed !== "boolean") return limiterDown(deps, "bucket");
      if (allowed === false) {
        deps.log("[resume-match] surface=site status=429 refused=network_hour");
        return json({
          error: "rate_limited",
          message: `This network has made ${max} matches this hour; the allowance resets within the hour. Everyone on the same network shares it.`,
          limit: max, window: "1h", scope: "network",
        }, 429, { "Retry-After": "3600" });
      }
    } catch {
      return limiterDown(deps, "anon");
    }
    anonMs = Math.round(deps.clock() - a0);
  }

  // ---- the match
  try {
    const result = await runMatch(client, input, {
      widen,
      excludeSources: surface === "site" ? null : [...SERVER_SURFACE_EXCLUDED_SOURCES],
      order: deps.order(),
      nowMs: deps.now(),
      startedMs: started,
      clock: deps.clock,
    });
    const total = Math.round(deps.clock() - started);
    const followUp = surface === "site" && widen === 0 ? await followUpToken(serviceKey, input, deps.now()) : null;
    deps.log(`[resume-match] surface=${surface} status=200 rows=${result.rows.length} found=${result.basis.found} read=${result.basis.read} widen=${widen} ms=${total} cpu=${result.cpuMs}${result.deadlineMissed ? ` missed=${result.deadlineMissed}` : ""}`);
    return json({
      build: deps.build,
      surface,
      ...result,
      phaseMs: { anon: anonMs, ...result.phaseMs, total },
      followUp,
    });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    deps.log(`[resume-match] surface=${surface} status=500 code=${code}`);
    return json({ error: "match_unavailable", message: "Matching failed. Please try again." }, 500);
  }
}

async function raceLimiter<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error("limiter deadline")), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function limiterDown(deps: Deps, which: "anon" | "bucket"): Response {
  deps.log(`[resume-match] surface=site status=503 limiter=${which}`);
  return json({ error: "limiter_unavailable", message: "Matching is busy right now. Please try again in a minute." }, 503, { "Retry-After": "60" });
}
