import { automationFor } from "./apply-automation.ts";
export type ReleaseInput = {
  applyMode: "review" | "auto";
  packetReady: boolean;
  blockerCount: number;
  source: string;
  allowedSources: readonly string[];
  sentToday: number;
  dailyCap: number;
  alreadySubmitted: boolean;
  fitPct: number | null;
  minFitPct: number;
  duplicate: boolean;
  senderOnline: boolean;
  holdFirstN?: number;
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
  | "held-for-review"
  | "cancelled-by-you";
export function decideRelease(i: ReleaseInput): ReleaseDecision {
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
  if (automationFor(src).tier !== "auto") {
    return {
      release: false,
      code: "vendor-needs-human",
      reason: `${src} needs a step only you can do`,
    };
  }
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
  const hold = Number(i.holdFirstN ?? 0);
  if (hold > 0 && Number(i.autoReleasedCount ?? 0) < hold) {
    return {
      release: false,
      code: "held-for-review",
      reason: `your first ${hold} go out with your approval — this is ${Number(i.autoReleasedCount ?? 0) + 1} of ${hold}`,
    };
  }
  if (i.sentToday >= i.dailyCap) {
    return {
      release: false,
      code: "daily-cap",
      reason: `today's cap of ${i.dailyCap} is used up`,
    };
  }
  return { release: true };
}
export function decideBatch(
  items: readonly Omit<ReleaseInput, "sentToday">[],
  sentToday: number,
  dailyCap: number,
): ReleaseDecision[] {
  let sent = sentToday;
  return items.map((it) => {
    const d = decideRelease({ ...it, sentToday: sent, dailyCap });
    if (d.release) sent += 1;
    return d;
  });
}