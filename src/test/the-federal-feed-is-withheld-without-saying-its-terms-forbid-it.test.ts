// @vitest-environment node
/**
 * THE FEDERAL FEED WAS WITHHELD WITHOUT SAYING ITS TERMS FORBID IT
 * (USAJOBS-COPY-2), AND SINCE OD16 IT IS ANSWERED.
 *
 * /v1 told every caller, in its 451 answer and in the reason it repeats on
 * five surfaces, that the federal job feed's "terms of use forbid
 * redistributing it as a data feed". The terms read on 2026-11-16 say the
 * feed's Public Data may be redistributed. USAJOBS-COPY-2 took the false
 * reason out; OD16 (owner 2026-11-18: yes) hands the labelled federal rows
 * on. What this file still holds: no refusal /v1 makes claims a feed's terms
 * forbid it, the one system still refused (SmartRecruiters) is refused with a
 * 451, and the federal feed is answered, not refused.
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

describe("the refusals /v1 makes, as shipped", () => {
  it("SmartRecruiters is still a 451, and its message claims nothing about anyone's terms", async () => {
    const r = await callApi(handler, "/v1/jobs?source=smartrecruiters");
    expect(r.status).toBe(451);
    const e = r.body.error as { code: string; message: string };
    expect(e.code).toBe("source_not_redistributable");
    expect(e.message).not.toMatch(CLAIMS_TERMS);
    expect(e.message).toMatch(/not available through this API/);
    expect(e.message).not.toMatch(/federal|usajobs/i);
  });

  it("the federal feed is answered, not refused (OD16)", async () => {
    const r = await callApi(handler, "/v1/jobs?source=usajobs");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it("the reason the index and every list repeat names SmartRecruiters alone and claims nothing about terms", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/public-api/v1"));
    const body = await res.json() as { restrictions: { excludedSources: string[]; reason: string } };
    expect(body.restrictions.excludedSources).toEqual(["smartrecruiters"]);
    expect(body.restrictions.reason).not.toMatch(CLAIMS_TERMS);
    expect(body.restrictions.reason).toMatch(/not available through this API/);
    expect(body.restrictions.reason).not.toMatch(/federal|usajobs/i);
  });
});
