export type AutomationTier =
  | "auto"
  | "signup"
  | "click"
  | "unknown";
export type AutomationFact = {
  tier: AutomationTier;
  realQuestions: boolean;
  sampled: number;
  note: string;
};
const FACTS: Record<string, AutomationFact> = {
  workday: { tier: "auto", realQuestions: false, sampled: 60, note: "0/60 captcha; JS form; per-tenant account needed" },
  smartrecruiters: { tier: "auto", realQuestions: false, sampled: 60, note: "0/60 captcha; JS form" },
  breezy: { tier: "auto", realQuestions: true, sampled: 54, note: "0/54 captcha; JS form. QUESTIONS HARVESTABLE 2026-08-01: the /apply route server-renders the questionnaire as HTML-escaped JSON. Parsed by _shared/vendor-questions.ts" },
  oracle: { tier: "auto", realQuestions: false, sampled: 39, note: "0/39 captcha; JS form" },
  teamtailor: { tier: "auto", realQuestions: true, sampled: 22, note: "0 captcha, no login wall. ADAPTER SHIPPED 2026-07-31: form is inline on the posting page, names are Rails-nested (candidate[first_name] etc), screening questions carry real labels. A cookie overlay must be declined first or the form does not render, and the CV input is unnamed — located by its accept list." },
  personio: { tier: "auto", realQuestions: false, sampled: 7, note: "0/7 captcha — thin sample" },
  pinpoint: { tier: "auto", realQuestions: true, sampled: 5, note: "0/5 captcha - thin sample. QUESTIONS HARVESTABLE 2026-08-01: the /applications/new route server-renders one react-on-rails script per question carrying questionDetails{title,questionType,required}. The POSTING page does NOT - probing it and concluding JS-only was wrong. Parsed by _shared/vendor-questions.ts" },
  ashby: { tier: "click", realQuestions: true, sampled: 60, note: "60/60 captcha" },
  bamboohr: { tier: "click", realQuestions: false, sampled: 84, note: "re-measured 2026-07-31 with a real browser: 24/24 tenants serve a VISIBLE reCAPTCHA v2 checkbox (304x78) on the application form, all sharing ONE BambooHR platform sitekey — so it is not a per-employer toggle. Not Enterprise, so it blocks honestly rather than scoring us down silently. See worker/RECON.md." },
  workable: { tier: "click", realQuestions: false, sampled: 60, note: "60/60 captcha" },
  lever: { tier: "click", realQuestions: false, sampled: 57, note: "57/57 captcha" },
  rippling: { tier: "click", realQuestions: false, sampled: 49, note: "49/49 captcha" },
  recruitee: { tier: "click", realQuestions: true, sampled: 30, note: "26/30 captcha. QUESTIONS HARVESTABLE, measured 2026-08-03: /api/offers/{id} returns open_questions plus the document config (options_cv/cover_letter/photo). 40/40 live postings supported, 127 real questions. The reader shipped with task #201 and this flag was never flipped, so apply-agent — which gates the harvest on it — sent four generic questions to 7,886 postings that publish their actual form" },
  icims: { tier: "click", realQuestions: false, sampled: 60, note: "17/60 captcha — mixed, treat as blocked" },
  greenhouse: { tier: "click", realQuestions: true, sampled: 67, note: "94% invisible reCAPTCHA Enterprise — silent scoring, not a challenge" },
};
const UNKNOWN: AutomationFact = {
  tier: "unknown",
  realQuestions: false,
  sampled: 0,
  note: "vendor not measured",
};
const TABLE = new Map<string, AutomationFact>(Object.entries(FACTS));
export function realQuestionVendors(): string[] {
  return Object.entries(FACTS)
    .filter(([, f]) => f.realQuestions)
    .map(([vendor]) => vendor)
    .sort();
}
export function automationFor(source: string): AutomationFact {
  return TABLE.get(String(source ?? "").trim().toLowerCase()) ?? UNKNOWN;
}
export function isFullyAutomatable(source: string): boolean {
  return automationFor(source).tier === "auto";
}
export function automationLabel(source: string): string {
  const f = automationFor(source);
  switch (f.tier) {
    case "auto":
      return "Applies automatically";
    case "signup":
      return "Needs a one-time account with this employer";
    case "click":
      return "You clear one CAPTCHA; the rest is automatic";
    default:
      return "We haven't measured this employer's form yet";
  }
}
export const SENDABLE_VENDORS: readonly string[] = ["breezy", "oracle", "personio", "pinpoint", "teamtailor"];
const SENDABLE = new Set(SENDABLE_VENDORS);
export function isSendableVendor(postingIdOrSource: string): boolean {
  const s = String(postingIdOrSource ?? "").toLowerCase();
  return SENDABLE.has(s.includes(":") ? s.split(":")[0]! : s);
}
export const TENANT_WALL_TTL_DAYS = 14;
export interface TenantWall {
  walled: boolean;
  checked_at: string;
}
export function tenantSendable(
  postingIdOrSource: string,
  wall?: TenantWall | null,
  now: number = Date.now(),
): boolean {
  if (isSendableVendor(postingIdOrSource)) return true;
  if (!wall || wall.walled !== false) return false;
  const seen = Date.parse(wall.checked_at ?? "");
  if (!Number.isFinite(seen)) return false;
  const ageDays = (now - seen) / 86_400_000;
  return ageDays >= 0 && ageDays <= TENANT_WALL_TTL_DAYS;
}
