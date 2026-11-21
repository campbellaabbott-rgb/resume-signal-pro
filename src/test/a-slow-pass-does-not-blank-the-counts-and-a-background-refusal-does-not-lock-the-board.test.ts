// A SLOW PASS DOES NOT BLANK THE COUNTS, AND A BACKGROUND REFUSAL DOES NOT
// LOCK THE BOARD (S10-163, S10-164). Both dormant today (no site key is set in
// production, so no board call waits for a pass), both live the day one is.
//
// WHAT WAS WRONG.
//   S10-163: readBoardFacets raced its six-second deadline against
//     invokeJobBoard, and with a board pass in use that call first waits for
//     the browser check, which has a ten-second deadline of its own. A check
//     that took seven seconds returned null and blanked every count on the
//     page although the board had not been asked yet.
//   S10-164: after its one fresh-pass retry, a second "pass" refusal went
//     into the page-wide store with no reset time, where it "stands until the
//     page is reloaded": every board call stopped, and Reload was the only
//     advice. Any call could put it there, a facet read or a badge count
//     nobody was waiting on among them, and lock out the list the reader was.
//
// WHAT HOLDS NOW:
//   - the facet deadline times the board's answer, from when the request can
//     go: a pass that settles after the deadline still gets its counts, and a
//     board that does not answer in time is still cut off (control);
//   - a "pass" refusal met by a background call (a facet read here) is that
//     call's failure and is not recorded; an allowance refusal is, whoever
//     meets it (control);
//   - a "pass" refusal the page's own read meets keeps its cause, and a
//     reader's Retry lifts it (liftBoardPassRefusal) after asking for a new
//     check past the cooldown (requestFreshBoardPass); an allowance refusal
//     is never lifted by a click.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

// The browser check, as slow as each case makes it. The board pass module's
// own behaviour is held in the-board-pass-rides-every-board-call; here it is
// only a clock.
let passAt: Promise<string | null> = Promise.resolve("pass-1");
const ensure = vi.fn((_o?: { fresh?: boolean; refused?: string | null }) => passAt);
let held: string | null = "pass-1";
vi.mock("@/lib/board-pass", () => ({
  BOARD_PASS_HEADER: "x-rb-pass",
  boardPassEnabled: () => true,
  ensureBoardPass: (o?: { fresh?: boolean; refused?: string | null }) => ensure(o),
  heldBoardPass: () => held,
  forgetBoardPass: () => {},
}));

import { readBoardFacets } from "@/lib/board-facets";
import * as Budget from "@/lib/board-budget";
import * as Door from "@/lib/invoke-job-board";
import { boardBudgetRefusal, clearBoardBudgetRefusal, markBoardBudgetRefused } from "@/lib/board-budget";

const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const FACETS = { categories: { technology: 120, healthcare: 80 }, refreshedAt: "2026-11-21T10:00:00Z", sources: {}, sourcesAt: null };
const refusal = (code: string, resetAt: string | null) => ({
  data: null,
  error: {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify({ error: "board_budget", code, limit: code === "pass" ? 0 : 200, used: 0, resetAt }), { status: 429, headers: { "Content-Type": "application/json" } }),
  },
});
const tomorrow = () => new Date(Date.now() + 6 * 3600_000).toISOString();

beforeEach(() => {
  invoke.mockReset();
  ensure.mockClear();
  passAt = Promise.resolve("pass-1");
  held = "pass-1";
  clearBoardBudgetRefusal();
});
afterEach(() => clearBoardBudgetRefusal());

describe("the facet deadline times the board, not the browser check (S10-163)", () => {
  it("a pass that settles after the deadline still gets the counts", async () => {
    passAt = later(160, "pass-1");
    invoke.mockImplementation(async () => ({ data: FACETS, error: null }));
    const got = await readBoardFacets(60);
    expect(got, "a slow browser check blanked every count before the board was asked").not.toBeNull();
    expect(got?.categories).toEqual({ technology: 120, healthcare: 80 });
    // The read went out carrying the pass it waited for.
    expect((invoke.mock.calls[0][1] as { headers?: Record<string, string> }).headers?.["x-rb-pass"]).toBe("pass-1");
  });

  it("control: a board that does not answer inside the deadline is still cut off", async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    expect(await readBoardFacets(60)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("a background call's pass refusal stays its own (S10-164)", () => {
  it("a facet read refused for its pass does not pause the board", async () => {
    invoke.mockImplementation(async () => refusal("pass", null));
    expect(await readBoardFacets(500)).toBeNull();
    expect(boardBudgetRefusal(), "a count nobody was waiting on locked every board call until a reload").toBeNull();
  });

  it("control: a facet read refused for the allowance still records it, since every call would be refused", async () => {
    const reset = tomorrow();
    invoke.mockImplementation(async () => refusal("address", reset));
    expect(await readBoardFacets(500)).toBeNull();
    expect(boardBudgetRefusal()).toMatchObject({ code: "address", resetAt: reset });
  });

  it("the store itself: a background pass refusal is not recorded, a background allowance refusal is", () => {
    markBoardBudgetRefused({ code: "pass", limit: null, resetAt: null }, { background: true });
    expect(boardBudgetRefusal()).toBeNull();
    markBoardBudgetRefused({ code: "country", limit: 500, resetAt: tomorrow() }, { background: true });
    expect(boardBudgetRefusal()?.code).toBe("country");
  });
});

describe("the page's own pass refusal keeps its cause and offers a Retry (S10-164)", () => {
  it("is recorded with code pass, and a Retry lifts it", () => {
    markBoardBudgetRefused({ code: "pass", limit: 0, resetAt: null });
    expect(boardBudgetRefusal()).toMatchObject({ code: "pass", resetAt: null });
    const lift = (Budget as unknown as { liftBoardPassRefusal?: () => boolean }).liftBoardPassRefusal;
    expect(typeof lift, "nothing but a reload could lift a pass refusal").toBe("function");
    expect(lift!()).toBe(true);
    expect(boardBudgetRefusal()).toBeNull();
    expect(lift!(), "nothing was standing").toBe(false);
  });

  it("control: an allowance refusal is never lifted by a click", () => {
    const reset = tomorrow();
    markBoardBudgetRefused({ code: "address", limit: 200, resetAt: reset });
    const lift = (Budget as unknown as { liftBoardPassRefusal?: () => boolean }).liftBoardPassRefusal;
    expect(lift?.()).toBe(false);
    expect(boardBudgetRefusal()).toMatchObject({ code: "address", resetAt: reset });
  });

  it("the Retry asks for a new check past the cooldown, naming the pass it replaces", async () => {
    const fresh = (Door as unknown as { requestFreshBoardPass?: () => Promise<string | null> }).requestFreshBoardPass;
    expect(typeof fresh, "the page had no way to ask for a new browser check").toBe("function");
    passAt = Promise.resolve("pass-2");
    expect(await fresh!()).toBe("pass-2");
    expect(ensure).toHaveBeenLastCalledWith({ fresh: true, refused: "pass-1" });
    // With none held it still starts a new attempt: "" is a refused call
    // that carried no pass but was asked for by a person, not the null that
    // the cooldown holds back.
    held = null;
    await fresh!();
    expect(ensure).toHaveBeenLastCalledWith({ fresh: true, refused: "" });
  });
});
