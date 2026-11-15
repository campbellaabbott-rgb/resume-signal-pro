// The decision to actually send ... docs/shared-notes.md#s102
import { automationFor, isSendableVendor } from "./apply-automation.ts";

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
  // Has a worker checked in ... docs/shared-notes.md#s103
  senderOnline: boolean;
  /** On-ramp: hold this many auto releases for approval first. Undefined = 0. */
  holdFirstN?: number;
  /** How many have already gone out unattended. Undefined = 0, i.e. brand new. */
  autoReleasedCount?: number;
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
  | "sender-offline"
  // NB FOR ANYONE EDITING THIS ... docs/shared-notes.md#s104
  | "held-for-review"
  // Written by agent_cancel_pending rather t ... docs/shared-notes.md#s105
  | "cancelled-by-you";

// The refusals a PERSON may ... docs/shared-notes.md#s106
export const APPROVABLE_REFUSALS: ReadonlySet<ReleaseRefusal> = new Set<ReleaseRefusal>([
  "review-mode", "held-for-review", "sender-offline", "daily-cap", "fit-below-floor", "fit-unknown",
]);

// The refusal a WAITING packet ... docs/shared-notes.md#s107
export function refusalToStore(previous: string, next: ReleaseRefusal): string {
  if (next === "vendor-not-allowed" && (previous === "review-mode" || previous === "held-for-review")) return previous;
  return next;
}

export function decideRelease(i: ReleaseInput): ReleaseDecision {
  // Order matters only for which ... docs/shared-notes.md#s108

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

  // Checked third, straight after the ... docs/shared-notes.md#s109
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
  // Belt and braces against the ... docs/shared-notes.md#s110
  if (automationFor(src).tier !== "auto") {
    return {
      release: false,
      code: "vendor-needs-human",
      reason: `${src} needs a step only you can do`,
    };
  }
  // NO CAPTCHA IS NOT AN ... docs/shared-notes.md#s111
  if (!isSendableVendor(src)) {
    return {
      release: false,
      code: "vendor-needs-human",
      reason: `the agent cannot complete ${src} forms yet — this one is prepared for you to send`,
    };
  }

  // An unknown fit is not ... docs/shared-notes.md#s112
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

  // THE ON-RAMP. The first few ... docs/shared-notes.md#s113
  const hold = Number(i.holdFirstN ?? 0);
  if (hold > 0 && Number(i.autoReleasedCount ?? 0) < hold) {
    return {
      release: false,
      code: "held-for-review",
      reason: `your first ${hold} go out with your approval — this is ${Number(i.autoReleasedCount ?? 0) + 1} of ${hold}`,
    };
  }

  // Checked last so the reason ... docs/shared-notes.md#s114
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
    // Count the release against the ... docs/shared-notes.md#s115
    if (d.release) sent += 1;
    return d;
  });
}
