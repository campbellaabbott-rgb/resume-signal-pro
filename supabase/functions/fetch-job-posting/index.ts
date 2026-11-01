// fetch-job-posting: the scanner's "Job URL" tab (sweep S11-032). What it
// does and in which order: handler.ts. The fence: hosts.ts and net-guard.ts.
import { getServiceClient } from "../_shared/supabase-client.ts";
import { stamped } from "../_shared/fn-build.ts";
import { handleFetchJobPosting } from "./handler.ts";
import { runtimeResolver } from "./net-guard.ts";

// The build every response names (x-fn-build); see _shared/fn-build.ts.
// .27 (the merge recheck, 2026-10-25): an Oracle requisition id with letters (REQ_820519) is read through the ById finder.
// 2026-10-28.1 (S12-147 finished, fix/full-analysis-timeout): htmlToText drops hidden elements (display:none, visibility:hidden,
// hidden, aria-hidden, font-size:0) with everything inside them before it strips the tags, through _shared/posting-text.ts
// dropHiddenElements, one linear pass; nothing of main's past f8d72a9b rides along.
const FN_BUILD = "fetch-job-posting.2026-10-28.1";

const fetchImpl = (url: string, init: RequestInit) => fetch(url, init);
const resolve = runtimeResolver(fetchImpl);

Deno.serve(stamped(FN_BUILD, (req) => {
  // deno-lint-ignore no-explicit-any
  const client: any = getServiceClient();
  return handleFetchJobPosting(req, {
    fetch: fetchImpl,
    resolve,
    rpc: (fn, args) => client.rpc(fn, args),
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  });
}));
