// WHAT THE $45 PRO PLAN INCLUDES, as the Pro card lists it.
//
// Every line is a shipped, factual capability OF THIS PLAN. The Morning Queue
// line that used to lead this list is the agent plan's (its entitlement is
// price-specific: _shared/agent.ts refuses the Pro price), so a Pro buyer met
// the agent's paywall on /agent after being sold it here (platform sweep
// L3-04). It is on the agent card beside the Pro card. The Full Analysis IS
// part of Pro (owner decision 2026-10-04): create-checkout mints a Pro
// member's analysis instead of charging $5.
//
// Two guards read this list: src/test/pricing-truth.test.ts fails when a line
// names what only the agent's price unlocks, and
// src/test/every-paid-tool-a-pro-perk-includes-is-free-to-a-pro-member.test.ts
// runs the checkout of every one-time product as a Pro member, because one
// line here says every paid tool is included.
export const PRO_PERKS = [
  "Batch application prep — tailored answers drafted for every saved job at once (you always hit send yourself)",
  "Unlimited scans — tailor a resume version to every job you apply to",
  "Track every application against the exact resume version you sent",
  "See which of your resume versions actually lands interviews",
  "Every paid tool included — Full Analysis, Keyword Fix, Cover Letters, Interview Coach, and all future tools, automatically",
  "Cancel anytime from your account",
];
