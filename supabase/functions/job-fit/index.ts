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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeFit, resumeRoleTerms, scanResume } from "../_shared/fit-score.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors } });

/** Mirrors job-board: twenty survives a shared worker pool where sixty did not. */
const FIT_BATCH_MAX = 20;
/** Mirrors job-board: computeFit walks the whole dictionary against the text. */
const FIT_DESC_CHARS = 20_000;

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
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      // Same bucket name as job-board's copy, so a reader's daily allowance is
      // one allowance however the client reaches the scorer.
      const { data: allowed } = await client.rpc("check_rate_limit", {
        p_function: "job-board-fit", p_ip: clientIp, p_max_requests: 120, p_window_minutes: 1440,
      });
      if (allowed === false) return json({ error: "Daily fit-ranking limit reached.", rateLimited: true }, 429);

      const { data: rows, error } = await client.from("job_board_postings").select("id, description").in("id", ids);
      if (error) throw error;
      const fits: Record<string, number | null> = {};
      const missing: Record<string, string[]> = {};
      const matched: Record<string, string[]> = {};
      let scored = 0;
      const resumeScan = scanResume(resumeText);
      for (const r of rows ?? []) {
        if (r.description && r.description.length > 150) {
          const f = computeFit(r.description.slice(0, FIT_DESC_CHARS), resumeScan, 40);
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
