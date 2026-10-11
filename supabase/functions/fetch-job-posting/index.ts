// fetch-job-posting: the scanner's "Job URL" tab (sweep S11-032). What it
// does and in which order: handler.ts. The fence: hosts.ts and net-guard.ts.
import { getServiceClient } from "../_shared/supabase-client.ts";
import { stamped } from "../_shared/fn-build.ts";
import { handleFetchJobPosting } from "./handler.ts";
import { runtimeResolver } from "./net-guard.ts";

// The build every response names (x-fn-build); see _shared/fn-build.ts.
const FN_BUILD = "fetch-job-posting.2026-10-09.71";

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
