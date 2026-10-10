// @vitest-environment node
/**
 * THE TWO FIT SCORERS COULD NOT PROVE THEY CARRY THE CAP (review of register
 * L8-13, 2026-10-10).
 *
 * The fit score's cap at 100 lives in _shared/fit-score.ts, so job-fit and
 * application-fit change behaviour with it and need a redeploy. Neither
 * answered an x-fn-build, so that redeploy could not be verified from
 * outside and the verifier section had no line for either. Both preflights
 * now carry a build of 2026-10-09 or later.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

let jobFit: EdgeHandler;
let applicationFit: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: () => undefined }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const stub = "export const createClient = () => ({});";
  jobFit = await loadEdgeHandler("job-fit", { "https://esm.sh/@supabase/supabase-js@2.45.0": stub });
  applicationFit = await loadEdgeHandler("application-fit", { "https://esm.sh/@supabase/supabase-js@2": stub });
}, 60_000);

describe("the fit scorers' preflights", () => {
  it("job-fit answers its build", async () => {
    const res = await jobFit(new Request("https://h.supabase.co/functions/v1/job-fit", { method: "OPTIONS" }));
    const stamp = res.headers.get("x-fn-build");
    expect(buildIsAtLeast(stamp, "job-fit", "2026-10-09"), `job-fit preflight x-fn-build = ${stamp}`).toBe(true);
  });
  it("application-fit answers its build", async () => {
    const res = await applicationFit(new Request("https://h.supabase.co/functions/v1/application-fit", { method: "OPTIONS" }));
    const stamp = res.headers.get("x-fn-build");
    expect(buildIsAtLeast(stamp, "application-fit", "2026-10-09"), `application-fit preflight x-fn-build = ${stamp}`).toBe(true);
  });
});
