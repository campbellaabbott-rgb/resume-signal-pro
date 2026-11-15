import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * RETIRED. Answers every request with 410 and calls nothing.
 *
 * This was the AI summary at the top of the free report: a model endpoint on
 * the project's key, free, flash-lite first, 600 an hour site-wide.
 * Nothing calls it: no mounted page (a component that named it is imported
 * nowhere), script, worker, other function, migration's cron job, delivery
 * path or install-repo tool names it, and the warm-up does not list it (cost
 * audit 2026-11-08, lane ai).
 * The free report no longer mounts it (owner decision 2026-10-12).
 *
 * An endpoint nobody calls is safest when it does nothing at all, so it no
 * longer reads the body, touches the database or reaches the model, as
 * generate-tailored-resume-stream does. The previous implementation is in git
 * history if a caller ever needs it.
 */

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-11-09.1 (cost audit 2026-11-08, lane ai): retired; answers 410.
const FN_BUILD = "generate-summary.2026-11-09.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "This endpoint has been retired.",
      code: "retired",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
