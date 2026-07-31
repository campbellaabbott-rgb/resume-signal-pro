import { describe, expect, it } from "vitest";
import {
  decideBatch,
  decideRelease,
  type ReleaseInput,
  type ReleaseDecision,
} from "../../supabase/functions/_shared/apply-release.ts";

// Sendable by default; each test breaks exactly one thing. Written this way on
// purpose: a decision that sends a real application in someone's name should be
// provably refusable on every single input, one at a time.
const OK: ReleaseInput = {
  applyMode: "auto",
  packetReady: true,
  blockerCount: 0,
  source: "smartrecruiters",
  allowedSources: ["smartrecruiters", "workday", "breezy"],
  sentToday: 0,
  dailyCap: 5,
  alreadySubmitted: false,
  fitPct: 80,
  minFitPct: 60,
  duplicate: false,
  senderOnline: true,
};
const r = (o: Partial<ReleaseInput> = {}) => decideRelease({ ...OK, ...o });

describe("it sends only when everything is true at once", () => {
  it("releases the clean case", () => {
    expect(r()).toEqual({ release: true });
  });

  it("refuses on every single input, independently", () => {
    // If any one of these stops refusing, the agent has gained the ability to
    // send an application a candidate did not sanction.
    const cases: Array<[Partial<ReleaseInput>, string]> = [
      [{ applyMode: "review" }, "review-mode"],
      [{ packetReady: false }, "not-ready"],
      [{ blockerCount: 1 }, "not-ready"],
      [{ source: "lever" }, "vendor-not-allowed"],
      [{ sentToday: 5 }, "daily-cap"],
      [{ alreadySubmitted: true }, "already-submitted"],
      [{ duplicate: true }, "duplicate"],
      [{ senderOnline: false }, "sender-offline"],
      [{ fitPct: 40 }, "fit-below-floor"],
      [{ fitPct: null }, "fit-unknown"],
    ];
    for (const [patch, code] of cases) {
      const d = r(patch);
      expect(d.release, JSON.stringify(patch)).toBe(false);
      expect((d as { code: string }).code, JSON.stringify(patch)).toBe(code);
    }
  });

  it("gives a reason every time it refuses", () => {
    // "The agent did nothing last night" must always be answerable. A silent no
    // is indistinguishable from a broken cron.
    for (const patch of [{ applyMode: "review" as const }, { fitPct: null }, { sentToday: 9 }]) {
      const d = r(patch) as { reason: string };
      expect(typeof d.reason).toBe("string");
      expect(d.reason.length).toBeGreaterThan(8);
    }
  });
});

describe("the allow-list can narrow the measurement, never widen it", () => {
  it("refuses a CAPTCHA vendor even when the candidate listed it", () => {
    // The defence against an allow-list drifting from what was measured — a
    // stale default, a hand-edited row, a migration that added a vendor.
    const d = r({ source: "ashby", allowedSources: ["ashby", "smartrecruiters"] });
    expect(d.release).toBe(false);
    expect((d as { code: string }).code).toBe("vendor-needs-human");
  });

  it("refuses Greenhouse even when listed — invisible scoring, not a challenge", () => {
    // 94% load reCAPTCHA Enterprise with no widget: a headless submit is scored
    // and rejected SILENTLY, which is the worst failure mode available.
    const d = r({ source: "greenhouse", allowedSources: ["greenhouse"] });
    expect(d.release).toBe(false);
    expect((d as { code: string }).code).toBe("vendor-needs-human");
  });

  it("refuses a vendor nobody has ever sampled", () => {
    const d = r({ source: "jobvite", allowedSources: ["jobvite"] });
    expect(d.release).toBe(false);
  });

  it("still honours a narrower list than the measurement allows", () => {
    // breezy is measured 'auto', but this candidate did not enable it.
    const d = r({ source: "breezy", allowedSources: ["smartrecruiters"] });
    expect((d as { code: string }).code).toBe("vendor-not-allowed");
  });
});

describe("an unknown fit is not a good fit", () => {
  it("never sends unattended when the score is missing", () => {
    for (const v of [null, Number.NaN, undefined as unknown as number]) {
      const d = r({ fitPct: v as number | null });
      expect(d.release, String(v)).toBe(false);
      expect((d as { code: string }).code).toBe("fit-unknown");
    }
  });

  it("treats the floor as inclusive", () => {
    expect(r({ fitPct: 60, minFitPct: 60 }).release).toBe(true);
    expect(r({ fitPct: 59.9, minFitPct: 60 }).release).toBe(false);
  });
});

describe("the daily cap is counted as it is spent", () => {
  // THE BUG THIS PREVENTS: deciding a whole batch against the same starting
  // count. Every item sees "0 sent today", every item passes, and a cap of 5
  // sends 30 applications in one night.
  it("stops at the cap inside a single batch", () => {
    const items = Array.from({ length: 12 }, () => ({ ...OK }) as Omit<ReleaseInput, "sentToday">);
    const out = decideBatch(items, 0, 5);
    expect(out.filter((d) => d.release).length).toBe(5);
    expect(out.filter((d) => !d.release).length).toBe(7);
    for (const d of out.slice(5)) {
      expect((d as { code: string }).code).toBe("daily-cap");
    }
  });

  it("respects what was already sent earlier in the day", () => {
    const items = Array.from({ length: 6 }, () => ({ ...OK }) as Omit<ReleaseInput, "sentToday">);
    expect(decideBatch(items, 4, 5).filter((d) => d.release).length).toBe(1);
    expect(decideBatch(items, 5, 5).filter((d) => d.release).length).toBe(0);
  });

  it("does not spend cap on items that were refused for other reasons", () => {
    // A blocked packet must not consume a slot a sendable one could have used.
    const items = [
      { ...OK, packetReady: false, blockerCount: 2 },
      { ...OK, source: "ashby" },
      { ...OK },
      { ...OK },
    ] as Array<Omit<ReleaseInput, "sentToday">>;
    const out = decideBatch(items, 0, 2);
    expect(out[0].release).toBe(false);
    expect(out[1].release).toBe(false);
    expect(out[2].release).toBe(true);
    expect(out[3].release).toBe(true);
  });
});

describe("resend and duplicate are the failures a candidate cannot undo", () => {
  it("refuses a resend before anything else is even considered", () => {
    // Checked first deliberately: even a packet that is wrong in every other way
    // must not be re-sent, and the reason shown should say so.
    const d = r({ alreadySubmitted: true, applyMode: "review", packetReady: false, fitPct: null });
    expect((d as { code: string }).code).toBe("already-submitted");
  });

  it("refuses when the tracker already has this posting", () => {
    const d = r({ duplicate: true });
    expect((d as { code: string }).code).toBe("duplicate");
    expect((d as { reason: string }).reason).toMatch(/already applied/i);
  });
});

describe("review mode is the default posture and is never bypassed", () => {
  it("prepares but does not send, however perfect the packet", () => {
    const d = r({ applyMode: "review", fitPct: 99, blockerCount: 0 });
    expect(d.release).toBe(false);
    expect((d as { code: string }).code).toBe("review-mode");
  });

  it("a whole batch in review mode sends nothing", () => {
    const items = Array.from({ length: 8 }, () => ({ ...OK, applyMode: "review" as const }));
    expect(decideBatch(items, 0, 20).every((d) => !d.release)).toBe(true);
  });
});

describe("nothing is released when there is no sender to release it to", () => {
  // The worker runs as its own service because it needs a real browser, so it
  // can be down while every other part of the system is up. Releasing then puts
  // a packet into a state that reads as "on its way" with nobody to collect it.
  //
  // That is the one failure a paid product cannot have: the subscriber is
  // charged, watches a queue that looks like it is about to act, and nothing is
  // ever applied for. A refusal with a reason is recoverable; a promise that
  // quietly does nothing is not.
  const codeOf = (d: ReleaseDecision) => (d as { code?: string }).code;
  const reasonOf = (d: ReleaseDecision) => (d as { reason?: string }).reason ?? "";

  it("refuses a packet that is perfect in every other respect", () => {
    expect(r({}).release, "the fixture must be sendable, or this proves nothing").toBe(true);
    const d = r({ senderOnline: false });
    expect(d.release).toBe(false);
    expect(codeOf(d)).toBe("sender-offline");
  });

  it("says the sender is down rather than blaming the candidate's settings", () => {
    // A candidate told "fit is under your floor" would go and lower their floor.
    // The fit was never the problem, and sending someone to change a setting
    // that was correct is worse than saying nothing at all.
    const d = r({ senderOnline: false, fitPct: 10, minFitPct: 90 });
    expect(d.release).toBe(false);
    expect(codeOf(d), "offline must outrank the settings-shaped reasons").toBe("sender-offline");
    expect(reasonOf(d)).toMatch(/offline/i);
    expect(reasonOf(d), "must say plainly that nothing was sent").toMatch(/nothing was sent/i);
  });

  it("still refuses the two never-send rules ahead of it", () => {
    // Offline is checked third on purpose. If a packet was already submitted or
    // is a duplicate, that is the more important thing to say — those stay true
    // whether or not the sender comes back.
    const cases: Array<[Partial<ReleaseInput>, string]> = [
      [{ senderOnline: false, alreadySubmitted: true }, "already-submitted"],
      [{ senderOnline: false, duplicate: true }, "duplicate"],
    ];
    for (const [patch, code] of cases) {
      const d = r(patch);
      expect(d.release, JSON.stringify(patch)).toBe(false);
      expect(codeOf(d), JSON.stringify(patch)).toBe(code);
    }
  });
});
