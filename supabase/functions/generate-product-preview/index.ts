// deploy-stamp: 2026-10-04T13:00Z
// RETIRED (NB-10, owner: retire). Answers every request with 410 and calls
// nothing.
//
// This was preview-before-pay: a free slice of a paid product's deliverable,
// written by a model on the project's key for any visitor who asked, behind a
// per-address and a function-wide hour limit. No mounted page reached it: the
// apply-kit panel showed it only to a member without Pro, who is offered
// nothing since the Apply Assistant was retired (owner decision 2026-10-11),
// and the add-ons showcase that also showed it is imported by no page.
//
// A model endpoint nobody calls is safest when it does nothing at all, so it
// no longer reads the body, touches the database or reaches the model, as
// generate-summary does. The previous implementation is in git history if a
// caller ever needs it.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-28.1 (S13-001, S13-065, fix/full-analysis-timeout):
// _shared/ai-fallback.ts no longer asks a model that timed out again: this
// function's chain moves to the next model, which keeps at least 40 s of the
// 125 s budget when the first model times out. The cap is the largest
// legitimate preview measured from its fields, 380, plus the model's thinking
// (was 600 with the thinking in it; preview-reply.ts), and a reply cut off at
// it, empty, not JSON or with no body asks the next model; when none writes
// one the person is told to try again in words. Request, reply shape, the
// 429/402 answers and the prompt's text are unchanged. Nothing of main's past
// f8d72a9b, the build the 2026-10-31 deploy put live, rides along.
// 2026-11-09.1 (cost audit 2026-11-08, lane ai): a free teaser's chain is
// flash, then gpt-5-mini (_shared/ai-fallback.ts freeChainFrom): the model
// asked after a failed flash is no longer the dearest and slowest one. Flash
// still answers first, behind the same spend gate. Every reply's usage is
// logged (numbers only), and browsers keep the preflight two hours.
// 2026-11-12.1 (bug round of 2026-11-08, part A, writing-tools lane, S14X-109, through the shared gateway reader): a gateway out of credits is a retryable 503, never a 402.
const FN_BUILD = "generate-product-preview.2026-11-12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // One preflight per browser per two hours, as before the retirement.
  "Access-Control-Max-Age": "7200",
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
