// employer-profiles: what each employer's own postings say, counted and dated.
//
//   POST {action: "sweep"}                          every minute, from pg_cron only (x-employer-profiles-cron):
//                                                   read serving postings with the frozen perk extractor and
//                                                   store what they say (sweep.ts)
//   POST {action: "audit_status"}                   the owner (x-admin-key): keys, audits, switches, lap, runs
//   POST {action: "audit_draw", perk, rows?}        the owner: 60 random publishable rows of one candidate key,
//                                                   each with its quote, the posting it came from and a
//                                                   3-posting spot check (scripts/perk-audit.mjs writes them
//                                                   to a review file)
//   POST {action: "audit_record", perk, mode,       the owner: a judgement written back -- launch (60 judged,
//         judged, correct, note?}                   57 right publishes), reaudit (a stratum of 5+; two wrong
//                                                   unpublishes, else the 45 days restart), withdraw
//   POST {action: "audit_pause", sweep?, publish?}  the owner: the two switches
//
// Company profiles, phase 1 (plan 2026-10-11). Its own function, never a
// job-board action: job-board sits near its 4.5 MB source cap, and nothing
// here may touch a posting's description, pay or search fields. The perk
// rows it writes are private (20261012110000); the only public door to them
// is get_employer_perks, which shows a key only while its audit is fresh.
//
// TWO DOORS, EACH ITS OWN KEY. The sweep answers only the cron's key, which
// 20261012111000 generated into the vault and employer_profiles_cron_key_matches
// checks with the service role (or EMPLOYER_PROFILES_CRON_SECRET when that is
// set). The audit actions answer only the owner's ADMIN_API_KEY, compared in
// constant time (_shared/admin-key.ts). A caller holding neither is a 401
// before any client is built; the owner's key does not run the sweep and the
// cron's key opens no audit action.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stamped } from "../_shared/fn-build.ts";
import { keyMatches } from "../_shared/admin-key.ts";
import { CANDIDATE_KEYS, EXTRACTOR_VERSION } from "../_shared/perks-extract.ts";
import { runSweep } from "./sweep.ts";

// Provable from outside without a key: every response, the preflight
// included, carries this in x-fn-build (stamped()).
export const FN_BUILD = "employer-profiles.2026-10-12.2";

const CRON_HEADER = "x-employer-profiles-cron";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `authorization, x-client-info, apikey, content-type, x-admin-key, ${CRON_HEADER}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const SCHEDULER_ONLY = "The sweep is for the scheduler only.";
const AUDIT_ACTIONS = new Set(["audit_status", "audit_draw", "audit_record", "audit_pause"]);
const AUDIT_MODES = new Set(["launch", "reaudit", "withdraw"]);

// deno-lint-ignore no-explicit-any
type Client = any;

const serviceClient = (): Client =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });

async function cronAuthorised(sent: string, client: Client): Promise<boolean> {
  if (sent.length < 32) return false;
  const env = Deno.env.get("EMPLOYER_PROFILES_CRON_SECRET") ?? "";
  if (env.length >= 32) return keyMatches(sent, env);
  try {
    const { data, error } = await client.rpc("employer_profiles_cron_key_matches", { p_key: sent });
    if (error) {
      console.warn("[employer-profiles] cron key check failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn("[employer-profiles] cron key check threw:", e);
    return false;
  }
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** The audit actions: inputs checked here, decisions made in SQL (20261012110000). */
async function audit(client: Client, action: string, body: Record<string, unknown>): Promise<Response> {
  let call: { fn: string; args: Record<string, unknown> };
  if (action === "audit_status") {
    call = { fn: "employer_perk_audit_status", args: {} };
  } else if (action === "audit_draw") {
    const perk = String(body.perk ?? "");
    if (!(CANDIDATE_KEYS as readonly string[]).includes(perk)) return json(400, { error: `not a candidate key: ${perk || "(none)"}`, candidates: CANDIDATE_KEYS });
    const rows = body.rows === undefined ? 60 : body.rows;
    if (!isInt(rows, 1, 200)) return json(400, { error: "rows must be a whole number from 1 to 200" });
    call = { fn: "employer_perk_audit_draw", args: { p_perk: perk, p_rows: rows } };
  } else if (action === "audit_record") {
    const perk = String(body.perk ?? "");
    const mode = String(body.mode ?? "");
    if (!/^[a-z_]{2,40}$/.test(perk)) return json(400, { error: "perk must name a key" });
    if (!AUDIT_MODES.has(mode)) return json(400, { error: "mode must be launch, reaudit or withdraw" });
    const judged = mode === "withdraw" ? (body.judged ?? 0) : body.judged;
    const correct = mode === "withdraw" ? (body.correct ?? 0) : body.correct;
    if (!isInt(judged, 0, 10000) || !isInt(correct, 0, 10000) || correct > judged) {
      return json(400, { error: "judged and correct must be whole numbers with correct <= judged" });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    call = { fn: "employer_perk_audit_record", args: { p_perk: perk, p_mode: mode, p_judged: judged, p_correct: correct, p_note: note } };
  } else {
    const sweep = body.sweep;
    const publish = body.publish;
    if ((sweep !== undefined && typeof sweep !== "boolean") || (publish !== undefined && typeof publish !== "boolean")) {
      return json(400, { error: "sweep and publish must be true or false when given" });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    call = { fn: "employer_profile_set_pause", args: { p_sweep: sweep ?? null, p_publish: publish ?? null, p_note: note } };
  }
  const { data, error } = await client.rpc(call.fn, call.args);
  if (error) {
    console.error(`[employer-profiles] ${call.fn} failed: ${error.message}`);
    return json(error.code === "22023" ? 400 : 502, { error: error.message, code: error.code ?? null });
  }
  return json(200, { build: FN_BUILD, extractorVersion: EXTRACTOR_VERSION, data });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // Neither key, no work: refused before a body is read or a client exists.
  const byOwner = keyMatches(req.headers.get("x-admin-key") ?? "", Deno.env.get("ADMIN_API_KEY") ?? "");
  const cronKey = req.headers.get(CRON_HEADER) ?? "";
  if (!byOwner && cronKey.length < 32) return json(401, { error: "Unauthorized" });

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return json(400, { error: "body must be JSON: {action, ...}" });
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "sweep") {
    if (cronKey.length < 32) return json(401, { error: SCHEDULER_ONLY });
    const client = serviceClient();
    if (!(await cronAuthorised(cronKey, client))) return json(401, { error: SCHEDULER_ONLY });
    const result = await runSweep(client, { build: FN_BUILD });
    console.log(`[employer-profiles] kind=sweep ${JSON.stringify(result)}`);
    return json(result.ok ? 200 : 500, result);
  }

  if (AUDIT_ACTIONS.has(action)) {
    if (!byOwner) return json(401, { error: "Unauthorized" });
    return await audit(serviceClient(), action, body);
  }

  return json(400, { error: `unknown action: ${action || "(none)"}` });
}

serve(stamped(FN_BUILD, handler));
