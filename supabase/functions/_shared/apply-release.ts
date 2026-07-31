// The decision to actually send an application in the candidate's name.
//
// Everything else in the agent can be retried, edited or ignored. This cannot:
// once a packet is released and the hands submit it, a real employer has a real
// application from a real person, and there is no unsend. So this file is
// deliberately paranoid, deliberately pure, and deliberately dull to read.
//
// It returns a REASON on every refusal rather than a bare false, because "the
// agent did nothing last night" must always be answerable. A silent no is
// indistinguishable from a broken cron, which is the same trap as an alarm that
// only records failures.
import { automationFor } from "./apply-automation.ts";

export type ReleaseInput = {
  applyMode: "review" | "auto";
  /** From buildPacket — false if ANY required field is unfilled or blocked. */
  packetReady: boolean;
  blockerCount: number;
  source: string;
  /** Vendors the candidate allows unattended sending on. */
  allowedSources: readonly string[];
  sentToday: number;
  dailyCap: number;
  /** Already stamped? A resend is the one failure a candidate cannot undo. */
  alreadySubmitted: boolean;
  /** The agent's own fit score, 0-100, or null when it could not compute one. */
  fitPct: number | null;
  minFitPct: number;
  /** True when the tracker already has an application to this posting. */
  duplicate: boolean;
  /**
   * Has a worker checked in recently enough to be trusted to send?
   *
   * The worker is a separate service — it needs a real browser, which edge
   * functions do not have — so it can be down while everything here is up. If it
   * is, releasing a packet moves it into a state that says "on its way" and
   * nothing ever collects it.
   *
   * That is the worst failure this product can have now that it is sold: a
   * subscriber pays, watches a queue that looks like it is about to act, and
   * nothing is applied for. A refusal with a reason is recoverable; a promise
   * that quietly does nothing is not.
   */
  senderOnline: boolean;
};

export type ReleaseDecision =
  | { release: true }
  | { release: false; reason: string; code: ReleaseRefusal };

export type ReleaseRefusal =
  | "review-mode"
  | "not-ready"
  | "vendor-not-allowed"
  | "vendor-needs-human"
  | "daily-cap"
  | "already-submitted"
  | "duplicate"
  | "fit-below-floor"
  | "fit-unknown"
  | "sender-offline";

export function decideRelease(i: ReleaseInput): ReleaseDecision {
  // Order matters only for which reason a candidate sees first; each check is
  // independently sufficient to refuse.

  if (i.alreadySubmitted) {
    return { release: false, code: "already-submitted", reason: "already sent — never resend" };
  }
  if (i.duplicate) {
    return {
      release: false,
      code: "duplicate",
      reason: "you already applied to this posting",
    };
  }

  // Checked third, straight after the two "never send twice" rules, because
  // when the sender is down this is the only true explanation and every reason
  // below it would be a misleading one. A candidate told "fit is under your
  // floor" would go and lower their floor; the fit was never the problem.
  //
  // Deliberately refuses rather than releasing optimistically. A packet left
  // unreleased is picked up on the next run at no cost. A packet released to
  // nobody looks sent and is not.
  if (!i.senderOnline) {
    return {
      release: false,
      code: "sender-offline",
      reason: "our sender is offline right now — nothing was sent, and this is queued for when it is back",
    };
  }
  if (i.applyMode !== "auto") {
    return { release: false, code: "review-mode", reason: "review mode — waiting for you to release it" };
  }
  if (!i.packetReady || i.blockerCount > 0) {
    return {
      release: false,
      code: "not-ready",
      reason: `${i.blockerCount} thing${i.blockerCount === 1 ? "" : "s"} still need you`,
    };
  }

  const src = String(i.source ?? "").trim().toLowerCase();
  if (!i.allowedSources.map((s) => String(s).toLowerCase()).includes(src)) {
    return { release: false, code: "vendor-not-allowed", reason: `you have not enabled auto-apply for ${src || "this source"}` };
  }
  // Belt and braces against the allow-list drifting from the measurement: even
  // if a candidate (or a migration default) lists a vendor, it is only released
  // unattended when the MEASURED tier says no human step is needed. The list can
  // narrow the measurement; it can never widen it.
  if (automationFor(src).tier !== "auto") {
    return {
      release: false,
      code: "vendor-needs-human",
      reason: `${src} needs a step only you can do`,
    };
  }

  // An unknown fit is not a low fit, and it is not a high one either. Sending on
  // "we could not tell" is how an agent ends up applying to things its owner
  // would be embarrassed by.
  if (i.fitPct === null || !Number.isFinite(i.fitPct)) {
    return { release: false, code: "fit-unknown", reason: "could not score the fit, so not sending unattended" };
  }
  if (i.fitPct < i.minFitPct) {
    return {
      release: false,
      code: "fit-below-floor",
      reason: `fit ${Math.round(i.fitPct)}% is under your ${i.minFitPct}% floor`,
    };
  }

  // Checked last so the reason a candidate sees is about THIS job where possible,
  // and only about the cap when the job itself was otherwise sendable.
  if (i.sentToday >= i.dailyCap) {
    return {
      release: false,
      code: "daily-cap",
      reason: `today's cap of ${i.dailyCap} is used up`,
    };
  }

  return { release: true };
}

/** Cap-aware batch release, so one runaway loop cannot empty a whole queue. */
export function decideBatch(
  items: readonly Omit<ReleaseInput, "sentToday">[],
  sentToday: number,
  dailyCap: number,
): ReleaseDecision[] {
  let sent = sentToday;
  return items.map((it) => {
    const d = decideRelease({ ...it, sentToday: sent, dailyCap });
    // Count the release against the cap IMMEDIATELY. Deciding a whole batch
    // against the same starting count is how a cap of 5 sends 30 — every item
    // sees "0 sent today" and every item passes.
    if (d.release) sent += 1;
    return d;
  });
}
