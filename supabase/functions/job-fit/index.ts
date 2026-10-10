// THE SCORER, IN ITS OWN ISOLATE.
//
// fit-terms and fit-batch lived inside job-board, the 13k-line function that
// also runs the ingest rotation. They shared its worker pool. Measured
// 2026-09-03 with a request hook in a real browser: a reader dropped a résumé,
// the parse and the search both answered 200, and fit-batch answered 546
// WORKER_RESOURCE_LIMIT — the same limit that had been killing ingest slices
// all week. At the client's batch of sixty, two of four calls died; at
// twenty, none. The batch was cut to twenty as a mitigation and it held, but
// a reader's score was still competing with the rotation for a worker, and
// the only reason it won was that the rotation happened to be between slices.
//
// So the two actions move here, byte-for-byte in semantics, and job-board
// keeps its copies so an older bundle still works. Nothing else changes: the
// same rate-limit RPC and window, the same twenty-id cap, the same
// description bound, the same honest null for a posting without a description.
//
// ONE ALLOWANCE PER CALLER, NOT ONE PER EGRESS ADDRESS. The daily bucket was
// keyed on x-forwarded-for, which is the reader's own address when the site
// calls in — and the edge runtime's egress address (or the literal "unknown")
// when public-api's POST /v1/fit or agent-mcp's fit_resume calls in on a
// customer's behalf. Every paying API customer and every MCP agent therefore
// drew from ONE 120/day row, and the 121st call of the day across all of them
// was refused — reported upstream as a 502 "retry shortly" that could not
// succeed for up to 24 hours. A keyed caller now names its bucket
// (x-rb-bucket: key:<api_key_id>), and the scorer honours that name only when
// the request also carries the service-role key as its bearer: the anon key
// is in every browser bundle, so a header alone would let a curl user pick
// any bucket they liked and walk out of the IP allowance.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeFit, resumeRoleTerms, scanResume } from "../_shared/fit-score.ts";

// x-rb-bucket is deliberately NOT in Allow-Headers: a browser cannot send it,
// and a server caller does not preflight.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors, ...extra } });

/** Mirrors job-board: twenty survives a shared worker pool where sixty did not. */
const FIT_BATCH_MAX = 20;
/** Mirrors job-board: computeFit walks the whole dictionary against the text. */
const FIT_DESC_CHARS = 20_000;
/** The site's allowance per reader address — unchanged from the job-board copy. */
const FIT_IP_MAX = 120;
/**
 * A keyed caller's allowance per API key. The key is already metered by
 * api_key_check (its own per-minute rate and daily quota, both printed on
 * every response), so this is a backstop for the scorer's CPU, not a second
 * quota the customer was never told about. 1,000 is check_rate_limit's own
 * ceiling for p_max_requests and equals a key's default daily quota, so a
 * default key can never hit this before its published limit.
 */
const FIT_KEY_MAX = 1000;
/** check_rate_limit refuses p_ip longer than 45; "key:" + a uuid is 40. */
const BUCKET_SHAPE = /^key:[A-Za-z0-9-]{1,41}$/;

/** Which daily row this request spends from, and how deep that row is. */
function bucketFor(req: Request): { id: string; max: number; scope: "key" | "ip" } {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const named = req.headers.get("x-rb-bucket")?.trim() ?? "";
  if (named && service && bearer === service && BUCKET_SHAPE.test(named)) {
    return { id: named, max: FIT_KEY_MAX, scope: "key" };
  }
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return { id: clientIp, max: FIT_IP_MAX, scope: "ip" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST { action: \"fit-terms\" | \"fit-batch\", ... }" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const action = String(body.action ?? "");
  const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";

  try {
    if (action === "fit-terms") {
      // Pure CPU, nothing read or written, the résumé does not outlive the
      // isolate — and therefore no rate-limit round trip.
      if (resumeText.trim().length < 100) return json({ error: "resumeText (100+ chars) is required" }, 400);
      return json({ terms: resumeRoleTerms(resumeText, 4) });
    }

    if (action === "fit-batch") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, FIT_BATCH_MAX) : [];
      if (resumeText.trim().length < 100 || ids.length === 0) {
        return json({ error: "resumeText (100+ chars) and ids are required" }, 400);
      }
      const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
      const bucket = bucketFor(req);
      // Same bucket name as job-board's copy, so a reader's daily allowance is
      // one allowance however the client reaches the scorer.
      const { data: allowed } = await client.rpc("check_rate_limit", {
        p_function: "job-board-fit", p_ip: bucket.id, p_max_requests: bucket.max, p_window_minutes: 1440,
      });
      if (allowed === false) {
        // The window is 24h from the bucket's first call; the RPC does not say
        // how much of it is left, so the hint is an hour, like the API's own
        // daily-quota refusal. `rateLimited` stays for bundles that read it.
        return json({
          error: "rate_limited",
          message: `Daily fit-scoring allowance of ${bucket.max} reached; it resets 24 hours after the first scored call.`,
          limit: bucket.max, window: "24h", scope: bucket.scope, rateLimited: true,
        }, 429, { "Retry-After": "3600" });
      }

      // min_years JOINS THE SELECT, AND IT IS THE ONLY NEW COLUMN.
      //
      // The scorer read every word of a posting except the one that decides
      // whether the reader can have it. `min_years` is already stored, already
      // honest — job-board/experience.ts pulls it from the posting's own text
      // and leaves it null when the posting does not say — and costs nothing
      // extra to fetch alongside the description we already read.
      //
      // Deliberately NOT experience_band. The band is partly inferred from the
      // TITLE ("Senior…" ⇒ senior), which is a guess about the employer's
      // wording, while min_years is a number the posting printed. A demotion
      // has to be able to point at the sentence it came from.
      const { data: rows, error } = await client.from("job_board_postings").select("id, description, min_years").in("id", ids);
      if (error) throw error;
      const fits: Record<string, number | null> = {};
      const missing: Record<string, string[]> = {};
      const matched: Record<string, string[]> = {};
      let scored = 0;
      const resumeScan = scanResume(resumeText);
      for (const r of rows ?? []) {
        if (r.description && r.description.length > 150) {
          const minYears = typeof r.min_years === "number" ? r.min_years : null;
          const f = computeFit(r.description.slice(0, FIT_DESC_CHARS), resumeScan, 40, minYears);
          fits[r.id] = f.pct;
          if (f.missing.length > 0) missing[r.id] = f.missing.slice(0, 4);
          if (f.matched.length > 0) matched[r.id] = f.matched.slice(0, 6);
          scored++;
        } else {
          fits[r.id] = null; // no stored description — honest null
        }
      }
      return json({ fits, missing, matched, scored, of: ids.length });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    console.error("[JOB-FIT]", e instanceof Error ? e.message.slice(0, 200) : String(e));
    return json({ error: "Fit scoring is temporarily unavailable." }, 500);
  }
});
