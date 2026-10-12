/**
 * WHAT WE KNOW ABOUT APPLYING ON A HIRING SYSTEM, AND NOTHING WE DON'T.
 *
 * Every fact here is read from a list that is already the source of truth:
 *   - the CAPTCHA tier from src/config/ats-vendors.ts (which a mirror test
 *     holds equal to what the agent obeys), measured on 674 apply pages on
 *     2026-07-30;
 *   - whether the Apply Agent can SUBMIT, from src/config/sendable-vendors.ts;
 *   - whether we read the posting's own screening questions, from the shared
 *     automation table (supabase/functions/_shared/apply-automation.ts), which
 *     REAL_QUESTION_PREFIXES in ApplicationAnswers mirrors under its own test.
 *
 * Deliberately absent: whether the employer requires an account. We hold no
 * data on it, so no sentence claims it either way.
 *
 * Two honesty limits on the CAPTCHA sentence, both from the measurement's own
 * notes: Workday's 0-of-60 is a NON-MEASUREMENT (its apply page is a script
 * shell a static fetch cannot see into), and a sample under
 * MIN_CLEAN_SAMPLE pages is too thin to say "showed none". Neither gets the
 * "showed none" sentence.
 */
import { ATS_VENDORS, type AtsTier } from "@/config/ats-vendors";
import { SENDABLE_VENDOR_KEYS } from "@/config/sendable-vendors";
import { automationFor } from "../../supabase/functions/_shared/apply-automation";

/** The measurement behind every tier sentence. */
export const APPLY_PAGE_SAMPLE = { pages: 674, date: "2026-07-30" } as const;

/** Below this many sampled pages a clean result is not stated. */
export const MIN_CLEAN_SAMPLE = 10;

/** Sources whose clean result the measurement itself calls a non-measurement. */
export const NOT_MEASURED_CLEAN: ReadonlySet<string> = new Set(["workday"]);

export type CaptchaFinding = "usually" | "none-in-sample" | "not-stated";

export type AgentRole = "submits" | "prepares" | "none";

export interface ApplyMechanics {
  /** The hiring-system key the apply link opens on, lower-case, or null. */
  systemKey: string | null;
  tier: AtsTier | "unknown";
  captcha: CaptchaFinding;
  agent: AgentRole;
  /** The posting's own screening questions are read ahead of time. */
  readsScreeningQuestions: boolean;
}

const TIER = new Map<string, AtsTier>(ATS_VENDORS.map((v) => [v.key, v.tier]));
const SENDABLE = new Set(SENDABLE_VENDOR_KEYS);

export function applyMechanics(systemKey: string | null | undefined): ApplyMechanics {
  const key = String(systemKey ?? "").trim().toLowerCase() || null;
  if (!key) return { systemKey: null, tier: "unknown", captcha: "not-stated", agent: "none", readsScreeningQuestions: false };
  const tier = TIER.get(key) ?? "unknown";
  const fact = automationFor(key);
  let captcha: CaptchaFinding = "not-stated";
  if (tier === "click") captcha = "usually";
  else if (tier === "auto" && !NOT_MEASURED_CLEAN.has(key) && fact.sampled >= MIN_CLEAN_SAMPLE) captcha = "none-in-sample";
  // The agent prepares answers on every measured ATS it cannot send on; on a
  // system outside ATS_VENDORS (USAJOBS, an unmeasured ATS) it says nothing.
  const agent: AgentRole = SENDABLE.has(key) ? "submits" : TIER.has(key) ? "prepares" : "none";
  return { systemKey: key, tier, captcha, agent, readsScreeningQuestions: fact.realQuestions === true };
}

/** The vendors whose screening questions are read: for the mirror test. */
export function screeningQuestionVendors(): string[] {
  return ATS_VENDORS.map((v) => v.key).filter((k) => automationFor(k).realQuestions).sort();
}
