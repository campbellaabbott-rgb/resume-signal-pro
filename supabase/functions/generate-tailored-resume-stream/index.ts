// deploy-stamp: 2026-10-04T18:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * RETIRED. Answers every request with 410 and calls nothing.
 *
 * This was a streaming twin of generate-tailored-resume, added 2025-12-24 and
 * never wired to anything: no page, script, worker or other function calls it
 * (only the warm-up pinged it, and no longer does). It was nevertheless a live
 * model endpoint on the project's key -- openai/gpt-5 at up to 6,000 output
 * tokens -- and its purchase check accepted ANY claimed session, a $2 scan pack
 * included, because it had no product of its own to check against. One cheap
 * purchase and a rotating address pool bought gpt-5 completions at twenty an
 * hour per address for as long as the session row lived.
 *
 * An endpoint nobody calls is safest when it does nothing at all, so it no
 * longer reads the body, touches the database or reaches the model. The
 * résumé tailoring that IS used lives in generate-tailored-resume (free, with
 * the spend gate in front) and generate-apply-package (the Apply Assistant).
 * The previous implementation is in git history if a caller ever needs it.
 */

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "generate-tailored-resume-stream.2026-10-10.1";

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
      error: "This endpoint has been retired. Use generate-tailored-resume.",
      code: "retired",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
