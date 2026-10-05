// @vitest-environment node
/**
 * THE WORKER'S HALF OF THE AGENTS-API REVIEW (2026-10-05), RUN.
 *
 *  - L9-22: the hosted worker is an ephemeral job that left a minute after an
 *    empty claim, so a worker woken for a packet still inside its cancel
 *    window found nothing and the packet waited for the next run, hours away.
 *    It now waits for the window the broker names (idle.ts).
 *  - L9-07: a question refusal now names, in `question_keys`, the learned key
 *    of every learnable question it could not answer, and counts the rest in
 *    `unlearnable` — the learned-answer trigger reads both to decide which
 *    packets an answer may send again.
 *  - 1.13: the partial-application guard counted placed boxes against boxes
 *    adapter.locate() FOUND, so a renamed email input dropped out of every
 *    count and the form went without an email. At the submitting step the
 *    worker now asks the adapter's own map whether the name and email it fills
 *    were placed — driven here through the real applyToPosting with a stand-in
 *    adapter whose email selector no longer matches.
 */
import { describe, expect, it, vi } from "vitest";
import type { VendorAdapter } from "../../worker/src/vendors/types.ts";

const state = vi.hoisted(() => ({ emailFound: false }));

vi.mock("../../worker/src/vendors/index.ts", () => {
  const box = { isVisible: async () => true, fill: async () => {}, setFile: async () => {} };
  const adapter = {
    key: "breezy",
    resolveFormUrl: async (_p: unknown, u: string) => u,
    locate: async (_p: unknown, key: string) => (key === "fullName" || (key === "email" && state.emailFound) ? box : null),
    locateResume: async () => null,
    proceed: async () => "submitted" as const,
    canProceed: async () => "would-submit" as const,
    unansweredRequired: async () => null,
    confirmed: async () => "yes" as const,
    requiredAttributeIsTrustworthy: false,
    mappedNames: new Set<string>(["cName", "cEmail", "cPhoneNumber"]),
    fieldKeys: new Set(["fullName", "email", "phone"]),
    enumerateQuestions: async () => [],
  };
  return { adapterFor: (s: string) => (s === "breezy" ? adapter : null), BLOCKED: {}, ADAPTERS: { breezy: adapter } };
});

import { applyToPosting } from "../../worker/src/apply.ts";
import { identityFields, unplacedCoreIdentity } from "../../worker/src/packet-fields.ts";
import { mayLeaveIdle, waitForNextClaimMs, WAIT_HORIZON_SECONDS } from "../../worker/src/idle.ts";
import { classifyRefusal, isTransientRefusal, questionRefusalKeys, refusalBlocker } from "../../worker/src/refusal.ts";
import { learnedKey } from "../../worker/src/questions/learned.ts";

function fakeBrowser() {
  const locator = () => ({ evaluateAll: async () => 0 });
  const page = {
    waitForTimeout: async () => {}, waitForLoadState: async () => {},
    textContent: async () => "Apply for this role", content: async () => "<form></form>",
    evaluate: async () => false, locator, url: () => "https://acme.breezy.hr/p/1/apply",
    screenshot: async () => Buffer.from(""),
  };
  const ctx = { newPage: async () => page, close: async () => {} };
  return { newContext: async () => ctx } as unknown as Parameters<typeof applyToPosting>[0];
}

describe("1.13 review — a form whose email box the adapter cannot find is never sent", () => {
  const input = () => ({
    applyUrl: "https://acme.breezy.hr/p/1", source: "breezy",
    fields: identityFields({ fullName: "Ana Diaz", email: "ana@example.com" }),
  });

  it("the email selector stopped matching: refused, with the key named — and never retried as if it were the network", async () => {
    state.emailFound = false;
    const out = await applyToPosting(fakeBrowser(), input());
    expect(out.kind).toBe("not-submitted");
    const reason = (out as { reason: string }).reason;
    expect(reason).toMatch(/never showed a box for email/);
    expect(isTransientRefusal(reason)).toBe(false);
    expect(classifyRefusal(reason)).toEqual({ stage: "partial-fill", wording: "missing: email" });
  });

  it("the positive control: with the box found, the same form is sent", async () => {
    state.emailFound = true;
    const out = await applyToPosting(fakeBrowser(), input());
    expect(out.kind).toBe("submitted");
  });

  it("counts only what this adapter maps and the candidate holds", () => {
    const fields = identityFields({ fullName: "Ana Diaz", email: "ana@example.com" });
    expect(unplacedCoreIdentity(new Set(["fullName", "email"]), fields, new Set(["fullName"]))).toEqual(["email"]);
    expect(unplacedCoreIdentity(new Set(["firstName", "lastName", "email"]), identityFields({ fullName: "Cher", email: "c@x.io" }), new Set(["firstName", "email"]))).toEqual([]);
    expect(unplacedCoreIdentity(undefined, fields, new Set())).toEqual([]);
  });
});

describe("L9-22 review — a started worker waits for the window the broker names", () => {
  it("waits for a hint inside the horizon, with a little slack; leaves on none, or one past the horizon", () => {
    expect(waitForNextClaimMs(240)).toBe(245_000);
    expect(waitForNextClaimMs(899.2)).toBe(905_000);
    expect(waitForNextClaimMs(null)).toBeNull();
    expect(waitForNextClaimMs(undefined)).toBeNull();
    expect(waitForNextClaimMs(0)).toBeNull();
    expect(waitForNextClaimMs(WAIT_HORIZON_SECONDS + 1)).toBeNull();
    expect(waitForNextClaimMs("nope")).toBeNull();
  });

  it("never leaves while it is waiting for a packet about to open; otherwise leaves once idle long enough", () => {
    const now = 1_000_000;
    expect(mayLeaveIdle(now, now - 120_000, 60_000, now + 30_000)).toBe(false);
    expect(mayLeaveIdle(now, now - 120_000, 60_000, now - 1)).toBe(true);
    expect(mayLeaveIdle(now, now - 120_000, 60_000, null)).toBe(true);
    expect(mayLeaveIdle(now, now - 30_000, 60_000, null)).toBe(false);
    expect(mayLeaveIdle(now, now - 999_999, 0, null)).toBe(false); // not configured to leave at all
  });

  it("the horizon is the database's: agent_work_pending names windows inside twenty minutes", () => {
    expect(WAIT_HORIZON_SECONDS).toBe(20 * 60);
  });
});

describe("L9-07 review — a question refusal says which answers would send the packet again", () => {
  const blocked = [
    { label: "Are you willing to travel? *", learnable: true, category: "unrecognised" },
    { label: "Date of birth", learnable: false, category: "date-of-birth" },
    { label: "Are you willing to travel?", learnable: true, category: "unrecognised" },
    { label: "***", learnable: true, category: "unrecognised" },
  ];

  it("keys each learnable question the way the pending question is filed, and counts the rest", () => {
    expect(questionRefusalKeys(blocked)).toEqual({ question_keys: [learnedKey("Are you willing to travel?")], unlearnable: 2 });
  });

  it("the blocker the worker writes carries them, and only for a question refusal", () => {
    const b = refusalBlocker("2 required question(s) the agent cannot answer — unrecognised: no answer", "breezy", blocked);
    expect(b.stage).toBe("question-unanswerable");
    expect(b.question_keys).toEqual(["are you willing to travel"]);
    expect(b.unlearnable).toBe(2);
    expect(b.kind).toBe("worker");
    const other = refusalBlocker("posting is closed", "breezy", blocked);
    expect(other).not.toHaveProperty("question_keys");
  });
});
