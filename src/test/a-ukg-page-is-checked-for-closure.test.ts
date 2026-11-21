// @vitest-environment node
/**
 * A UKG PAGE IS CHECKED FOR CLOSURE (SEO audit 2026-11-18, STRUCTURED-B14).
 *
 * UKG postings were read for their stated date only: what a closed
 * opportunity's page serves had not been measured, so a UKG page kept index,
 * follow and JobPosting until the board itself dropped the row, and the daily
 * check never asked. Measured 2026-11-21 (robots.txt allows the JobBoard
 * paths; one request at a time): the opportunity page's own script says
 * "OpportunityIsClosed":true on Ollie's 7dd954be, gone from the board since
 * 2026-11-06, and false on five open ones; three other pages gone from the
 * board served the job board shell without the opportunity, which stays
 * unknown. The fixtures are those pages, trimmed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as reads from "../../scripts/employer-reads.mjs";

const FIX = resolve(__dirname, "fixtures/employer-reads");
const page = (name: string) => readFileSync(resolve(FIX, name), "utf8");
const R = reads as unknown as {
  READ_VENDORS: readonly string[];
  STATED_ONLY_VENDORS: readonly string[];
  employerReadPlan: (row: unknown) => { url: string | null; kind?: string; statedOnly?: boolean };
  readEmployers: (rows: unknown[], o: unknown) => Promise<Map<string, { state: string; why: string; stated: Record<string, unknown> }>>;
};

const ukg = (host: string, client: string, board: string, opp: string) => ({
  id: `ukg:${host}~${client}~${board}:${opp}`,
  applyUrl: `https://${host}.ultipro.com/${client}/JobBoard/${board}/OpportunityDetail?opportunityId=${opp}`,
});
const OPEN = ukg("recruiting", "REG1000REGAL", "1bbca4e6-7b2d-4f4f-bb34-681fc9385364", "dd775738-7b97-4c89-b299-7c8ed30344ba");
const CLOSED = ukg("recruiting", "OLL1000OLLIE", "355913c1-206d-48a4-bb34-020064efe845", "7dd954be-24da-4c3c-b7ab-de2a8283e790");
const MISSING = ukg("recruiting2", "PRO1044PCCA", "eb0e667e-d9a7-4107-9d03-1a3c9e8fd34e", "38063fc0-9208-45bb-bdd3-a34df660be79");

const served = (byUrl: Record<string, [number, string]>) => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    const [status, body] = byUrl[url] ?? [404, ""];
    return { status, url, text: async () => body, headers: { get: () => null } };
  };
  return { asked, fetchImpl };
};
const readOne = async (row: { id: string; applyUrl: string }, status: number, body: string) => {
  const f = served({ [row.applyUrl]: [status, body] });
  const out = await R.readEmployers([row], { fetchImpl: f.fetchImpl, retryDelayMs: 1, budgetMs: 10_000 });
  return { result: out.get(row.id)!, asked: f.asked };
};

describe("the UKG opportunity page answers open or closed", () => {
  it("is read for its state, not for its statements alone", () => {
    expect(R.READ_VENDORS).toContain("ukg");
    expect(R.STATED_ONLY_VENDORS).not.toContain("ukg");
    expect(R.employerReadPlan(OPEN)).toMatchObject({ kind: "ukg", url: OPEN.applyUrl });
    expect(R.employerReadPlan(OPEN).statedOnly).toBeFalsy();
  });

  it("an opportunity whose own script says it is closed is closed", async () => {
    const { result, asked } = await readOne(CLOSED, 200, page("ukg-opportunity-closed.html"));
    expect(asked).toEqual([CLOSED.applyUrl]);
    expect(result).toMatchObject({ state: "closed", why: "UKG says the opportunity is closed" });
  });

  it("an open one is open, with its posting date", async () => {
    const { result } = await readOne(OPEN, 200, page("ukg-opportunity-open.html"));
    expect(result).toMatchObject({ state: "open", stated: { postedAt: "2026-10-31T19:05:01.557Z" } });
  });

  it("the job board shell without the opportunity, another opportunity, or a failed answer stays unknown", async () => {
    expect((await readOne(MISSING, 200, page("ukg-opportunity-missing.html"))).result).toMatchObject({ state: "unknown", why: "200 without the opportunity" });
    expect((await readOne({ ...CLOSED, id: CLOSED.id.replace("7dd954be", "00000000") }, 200, page("ukg-opportunity-closed.html"))).result.state).toBe("unknown");
    expect((await readOne(CLOSED, 503, "")).result.state).toBe("unknown");
    const noField = page("ukg-opportunity-closed.html").replace(/"OpportunityIsClosed":true,?/, "");
    expect((await readOne(CLOSED, 200, noField)).result).toMatchObject({ state: "unknown", why: "200 without OpportunityIsClosed" });
  });
});
