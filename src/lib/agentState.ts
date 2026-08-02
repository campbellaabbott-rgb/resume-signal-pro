/**
 * One sentence: what is my agent doing, and what is the next thing to do?
 *
 * WHY THIS IS NOT COSMETIC. There are six independent gates between a posting
 * and a sent application — a mandate, an entitlement, a résumé, the apply mode,
 * a live sender, and a profile complete enough for the employer's form. Every
 * one of them, when closed, produces the same observable result: nothing
 * happens. From the candidate's chair "my agent is working and today was quiet"
 * and "my agent has never been able to send anything" are the same screen.
 *
 * The whole system has this shape and it keeps costing us. A cron gated on a
 * missing vault key fires nothing, silently and by design. An entitlement check
 * skips a mandate and returns no error. `decideRelease` refuses with a precise
 * code that reached no UI until today. Each of those was defensible on its own;
 * the sum is a product that cannot tell you whether it is broken.
 *
 * So this walks the gates IN THE ORDER THE BACKEND ACTUALLY APPLIES THEM and
 * names the first one that is shut. Order matters: telling someone to complete
 * their profile when they have not subscribed wastes their time, and telling
 * them to subscribe when our own sender is down is close to dishonest.
 *
 * IT MUST NEVER OVERSTATE. "Armed" is only returned when every gate we can see
 * is open, and even then the copy says the agent still refuses questions it
 * cannot ground — because it does, and a promise this screen cannot keep is
 * how the honest-brand fence gets broken from the inside.
 */

import { applyReadiness, type ApplyReadiness, type ProfileLike } from "./applyReadiness";

export type AgentGate =
  | "no-mandate"
  | "not-entitled"
  | "no-resume"
  | "sender-offline"
  | "profile-gaps"
  | "review-mode"
  | "armed";

/** Same three-way split as refusalCopy, and for the same reason. */
export type AgentBlame = "needs-you" | "on-us" | "by-design" | "none";

export type AgentVerdict = {
  gate: AgentGate;
  blame: AgentBlame;
  /** i18n key + English fallback, matching this codebase's t(key, fallback). */
  key: string;
  fallback: string;
  /** Where to send them, when there is somewhere useful to go. */
  fix: "setup" | "subscribe" | "resume" | "profile" | "mode" | null;
  /** True only when nothing we can observe would stop a send. */
  canSend: boolean;
  /** Carried through so the panel can list the specific gaps. */
  readiness: ApplyReadiness;
};

export type AgentSignals = {
  /** Does an agent_mandates row exist for this user? */
  hasMandate: boolean;
  /**
   * Entitlement. `null` means WE DO NOT KNOW — the check failed or has not
   * returned. Not the same as false, and must not be rendered as "unsubscribed":
   * accusing a paying subscriber of not paying is the worst thing this screen
   * could do.
   */
  entitled: boolean | null;
  /** Has a worker checked in recently? `null` when unknown, same rule. */
  senderOnline: boolean | null;
  applyMode: "review" | "auto";
  profile: ProfileLike;
};

const V = (
  gate: AgentGate, blame: AgentBlame, fallback: string,
  fix: AgentVerdict["fix"], canSend: boolean, readiness: ApplyReadiness,
): AgentVerdict => ({ gate, blame, key: `agentState.${gate}`, fallback, fix, canSend, readiness });

export function agentState(s: AgentSignals): AgentVerdict {
  const readiness = applyReadiness(s.profile);

  // The order below mirrors apply-agent and decideRelease. Do not reorder to
  // put the "easiest fix" first — the point is to name the gate that is
  // actually shut, not the one that is cheapest to talk about.

  // 1. No mandate: nothing exists to run.
  if (!s.hasMandate) {
    return V("no-mandate", "needs-you",
      "Your agent is not set up yet. Tell it what you are looking for and it starts working overnight.",
      "setup", false, readiness);
  }

  // 2. Entitlement. apply-agent skips the mandate outright without it.
  //    `null` is deliberately NOT treated as false — see AgentSignals.
  if (s.entitled === false) {
    return V("not-entitled", "needs-you",
      "Your agent subscription is not active, so nothing is being prepared or sent.",
      "subscribe", false, readiness);
  }

  // 3. A résumé blocks literally every form in the corpus. Before anything else
  //    about profile completeness, because without it none of the rest matters.
  if (readiness.gaps.some((g) => g.field === "resume_file_url")) {
    return V("no-resume", "needs-you",
      "No CV on file. Every application form requires one, so nothing can be sent until you upload it.",
      "resume", false, readiness);
  }

  // 4. Our sender. Checked BEFORE profile gaps on purpose: if nothing could go
  //    out regardless, sending someone off to fill in a postcode is a waste of
  //    their evening and makes our outage look like their oversight.
  if (s.senderOnline === false) {
    return V("sender-offline", "on-us",
      "Our sender is offline, so nothing is going out right now. Your queue is safe and resumes automatically — there is nothing for you to fix.",
      null, false, readiness);
  }

  // 5. Profile gaps that stop SOME employers' forms.
  if (!readiness.canSendUnattended) {
    return V("profile-gaps", "needs-you",
      "Some employers' forms ask things your profile does not answer yet, so those applications stop and wait for you.",
      "profile", false, readiness);
  }

  // 6. Review mode. Not a fault — it is the safe default and most people should
  //    stay on it. Framed as a standing choice, never as a problem to fix.
  if (s.applyMode === "review") {
    return V("review-mode", "by-design",
      "Your agent prepares each application and waits for you to press send. It will never send on its own while you are in review mode.",
      "mode", false, readiness);
  }

  // 7. Everything we can see is open. Note what this still does NOT promise.
  return V("armed", "none",
    "Your agent is applying for you. It still stops and asks whenever an employer wants something it cannot answer from your résumé.",
    null, true, readiness);
}

/**
 * Is this state worth interrupting someone over?
 *
 * `by-design` states are not. Badging review mode as a problem would nag every
 * careful user forever, and a badge that is always on is a badge nobody reads
 * by the time it means something.
 */
export function needsAttention(v: AgentVerdict): boolean {
  return v.blame === "needs-you";
}
