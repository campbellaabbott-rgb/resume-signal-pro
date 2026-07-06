// Field-specific "what screeners check first" notes for the industry SEO
// pages. Mirrors the scanner's industry-specific checks (kept in sync
// manually; the scanner's version lives in free-keyword-scan/index.ts).
// Pure data module — also imported by the build-time prerenderer.

export const SCREENER_NOTES: Record<string, string> = {
  creative: "Screeners look for a portfolio link before reading a single bullet — put it in your header.",
  media: "A portfolio or published-work link is expected in your header.",
  gaming: "A portfolio/itch/Steam link is expected before your experience is read.",
  entertainment: "A reel or portfolio link is checked first.",
  architecture: "A portfolio link is checked before anything else.",
  technology: "A GitHub (or similar) link is expected — even a few solid repos beats none.",
  data_science: "A GitHub or notebook portfolio link strengthens every application.",
  data_engineering: "A GitHub link is expected in this field.",
  machine_learning: "A GitHub/papers link is expected in this field.",
  cybersecurity: "State certifications and any clearance explicitly — many roles filter on them first.",
  academia: "Screeners look for a publications section with venues.",
  biotech: "A publications/posters section is expected for research roles.",
  government: "If you hold or held a security clearance, state it in your header — many roles filter on it before anything else.",
  aviation: "FAA certificates and clearances belong in your header, not page two.",
  healthcare: "Your license must be visible in the top third of page one — next to your name.",
  legal: "Bar admission belongs in the top third of page one.",
  skilled_trades: "Licenses (journeyman, master, EPA) must be visible near the top.",
  finance: "CPA/CFA belongs next to your name, not buried in a certifications section.",
  pharmacy: "Licensure belongs in the top third of page one.",
  dental: "Licensure belongs in the top third of page one.",
  real_estate: "Your license number and state belong near the top.",
  insurance: "State licenses (P&C, L&H) belong near the top.",
  social_work: "LCSW/LMSW licensure belongs in the top third of page one.",
  veterinary: "Credentials belong in the top third of page one.",
  law_enforcement: "POST certification and clearances belong near the top.",
};
