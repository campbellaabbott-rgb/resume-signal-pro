/**
 * A REFUSAL WE CANNOT NAME IS STILL A REFUSAL.
 *
 * refusalFace returned null for two completely different situations — "this
 * packet was not refused" and "this packet was refused for a reason this build
 * does not recognise" — and the queue renders null as nothing. So a packet
 * could sit there, not sent, with no reason on screen at all.
 *
 * That is the silent no this codebase abolishes everywhere else. apply-release's
 * own header says it: "a silent no is indistinguishable from a broken cron".
 * The unknown branch was quietly reintroducing it, and the function's comment
 * even claimed the caller fell back to the plain status — it fell back to blank
 * space.
 *
 * IT IS REALISTIC, NOT THEORETICAL. Edge functions and the frontend deploy
 * separately here, every single time. A new code exists in production before any
 * page knows the word for it, and `cancelled-by-you` proves codes can also be
 * written by SQL, which ships on a third schedule again.
 */
import { describe, expect, it } from "vitest";
import { refusalFace, ALL_REFUSAL_CODES } from "../lib/refusalCopy";

describe("nothing to report stays nothing", () => {
  for (const empty of [null, undefined, "", "   "]) {
    it(`${JSON.stringify(empty)} yields no message`, () => {
      // A packet that was never refused must not grow a refusal banner.
      expect(refusalFace(empty as string | null | undefined)).toBeNull();
    });
  }
});

describe("every known code keeps its own wording", () => {
  it("resolves each declared code to a distinct face", () => {
    expect(ALL_REFUSAL_CODES.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const c of ALL_REFUSAL_CODES) {
      const f = refusalFace(c);
      expect(f, `${c} lost its face`).not.toBeNull();
      expect(f!.code).toBe(c);
      // No two codes may share a message — that is how "offline" and "below
      // your fit floor" became the same grey row in the first place.
      expect(seen.has(f!.fallback), `${c} shares wording with another code`).toBe(false);
      seen.add(f!.fallback);
    }
  });
});

describe("an unrecognised code is reported, not swallowed", () => {
  const face = refusalFace("some-future-code");

  it("returns a face rather than null", () => {
    expect(face).not.toBeNull();
  });

  it("names the actual code, so the gap is diagnosable from a screenshot", () => {
    expect(face!.fallback).toContain("some-future-code");
  });

  it("says nothing was sent — the one fact that matters to the candidate", () => {
    expect(face!.fallback.toLowerCase()).toContain("nothing was sent");
  });

  it("blames the product, not the person", () => {
    expect(face!.severity).toBe("on-us");
    expect(face!.fix).toBeNull();
  });

  it("DOES NOT INVENT A REASON — the distinction the old comment was right about", () => {
    // Guessing "your fit was too low" for an unknown code states a FALSE reason.
    // Saying "we cannot describe this yet" states a true one. The first is worse
    // than silence; the second is strictly better.
    const known = ALL_REFUSAL_CODES.map((c) => refusalFace(c)!.fallback);
    expect(known).not.toContain(face!.fallback);
  });

  it("two different unknown codes do not share a message", () => {
    const other = refusalFace("another-future-code")!;
    expect(other.fallback).not.toBe(face!.fallback);
    expect(other.key).not.toBe(face!.key);
  });
});
