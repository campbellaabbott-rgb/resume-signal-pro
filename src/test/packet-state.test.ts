/**
 * The two terminal states that rendered as healthy ones.
 *
 * `agent_claim_submission` stops handing a packet to workers at `attempts < 3`
 * — correct, because a form we cannot drive is a bug to fix rather than a thing
 * to keep hammering at an employer. But nothing read the state that cap
 * creates. No edge function touches `attempts`; ApplyQueuePanel never selected
 * it. So a packet that had permanently stopped sat at status='ready' with an
 * empty release_refusal and rendered as "Ready — nothing needs you", in green,
 * indefinitely.
 *
 * That is worse than silence. It is a positive claim that everything is fine
 * about an application that will never be sent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  packetState, needsAttention, MAX_ATTEMPTS, UNCERTAIN_ATTEMPTS, type PacketLike,
} from "@/lib/packetState";

const base: PacketLike = {
  status: "ready", attempts: 0, submitted_at: null,
  released_at: "2026-08-02T06:00:00Z", claimed_at: null, release_refusal: "", blockers: [],
};

describe("MAX_ATTEMPTS mirrors the SQL", () => {
  // A cross-runtime constant that drifts is how a UI starts describing a rule
  // the database no longer enforces. Read the cap out of the migration itself.
  it("matches the attempts cap in agent_claim_submission", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const sql = readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(resolve(dir, f), "utf8"))
      .filter((s) => s.includes("agent_claim_submission"));
    expect(sql.length, "no migration defines agent_claim_submission").toBeGreaterThan(0);
    const caps = new Set(sql.flatMap((s) => [...s.matchAll(/attempts\s*<\s*(\d+)/g)].map((m) => Number(m[1]))));
    expect(caps.size, `migrations disagree on the cap: ${[...caps]}`).toBe(1);
    expect([...caps][0], "MAX_ATTEMPTS has drifted from the SQL").toBe(MAX_ATTEMPTS);
  });
});

describe("exhausted — the state that read as Ready", () => {
  const v = packetState({ ...base, attempts: MAX_ATTEMPTS });

  it("is named, not rendered as ready", () => {
    expect(v.phase).toBe("exhausted");
    expect(v.fallback).toMatch(/Nothing was sent/i);
  });

  it("says plainly that nothing was sent", () => {
    // The candidate's first question is "did it go?", and the answer is no.
    expect(v.fallback.toLowerCase()).toContain("nothing was sent");
  });

  it("is worth interrupting someone over", () => {
    expect(needsAttention(v)).toBe(true);
  });

  it("offers a retry", () => {
    expect(v.canRetry).toBe(true);
  });

  it("does not trigger one attempt early", () => {
    expect(packetState({ ...base, attempts: MAX_ATTEMPTS - 1 }).phase).toBe("ready");
  });
});

describe("uncertain — never retried, and that is the point", () => {
  const byBlocker = packetState({
    ...base, attempts: 1,
    blockers: [{ kind: "uncertain-submit", detail: "timeout after submit" }],
  });
  const byAttempts = packetState({ ...base, attempts: UNCERTAIN_ATTEMPTS });

  it("is detected from the blocker the RPC writes", () => {
    expect(byBlocker.phase).toBe("uncertain");
  });

  it("is also detected from the attempts=99 park value", () => {
    expect(byAttempts.phase).toBe("uncertain");
  });

  it("REFUSES a retry — retrying could apply someone twice", () => {
    // The single most important assertion in this file. A retry here risks a
    // duplicate application to a real employer in a real person's name.
    expect(byBlocker.canRetry).toBe(false);
    expect(byAttempts.canRetry).toBe(false);
    expect(byBlocker.fallback).toMatch(/twice/i);
  });

  it("outranks exhausted when both could apply", () => {
    const both = packetState({
      ...base, attempts: UNCERTAIN_ATTEMPTS,
      blockers: [{ kind: "uncertain-submit", detail: "x" }],
    });
    expect(both.phase).toBe("uncertain");
    expect(both.canRetry).toBe(false);
  });
});

describe("sent outranks everything", () => {
  it("a submitted packet is never exhausted or retryable", () => {
    const v = packetState({ ...base, attempts: 99, submitted_at: "2026-08-02T07:00:00Z" });
    expect(v.phase).toBe("sent");
    expect(v.canRetry).toBe(false);
  });
});

describe("the ordinary states still work", () => {
  it("in-flight while a worker holds a fresh lease", () => {
    expect(packetState({ ...base, claimed_at: new Date().toISOString() }).phase).toBe("in-flight");
  });

  it("a STALE lease is not in-flight — the worker died", () => {
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(packetState({ ...base, claimed_at: old }).phase).toBe("ready");
  });

  it("held when decideRelease refused it", () => {
    expect(packetState({ ...base, release_refusal: "sender-offline" }).phase).toBe("held");
  });

  it("neither held nor exhausted is worth a badge", () => {
    expect(needsAttention(packetState({ ...base, release_refusal: "daily-cap" }))).toBe(false);
    expect(needsAttention(packetState(base))).toBe(false);
  });

  it("treats a missing attempts column as zero rather than NaN", () => {
    expect(packetState({ status: "ready" }).phase).toBe("ready");
    expect(packetState({ status: "ready" }).attempts).toBe(0);
  });
});

describe("the panel wires it, and the retry cannot revive a sent packet", () => {
  const panel = readFileSync(
    resolve(__dirname, "../components/account/ApplyQueuePanel.tsx"), "utf8");

  it("selects attempts — without the column the state is invisible", () => {
    expect(panel).toContain("attempts,claimed_at,released_at");
    expect(panel).toContain("packetState");
  });

  it("guards the retry against an already-sent packet", () => {
    // Belt and braces with packetState.canRetry: even a UI bug must not be able
    // to re-queue something that already went to an employer.
    expect(panel).toMatch(/\.is\("submitted_at", null\)/);
    expect(panel).toMatch(/attempts: 0/);
  });

  it("only shows the retry when canRetry says so", () => {
    expect(panel).toContain("st.canRetry");
  });
});
