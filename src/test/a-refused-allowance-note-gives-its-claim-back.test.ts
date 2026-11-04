// @vitest-environment node
/**
 * A REFUSED ALLOWANCE NOTE GIVES ITS CLAIM BACK (audit-rest S13-040; agent-mcp
 * 2026-11-03.1).
 *
 * WHAT WAS WRONG. agent-mcp claims the day's 50% alert for a keyless share
 * (mcp_allowance_alert_claim, true exactly once per share per UTC day) and then
 * posts it to notify-owner. It kept the claim whatever notify-owner did, so a
 * day whose note was refused, rate-capped or never arrived stayed silent. The
 * notify-owner half (the-keyless-allowance-alert-reaches-the-owner.test.ts) is
 * why a real note can now be mailed.
 *
 * WHAT HOLDS NOW. A claim stands only for a note notify-owner says it mailed.
 * 200 is not that proof: a rate-capped door answers 200 {skipped}. Anything else
 * deletes the claim's row and the isolate asks again after ten minutes, so a
 * down mailer is not asked on every keyless call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, QUIET_METER, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const TEN_MINUTES = 10 * 60_000;
const today = () => new Date().toISOString().slice(0, 10);
let mcp: KeylessMcp;
let realNow: () => number;
let offset = 0;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mcp = await bootKeylessMcp();
  // Only the overall row is past half, so one share alerts per call.
  mcp.meter = { ...QUIET_METER, overall_used: 10_000, overall_cap: 20_000 };
  mcp.answers.mcp_allowance_alert_claim = { data: true, error: null };
  realNow = Date.now;
  offset = 0;
  Date.now = () => realNow() + offset;
});
afterEach(() => { Date.now = realNow; vi.restoreAllMocks(); });

const claims = () => mcp.rpcs.filter((r) => r.name === "mcp_allowance_alert_claim");
const oneCall = async () => {
  const r = await mcp.call({ query: "nurse" });
  expect(r.isError, r.text).toBe(false);
  await new Promise((done) => setTimeout(done, 30));
};
const givenBack = [{ table: "mcp_allowance_alerts", eq: { day: today(), share: "global" } }];

describe("a note that was not mailed", () => {
  const FAILS: Array<[string, () => Response | Promise<Response>]> = [
    ["notify-owner refuses it", () => new Response(JSON.stringify({ error: "unrecognized payload" }), { status: 400 })],
    ["the door is rate-capped and answers 200", () => new Response(JSON.stringify({ skipped: "rate-capped" }), { status: 200 })],
    ["the send fails", () => new Response(JSON.stringify({ error: "provider refused" }), { status: 502 })],
    ["the call never arrives", () => { throw new TypeError("fetch failed"); }],
    ["the answer is not JSON", () => new Response("<html>gateway</html>", { status: 200 })],
  ];

  for (const [name, notifyOwner] of FAILS) {
    it(`gives the claim back when ${name}`, async () => {
      mcp.notifyOwner = notifyOwner;
      await oneCall();
      expect(mcp.notes).toEqual([{ type: "allowance", share: "global", used: 10_000, cap: 20_000 }]);
      expect(mcp.deletes).toEqual(givenBack);
    });
  }

  it("is asked for again after ten minutes, not on the next call, and a later success stands", async () => {
    mcp.notifyOwner = () => new Response("{}", { status: 503 });
    await oneCall();
    await oneCall();
    expect(claims(), "a down mailer was asked on the very next call").toHaveLength(1);
    expect(mcp.notes).toHaveLength(1);

    offset = TEN_MINUTES + 1_000;
    mcp.notifyOwner = () => new Response(JSON.stringify({ success: true, kind: "allowance" }), { status: 200 });
    await oneCall();
    expect(claims()).toHaveLength(2);
    expect(mcp.notes).toHaveLength(2);
    expect(mcp.deletes, "the claim that was mailed stays").toHaveLength(1);

    offset += TEN_MINUTES * 2;
    await oneCall();
    expect(claims(), "a note that was mailed is not sent twice").toHaveLength(2);
    expect(mcp.notes).toHaveLength(2);
  });
});

describe("a claim this isolate does not hold", () => {
  it("a note that was mailed keeps its claim and is not asked for again that day", async () => {
    await oneCall();
    expect(mcp.notes).toHaveLength(1);
    expect(mcp.deletes).toEqual([]);
    offset = TEN_MINUTES * 3;
    await oneCall();
    expect(claims()).toHaveLength(1);
  });

  it("another isolate's claim sends nothing, deletes nothing and is not asked for again", async () => {
    mcp.answers.mcp_allowance_alert_claim = { data: false, error: null };
    await oneCall();
    expect(mcp.notes).toEqual([]);
    expect(mcp.deletes).toEqual([]);
    offset = TEN_MINUTES * 3;
    await oneCall();
    expect(claims()).toHaveLength(1);
  });

  it("a claim the database could not answer sends nothing, deletes nothing and is asked for again later", async () => {
    mcp.answers.mcp_allowance_alert_claim = { data: null, error: { message: "timeout" } };
    await oneCall();
    expect(mcp.notes).toEqual([]);
    expect(mcp.deletes).toEqual([]);
    offset = TEN_MINUTES + 1_000;
    await oneCall();
    expect(claims()).toHaveLength(2);
  });
});

describe("the answer the person gets", () => {
  it("never waits on the note: a mailer that hangs does not hold the search", async () => {
    mcp.notifyOwner = () => new Promise(() => {});
    const r = await mcp.call({ query: "nurse" });
    expect(r.isError, r.text).toBe(false);
    expect(mcp.boardCalls).toHaveLength(1);
  });
});
