/**
 * THE FIRST APPLICATION YOU DID NOT SEE, AND THE ONE YOU WANT BACK.
 *
 * Everything the agent does was already gated and logged except the moment
 * itself. Two additions, both about time rather than permission:
 *
 *   hold_first_n         the first N auto releases go out with you watching
 *   undo_window_seconds  a released packet waits, and can be cancelled
 *
 * BOTH DEFAULT TO ON. A safety feature nobody discovers protects nobody, so the
 * defaults are 3 and 900s — something a confident user turns down, not something
 * an anxious one has to find.
 *
 * THE FAILURE MODE THAT MATTERS MOST is not that these do nothing. It is that
 * they do too much: read a missing column as "hold everything" and a working
 * agent stops, silently, for every existing subscriber, with no error anywhere.
 * Every guard below is pinned permissive-when-absent for that reason.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideRelease } from "../../supabase/functions/_shared/apply-release.ts";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260804050000_earned_trust_and_undo.sql"), "utf8");
const agent = readFileSync(
  resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A packet that passes every other gate, so only the on-ramp can refuse it. */
const sendable = {
  applyMode: "auto" as const,
  packetReady: true,
  blockerCount: 0,
  source: "breezy",
  allowedSources: ["breezy"],
  sentToday: 0,
  dailyCap: 5,
  alreadySubmitted: false,
  fitPct: 90,
  minFitPct: 55,
  duplicate: false,
  senderOnline: true,
};

describe("the on-ramp holds the first few, then gets out of the way", () => {
  it("holds when fewer than N have gone out unattended", () => {
    const d = decideRelease({ ...sendable, holdFirstN: 3, autoReleasedCount: 0 });
    expect(d).toMatchObject({ release: false, code: "held-for-review" });
  });

  it("releases once the on-ramp is complete", () => {
    expect(decideRelease({ ...sendable, holdFirstN: 3, autoReleasedCount: 3 }).release).toBe(true);
  });

  it("0 disables it entirely", () => {
    expect(decideRelease({ ...sendable, holdFirstN: 0, autoReleasedCount: 0 }).release).toBe(true);
  });

  it("ABSENT VALUES DO NOT HOLD — the one that would stop every existing agent", () => {
    // A mandate row written before the migration has neither field. If undefined
    // read as "hold", every current subscriber's agent would stop dead and the
    // only symptom would be an empty queue.
    expect(decideRelease({ ...sendable }).release).toBe(true);
  });

  it("counts the person through, so the message is 1 of 3 and not 0 of 3", () => {
    const d = decideRelease({ ...sendable, holdFirstN: 3, autoReleasedCount: 1 });
    expect(d).toMatchObject({ release: false, reason: expect.stringContaining("2 of 3") });
  });

  it("is checked AFTER the substantive gates", () => {
    // The packet shown during the on-ramp must be one that would really have
    // gone out. A packet refused for fit teaches nothing about unattended
    // sending, so fit must win the race to refuse.
    const d = decideRelease({ ...sendable, fitPct: 10, holdFirstN: 3, autoReleasedCount: 0 });
    expect(d).toMatchObject({ release: false, code: "fit-below-floor" });
  });

  it("only auto releases spend the on-ramp", () => {
    // A packet the candidate approved by hand teaches them nothing about what
    // happens while they sleep, so it must not consume one of their three.
    expect(code(agent)).toMatch(/decision\.release && m\.apply_mode === "auto"/);
  });

  it("increments atomically, not read-then-write", () => {
    expect(sql).toMatch(/SET auto_released_count = auto_released_count \+ 1/);
    expect(code(agent)).toMatch(/agent_note_auto_release/);
  });
});

describe("the cancel window is enforced where the claim happens", () => {
  it("the claim function refuses a packet still inside its window", () => {
    // Without this predicate claimable_at is a column nothing reads, and the
    // cancel button stops nothing while appearing to work.
    expect(sql).toMatch(/c\.claimable_at IS NULL OR c\.claimable_at <= now\(\)/);
  });

  it("NULL claimable_at stays claimable — existing rows must not freeze", () => {
    expect(sql).toMatch(/c\.claimable_at IS NULL OR/);
  });

  it("apply-agent writes the window only on release, and only when non-zero", () => {
    const c = code(agent);
    expect(c).toMatch(/claimable_at: decision\.release && Number\(m\.undo_window_seconds \?\? 0\) > 0/);
  });

  it("cancelling refuses once a worker holds it, rather than lying", () => {
    // After a claim we cannot be sure the form was not already filled, so the
    // honest answer is "too late" — a silent no-op returning success would tell
    // somebody their application was stopped when it may not have been.
    expect(sql).toMatch(/AND claimed_at IS NULL/);
    expect(sql).toMatch(/AND submitted_at IS NULL/);
    expect(sql).toMatch(/RETURN v_rows > 0;/);
  });

  it("cancelling is scoped to your own rows in SQL, not in the client", () => {
    expect(sql).toMatch(/AND user_id = auth\.uid\(\)/);
  });
});

describe("both refusal codes are in the closed vocabulary", () => {
  const release = readFileSync(
    resolve(__dirname, "../../supabase/functions/_shared/apply-release.ts"), "utf8");
  for (const c of ["held-for-review", "cancelled-by-you"]) {
    it(`"${c}" is a declared ReleaseRefusal`, () => {
      // A code that exists only in the database renders as a raw slug, and
      // every consumer switching on refusals silently falls through to a
      // generic "blocked" that reads as a fault.
      const union = release.slice(release.indexOf("export type ReleaseRefusal"),
                                  release.indexOf("export function decideRelease"));
      expect(union).toContain(`"${c}"`);
    });
  }
});

describe("the defaults are on", () => {
  it("hold_first_n defaults to 3 and the window to 900s", () => {
    expect(sql).toMatch(/hold_first_n integer NOT NULL DEFAULT 3/);
    expect(sql).toMatch(/undo_window_seconds integer NOT NULL DEFAULT 900/);
  });

  it("both are bounded, so a bad value cannot wedge the queue", () => {
    expect(sql).toMatch(/hold_first_n BETWEEN 0 AND 25/);
    expect(sql).toMatch(/undo_window_seconds BETWEEN 0 AND 86400/);
  });
});
