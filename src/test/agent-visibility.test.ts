/**
 * The agent must never stop silently.
 *
 * Six gates stand between a posting and a sent application, and ten distinct
 * reasons exist for holding a prepared packet back. Every one of them was
 * computed correctly in the backend and displayed as nothing. From the
 * candidate's chair, "working and quiet today" and "has never been able to send
 * anything" were the same screen.
 *
 * These tests lock the two properties that fix has to keep: the copy stays in
 * step with the backend's list of reasons, and the blame is never misassigned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_REFUSAL_CODES, actionableCount, refusalFace, type RefusalCode,
} from "@/lib/refusalCopy";
import { agentState, needsAttention, type AgentSignals } from "@/lib/agentState";
import type { ProfileLike } from "@/lib/applyReadiness";

const COMPLETE: ProfileLike = {
  full_name: "Alex Morgan", email: "alex@example.com", phone: "+447700900123",
  city: "Leeds", country: "United Kingdom", address: "14 Wellington Street",
  postcode: "LS1 4AP", resume_file_url: "resumes/alex.pdf",
  salary_expectation: "55000", earliest_start: "Four weeks",
  cover_note: "Eight years running operations teams.",
  linkedin: "https://www.linkedin.com/in/alex-morgan-ops",
  work_authorized: true, requires_sponsorship: false, willing_to_relocate: true,
  consent_to_processing: true,
};

const signals = (over: Partial<AgentSignals> = {}): AgentSignals => ({
  hasMandate: true, entitled: true, senderOnline: true,
  applyMode: "auto", profile: COMPLETE, ...over,
});

describe("the copy stays in step with the backend's reasons", () => {
  // THE DRIFT GUARD. decideRelease owns the list; this file owns the words for
  // it. Add a refusal code in the edge function and the UI silently has no
  // sentence for it — which returns us to the exact silence this replaced, but
  // now looking deliberate. Read the union from source rather than trusting a
  // copy of it.
  it("every ReleaseRefusal code in apply-release.ts has copy", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/apply-release.ts"), "utf8");
    const union = src.slice(src.indexOf("export type ReleaseRefusal"));
    const codes = [...union.slice(0, union.indexOf(";")).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);

    expect(codes.length, "parsed no codes — the union's shape changed").toBeGreaterThanOrEqual(10);
    for (const code of codes) {
      expect(refusalFace(code), `no copy for backend refusal code "${code}"`).toBeTruthy();
    }
    // And nothing here that the backend cannot produce — dead copy rots.
    for (const code of ALL_REFUSAL_CODES) {
      expect(codes, `"${code}" is not a code decideRelease emits`).toContain(code);
    }
  });

  it("refuses to invent a sentence for a code it does not know", () => {
    // Edge functions and the bundle deploy separately, so a new code WILL reach
    // production before this file knows it. Guessing a reason is worse than the
    // silence — it states something untrue about someone's application.
    for (const unknown of ["", null, undefined, "brand-new-code", "SENDER-OFFLINE"]) {
      expect(refusalFace(unknown as string)).toBeNull();
    }
  });
});

describe("blame is not misassigned", () => {
  it("puts our outage on us, not on the candidate", () => {
    const f = refusalFace("sender-offline")!;
    expect(f.severity).toBe("on-us");
    expect(f.fix, "there must be nothing for them to 'fix'").toBeNull();
    expect(f.fallback).toMatch(/do not need to do anything|nothing for you/i);
  });

  it("treats the dedupe guard as correct behaviour, not a fault", () => {
    // Badging "you already applied" as a problem teaches people to distrust a
    // refusal that is the product working exactly as promised.
    for (const code of ["already-submitted", "duplicate"] as RefusalCode[]) {
      expect(refusalFace(code)!.severity).toBe("by-design");
    }
  });

  it("only counts the ones a person can actually act on", () => {
    const queue = ["already-submitted", "duplicate", "fit-below-floor", "daily-cap", "sender-offline"];
    expect(actionableCount(queue), "a healthy queue must not be badged").toBe(0);
    expect(actionableCount([...queue, "not-ready"])).toBe(1);
    expect(actionableCount([null, undefined, "nonsense"])).toBe(0);
  });
});

describe("the gate ladder names the gate that is actually shut", () => {
  it("no mandate comes first", () => {
    const v = agentState(signals({ hasMandate: false, entitled: false, profile: {} }));
    expect(v.gate).toBe("no-mandate");
  });

  it("entitlement before profile — do not send someone shopping before they can buy", () => {
    const v = agentState(signals({ entitled: false, profile: {} }));
    expect(v.gate).toBe("not-entitled");
    expect(v.fix).toBe("subscribe");
  });

  it("a missing CV outranks every other profile gap", () => {
    const v = agentState(signals({ profile: { ...COMPLETE, resume_file_url: "" } }));
    expect(v.gate).toBe("no-resume");
  });

  it("OUR outage outranks their profile gaps", () => {
    // THE ORDERING THAT MATTERS MOST. If nothing can go out regardless, sending
    // someone off to fill in a postcode wastes their evening AND dresses our
    // outage up as their oversight.
    const v = agentState(signals({ senderOnline: false, profile: { ...COMPLETE, postcode: "" } }));
    expect(v.gate).toBe("sender-offline");
    expect(v.blame).toBe("on-us");
    expect(needsAttention(v), "must not nag them for our outage").toBe(false);
  });

  it("profile gaps surface once the sender is up", () => {
    const v = agentState(signals({ profile: { ...COMPLETE, postcode: "" } }));
    expect(v.gate).toBe("profile-gaps");
    expect(v.readiness.gaps.map((g) => g.field)).toContain("postcode");
    expect(needsAttention(v)).toBe(true);
  });

  it("review mode is a choice, not a fault", () => {
    const v = agentState(signals({ applyMode: "review" }));
    expect(v.gate).toBe("review-mode");
    expect(v.blame).toBe("by-design");
    expect(needsAttention(v), "never nag a careful user forever").toBe(false);
    expect(v.canSend).toBe(false);
  });
});

describe("unknown is not false", () => {
  // Rendering "your subscription is not active" at a paying subscriber because
  // a network call has not returned is the worst thing this screen could say.
  it("does not accuse someone of not paying when entitlement is unknown", () => {
    const v = agentState(signals({ entitled: null }));
    expect(v.gate).not.toBe("not-entitled");
  });

  it("does not claim an outage when sender liveness is unknown", () => {
    const v = agentState(signals({ senderOnline: null }));
    expect(v.gate).not.toBe("sender-offline");
  });
});

describe("armed", () => {
  const v = agentState(signals());

  it("is reached only when every visible gate is open", () => {
    expect(v.gate).toBe("armed");
    expect(v.canSend).toBe(true);
    expect(v.blame).toBe("none");
  });

  it("still does not promise more than the agent honours", () => {
    // The honest-brand fence, applied to our own status line. "Armed" must not
    // read as "every application will now succeed" — unknown questions still
    // stop it, by design.
    expect(v.fallback).toMatch(/stops and asks|cannot answer/i);
  });
});

describe("a decision module that nothing renders is the bug it was written to fix", () => {
  // I SHIPPED THIS EXACT BUG. agentState.ts was written, tested, reviewed and
  // merged — and no component imported it. A module that computes what the
  // agent is doing, and which nothing displays, is precisely the "carefully
  // computed, then shown as silence" defect the whole file exists to end. Tests
  // passing is not evidence anybody can see the output.
  const root = resolve(__dirname, "../..");
  const MUST_BE_RENDERED = ["agentState", "refusalCopy", "applyReadiness"];

  it.each(MUST_BE_RENDERED)("src/lib/%s.ts has a non-test consumer", (mod) => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const hits = execSync(
      `/usr/bin/grep -rl 'lib/${mod}"' ${root}/src || true`, { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !f.includes("/test/") && !f.endsWith(`/lib/${mod}.ts`));
    expect(hits.length, `nothing imports lib/${mod} outside tests — it is invisible to users`)
      .toBeGreaterThan(0);
  });
});

describe("the panel actually reads the column", () => {
  it("selects release_refusal and renders its copy", () => {
    const panel = readFileSync(
      resolve(__dirname, "../components/account/ApplyQueuePanel.tsx"), "utf8");
    expect(panel, "the column has to be selected to be shown").toContain("release_refusal");
    expect(panel).toContain("refusalFace");
  });
});
