// RÉSUMÉ MATCH (phase 0: behind no UI).
//
// Finds postings a reader could apply for from a confirmed profile: in their
// commute ring, remote in a country they said they can work in, or where they
// said they would move; titled in their occupation at their level; then reads
// each top candidate's stated requirements and tiers it Strong, Good or
// Stretch. Everything set aside is counted under its reason. No model call.
// Design: docs/resume-match.md. The door is handler.ts, the work pipeline.ts.
//
// Every response, the preflight included, names its build in x-fn-build.
import { stamped } from "../_shared/fn-build.ts";
import { getServiceClient } from "../_shared/supabase-client.ts";
import { handle } from "./handler.ts";

// 2026-10-16.1: phase 0, the engine and resume-match behind no UI (docs/resume-match-deploy-notes.md).
const FN_BUILD = "resume-match.2026-10-16.1";

Deno.serve(stamped(FN_BUILD, (req) => handle(req, {
  build: FN_BUILD,
  client: () => getServiceClient(),
  serviceKey: () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  clock: () => performance.now(),
  now: () => Date.now(),
  // The spec 6.5 timing gate's fallback, switchable without a deploy of code.
  order: () => (Deno.env.get("RESUME_MATCH_ORDER") === "recent" ? "recent" : "rank"),
  log: (line) => console.log(line),
})));
