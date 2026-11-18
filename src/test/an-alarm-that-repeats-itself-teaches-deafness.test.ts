/**
 * 48 IDENTICAL EMAILS A DAY IS NOT AN ALERT, IT IS A MUTE BUTTON.
 *
 * scan-heartbeat runs on a 10-minute cron and emailed on every non-healthy
 * run, gated only by a 2/hour rate cap. A PERSISTENT degraded state — a slow
 * census digestion, a week of a miscalibrated SLA — therefore meant two
 * identical emails an hour, forever. The user said it plainly: "I'm
 * constantly getting these alerts." An inbox trained that way stops reading,
 * and the one email that matters drowns in copies of itself.
 *
 * The gate is the FAILING SET, not the clock: a durable fingerprint (status +
 * sorted failing check names) in job_board_meta. Mail when it changes for the
 * worse, remind rarely while it persists, send ONE recovery note when an
 * announced incident clears, and keep the rate cap only as a backstop.
 *
 * And the opposite failure (bug round 2026-11-08, S14X-018 and S14X-045): a
 * rule that keeps quiet must not keep quiet about an outage. Down is reminded
 * every two hours with how long; leaving down is said; the cooldown ends with
 * its incident, so a recovery note no longer silences the next failure; and a
 * recovery note goes out only for an incident the owner was told of.
 *
 * The rules are one pure function, watch.ts decideHeartbeatMail, judged here
 * case by case; the end-to-end runs are in
 * a-heartbeat-that-stays-down-keeps-saying-so-and-says-when-it-eases.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideHeartbeatMail, heartbeatMailWords, spanText,
  DEGRADED_COOLDOWN_MS, DOWN_REMIND_MS, REMIND_MS, type AlertState,
} from "../../supabase/functions/scan-heartbeat/watch";

const HB = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
const CODE = HB.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const T0 = Date.parse("2026-11-12T00:00:00Z");
const MIN = 60_000;
const at = (min: number) => new Date(T0 + min * MIN).toISOString();
/** The state after a mail at minute `min` about `status|checks`. */
const sentAt = (min: number, status: string, checks: string[], extra: Partial<AlertState> = {}): AlertState => ({
  fingerprint: `${status}|${[...checks].sort().join(",")}`,
  lastAlertAt: at(min),
  alerted: Object.fromEntries(checks.map((c) => [c, at(min)])),
  ...extra,
});
const decide = (prev: unknown, status: string, checks: string[], min: number) => decideHeartbeatMail(prev, status, checks, T0 + min * MIN);

describe("the heartbeat mails on change, not on schedule", () => {
  it("the first failure is mailed and the failing set is fingerprinted", () => {
    const d = decide(null, "degraded", ["job_board_storage", "e2e_scan"], 0);
    expect(d.kind).toBe("alert");
    expect(d.next).toMatchObject({ fingerprint: "degraded|e2e_scan,job_board_storage", lastAlertAt: at(0) });
    expect(Object.keys(d.next!.alerted!).sort()).toEqual(["e2e_scan", "job_board_storage"]);
  });

  it("the same set an hour later is quiet, and keeps its stamps and its cooldown anchor", () => {
    const d = decide(sentAt(0, "degraded", ["a"]), "degraded", ["a"], 60);
    expect(d.kind).toBeNull();
    expect(d.next).toEqual({ fingerprint: "degraded|a", alerted: { a: at(0) }, lastAlertAt: at(0) });
  });

  it("a shrink is never news", () => {
    expect(decide(sentAt(0, "degraded", ["a", "b"]), "degraded", ["a"], 300).kind).toBeNull();
  });

  it("a new check inside the four-hour cooldown waits, and is mailed once the cooldown is over if it still fails", () => {
    const held = decide(sentAt(0, "degraded", ["a"]), "degraded", ["a", "b"], 60);
    expect(held.kind).toBeNull();
    expect(held.next!.alerted, "a news slot is spent only by a mail that went out").toEqual({ a: at(0) });
    const later = decide(held.next, "degraded", ["a", "b"], DEGRADED_COOLDOWN_MS / MIN);
    expect(later.kind).toBe("alert");
    expect(later.next!.alerted).toEqual({ a: at(240), b: at(240) });
  });

  it("the same degraded set is reminded once a day, not before", () => {
    expect(decide(sentAt(0, "degraded", ["a"]), "degraded", ["a"], REMIND_MS / MIN - 10).kind).toBeNull();
    expect(decide(sentAt(0, "degraded", ["a"]), "degraded", ["a"], REMIND_MS / MIN).kind).not.toBeNull();
  });
});

describe("down is never quiet for long (S14X-018)", () => {
  it("going down always mails, past the cooldown, and remembers since when", () => {
    const d = decide(sentAt(0, "degraded", ["a"]), "down", ["a"], 10);
    expect(d.kind).toBe("alert");
    expect(d.next!.downSince).toBe(at(10));
  });

  it("still down after two hours: a reminder saying since when and for how long", () => {
    const down = sentAt(0, "down", ["e2e_scan"], { downSince: at(0) });
    expect(decide(down, "down", ["e2e_scan"], DOWN_REMIND_MS / MIN - 10).kind).toBeNull();
    const d = decide(down, "down", ["e2e_scan"], DOWN_REMIND_MS / MIN);
    expect(d.kind).toBe("down-reminder");
    expect(d.downSince).toBe(at(0));
    expect(d.downForMin).toBe(120);
    expect(d.next).toMatchObject({ lastAlertAt: at(120), downSince: at(0) });
    expect(heartbeatMailWords(d, "down", ["e2e_scan"]).subject).toBe("🔴 Heartbeat DOWN since 00:00 UTC (about 2 h): e2e_scan");
    // The next reminder counts from this one.
    expect(decide(d.next, "down", ["e2e_scan"], 180).kind).toBeNull();
    expect(decide(d.next, "down", ["e2e_scan"], 240).kind).toBe("down-reminder");
  });

  it("down to degraded is one 'no longer down' note, past the cooldown, naming what still fails; down to healthy is the recovery note", () => {
    const down = sentAt(0, "down", ["e2e_scan", "job_board_storage"], { downSince: at(0) });
    const eased = decide(down, "degraded", ["job_board_storage"], 30);
    expect(eased.kind).toBe("eased");
    expect(eased.next).not.toHaveProperty("downSince");
    expect(heartbeatMailWords(eased, "degraded", ["job_board_storage"]).subject).toBe("🟡 Heartbeat no longer down (still DEGRADED: storage)");
    expect(decide(eased.next, "degraded", ["job_board_storage"], 40).kind, "the note is said once").toBeNull();
    expect(decide(down, "healthy", [], 30).kind).toBe("recovered");
  });
});

describe("a cooldown ends with its incident (S14X-045)", () => {
  it("a healthy run clears the cooldown anchor and the stamps, so the next failure is mailed at once", () => {
    const rec = decide(sentAt(0, "down", ["ai_gateway"], { downSince: at(0) }), "healthy", [], 10);
    expect(rec.kind).toBe("recovered");
    expect(rec.next).toEqual({ fingerprint: "healthy" });
    expect(decide(rec.next, "degraded", ["job_board_storage"], 30).kind).toBe("alert");
  });

  it("a recovery note goes out only for an incident that was announced", () => {
    const silent = decide({ fingerprint: "healthy" }, "degraded", ["a"], 0);
    // Held back (the backstop refused it, or the send was refused): nothing was stamped.
    const unannounced: AlertState = { fingerprint: "degraded|a", alerted: {} };
    const cleared = decide(unannounced, "healthy", [], 10);
    expect(silent.kind).toBe("alert");
    expect(cleared.kind).toBeNull();
    expect(cleared.next, "the state still clears").toEqual({ fingerprint: "healthy" });
    expect(decide({ fingerprint: "healthy" }, "healthy", [], 10)).toMatchObject({ kind: null, next: null });
  });

  it("reads a row an older build wrote (lastSentAt, no lastAlertAt) as that build meant it", () => {
    const legacy = { fingerprint: "degraded|a", lastSentAt: at(0), alerted: { a: at(0) } };
    expect(decide(legacy, "degraded", ["a", "b"], 60).kind, "inside the old alert's cooldown").toBeNull();
    expect(decide(legacy, "degraded", ["a", "b"], 241).kind).toBe("alert");
    expect(decide(legacy, "healthy", [], 30).kind).toBe("recovered");
    // The old recovery stamp is not a cooldown: a row whose stamps were cleared was never announced.
    const afterOldRecovery = { fingerprint: "healthy", lastSentAt: at(0) };
    expect(decide(afterOldRecovery, "degraded", ["stripe_credentials"], 20).kind).toBe("alert");
  });

  it("a malformed row is a first failure, never a reason to keep quiet", () => {
    for (const bad of [null, "x", 7, [], { fingerprint: 3 }, { fingerprint: "degraded|a", alerted: "x" }]) {
      expect(decide(bad, "degraded", ["a"], 0).kind, JSON.stringify(bad)).toBe("alert");
    }
  });
});

describe("the words", () => {
  it("say a span the way a person reads it", () => {
    expect(spanText(25)).toBe("25 min");
    expect(spanText(130)).toBe("about 2 h");
    expect(spanText(60 * 72)).toBe("about 3 days");
  });
});

describe("the sender keeps its backstops", () => {
  it("keeps the 2/hour rate cap as a flap backstop, after the state is read", () => {
    const st = CODE.indexOf("decideHeartbeatMail(");
    const cap = CODE.indexOf("'alert:heartbeat'");
    expect(st, "the decision is not asked").toBeGreaterThan(-1);
    expect(cap, "the 2/hour backstop is gone").toBeGreaterThan(-1);
    expect(st).toBeLessThan(cap);
  });

  it("a state that cannot be read falls through to sending: both reads sit in try blocks that continue to the send", () => {
    const block = CODE.slice(CODE.indexOf("async function sendHeartbeatMail"), CODE.indexOf("const words = heartbeatMailWords"));
    expect((block.match(/catch \(_e\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("every run asks, healthy or not, and the fatal path asks as down", () => {
    expect(CODE).toMatch(/EdgeRuntime\.waitUntil\(sendHeartbeatMail\(overallStatus, errorMessage, checks, totalTime\)\)/);
    expect(CODE).toMatch(/EdgeRuntime\.waitUntil\(sendHeartbeatMail\('down',/);
  });
});
