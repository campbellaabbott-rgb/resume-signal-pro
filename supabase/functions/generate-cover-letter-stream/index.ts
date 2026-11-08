import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * RETIRED. Answers every request with 410 and calls nothing.
 *
 * This was a streaming twin of generate-cover-letter: a model endpoint on the
 * project's key, behind a purchase check, for a product no longer sold.
 * Nothing calls it: no page, component, script, worker, other function,
 * migration's cron job, delivery path or install-repo tool names it (cost
 * audit 2026-11-08, lane ai), and the warm-up no longer lists it.
 * Every delivery of a bought letter (the webhook, the success page, the retry
 * sweep) calls generate-cover-letter.
 *
 * An endpoint nobody calls is safest when it does nothing at all, so it no
 * longer reads the body, touches the database or reaches the model, as
 * generate-tailored-resume-stream does. The previous implementation is in git
 * history if a caller ever needs it.
 */

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-11-10.2 (cost audit 2026-11-08, lane ai): retired; answers 410.
const FN_BUILD = "generate-cover-letter-stream.2026-11-10.2";

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
      error: "This endpoint has been retired. Use generate-cover-letter.",
      code: "retired",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
