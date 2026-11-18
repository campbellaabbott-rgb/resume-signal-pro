// @vitest-environment node
/**
 * THE FEDERAL FEED IS WITHHELD WITHOUT SAYING ITS TERMS FORBID IT
 * (USAJOBS-COPY-2).
 *
 * /v1 told every caller, in its 451 answer and in the reason it repeats on
 * five surfaces, that the federal job feed's "terms of use forbid
 * redistributing it as a data feed". The terms read on 2026-11-16 say the
 * feed's Public Data may be redistributed. The API still withholds those rows
 * (the owner's decision); it no longer gives a reason the terms do not.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CLAIMS_TERMS = /terms[^.]*(forbid|prohibit|do not permit|bar)|forbid[^.]*redistribut/i;

let handler: EdgeHandler;
beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
  useDb(db);
}, 120_000);

describe("the federal feed's refusal, as shipped", () => {
  it("is still a 451, and its message claims nothing about the feed's terms", async () => {
    const r = await callApi(handler, "/v1/jobs?source=usajobs");
    expect(r.status).toBe(451);
    const e = r.body.error as { code: string; message: string };
    expect(e.code).toBe("source_not_redistributable");
    expect(e.message).not.toMatch(CLAIMS_TERMS);
    // The live verifier's reading of this refusal (verify-deploy.sh, /v1 source=usajobs).
    expect(e.message).toMatch(/terms|not available|cannot be redistributed|unsupported source/);
  });

  it("the reason the index and every list repeat claims nothing about the terms either", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/public-api/v1"));
    const body = await res.json() as { restrictions: { excludedSources: string[]; reason: string } };
    expect(body.restrictions.excludedSources).toContain("usajobs");
    expect(body.restrictions.reason).not.toMatch(CLAIMS_TERMS);
    expect(body.restrictions.reason).toMatch(/not available through this API/);
  });
});
