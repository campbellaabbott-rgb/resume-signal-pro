// Comparison-page data. Rules: claims about US must be verifiable in the
// product; claims about competitors stick to public, stable characteristics
// (pricing MODEL, core workflow focus) with an as-of framing — no invented
// numbers, no trash talk, and every page names where the competitor wins.

export interface CompetitorRow {
  dim: string;
  us: string;
  them: string;
  usWins?: boolean;
}

export interface Competitor {
  slug: string;
  name: string;
  intro: string;
  rows: CompetitorRow[];
  /** Overrides the FAQ's default "uses a subscription model" pricing answer —
      required for competitors where that claim would be false (e.g. chatbots
      with generous free tiers). */
  pricingNote?: string;
}

const US_FREE = "Full diagnostic report — score with audit trail, bullets graded and rewritten, recruiter panel, interview questions, per-vendor ATS checks. 7 scans/day (15 with a free account).";
const US_HONESTY = "Score shown with its modeling band, a point-by-point audit trail, and a reproducible report ID; every quoted line verified against your actual resume.";
const US_PRICING = "Free scan; paid tools $3–29 one-time; optional all-access subscription.";

export const COMPETITORS: Record<string, Competitor> = {
  chatgpt: {
    slug: "chatgpt",
    name: "ChatGPT & Claude",
    intro:
      "ChatGPT and Claude are what we're most often compared to — fairly, because they're genuinely excellent at resume advice. The honest difference is category: they are conversationalists, this is an instrument. Ask a chatbot to rate your resume five times and you'll get five different answers; an instrument gives the same reading for the same document and tells you where that reading sits among real ones.",
    pricingNote:
      "ChatGPT and Claude both have generous free tiers, with paid plans around $20/month (as of mid-2026). Resume Booster's diagnostic scan is free with no sign-up; paid tools are $3–29 one-time with an optional all-access subscription.",
    rows: [
      { dim: "Reproducible score", us: US_HONESTY, them: "Ask five times, get five different numbers — chat output isn't calibrated or repeatable, and there is no fixed score to track between edits.", usWins: true },
      { dim: "Real benchmarks", us: "Your score is placed against a live corpus of real scans — published medians and quartiles per industry, with sample sizes.", them: "No corpus. A chatbot can estimate what a 'good' resume looks like, but it cannot place yours in a real distribution.", usWins: true },
      { dim: "Verified claims", us: "Every quoted line is checked against your actual document before it reaches the report; nothing invented survives.", them: "Chatbots routinely misquote resumes — flagging 'missing' items that are present, or praising things that aren't there.", usWins: true },
      { dim: "Deterministic checks", us: "Per-vendor ATS parsing checks (Workday, Greenhouse, Lever, iCIMS), structure parsing, per-country CV rules (photo norms, data laws), keyword provenance (posting > O*NET > model).", them: "General advice recalled from training data — it cannot run your file through parser or format checks.", usWins: true },
      { dim: "Conversation & iteration", us: "Focused reports and grounded rewrites — deliberately not a chat.", them: "Genuinely excellent: brainstorming, endless rewrites, tone changes, follow-up questions. Use them for this — many of our users do both.", usWins: false },
      { dim: "Breadth beyond resumes", us: "Resume-scoped by design: scanning, rewrites, cover letters, interview prep.", them: "Everything else too — salary negotiation scripts, company research, mock interviews on any topic.", usWins: false },
      { dim: "Price", us: US_PRICING, them: "Generous free tiers; ~$20/month for paid plans (as of mid-2026).", usWins: false },
    ],
  },
  jobscan: {
    slug: "jobscan",
    name: "Jobscan",
    intro: "Jobscan is the long-standing leader in resume-to-job-description matching.",
    rows: [
      { dim: "Free tier", us: US_FREE, them: "Limited free match reports per month; most findings gated behind the paid plan.", usWins: true },
      { dim: "Works without a job posting", us: "Yes — expectations sourced per-occupation from the U.S. Department of Labor's O*NET database, cited in your report.", them: "Built around pasting a job description; far less useful without one.", usWins: true },
      { dim: "Score honesty", us: US_HONESTY, them: "A single match-rate percentage.", usWins: true },
      { dim: "Pricing model", us: US_PRICING, them: "Subscription (roughly $50/month at full price, as of mid-2026).", usWins: true },
      { dim: "Track many applications against JDs", us: "Basic application tracker; deeper per-JD workflow is on our roadmap.", them: "Mature multi-job tracking workflow — their strongest feature.", usWins: false },
      { dim: "Track record", us: "Newer platform (that's exactly why the free tier is this generous).", them: "A decade in market with a large content library.", usWins: false },
    ],
  },
  teal: {
    slug: "teal",
    name: "Teal",
    intro: "Teal centers on a job-search CRM: tracking applications with a resume builder attached.",
    rows: [
      { dim: "Resume analysis depth", us: US_FREE, them: "Keyword matching against saved jobs plus builder-side suggestions; analysis is lighter than a dedicated diagnostic.", usWins: true },
      { dim: "Score honesty", us: US_HONESTY, them: "Match scores without an audit trail.", usWins: true },
      { dim: "Job tracking (CRM)", us: "Basic application tracker in your account.", them: "Their core strength — a genuinely good job-search CRM with a browser extension.", usWins: false },
      { dim: "Resume builder", us: "Free structured builder with typeset PDF/DOCX export.", them: "Polished builder with more templates; deeper customization on paid.", usWins: false },
      { dim: "Pricing model", us: US_PRICING, them: "Freemium with weekly/monthly subscription for advanced features (as of mid-2026).", usWins: true },
      { dim: "Freelance / career-changer support", us: "Dedicated products: career-change bridge in every scan, Freelance Boost for project-based careers.", them: "General-purpose; no dedicated career-changer tooling.", usWins: true },
    ],
  },
  rezi: {
    slug: "rezi",
    name: "Rezi",
    intro: "Rezi is an AI resume builder — generation-first, with ATS-friendly templates.",
    rows: [
      { dim: "Diagnostic depth on YOUR resume", us: US_FREE, them: "Focused on generating new content in its builder; analysis of an uploaded resume is secondary.", usWins: true },
      { dim: "Verified output", us: "Every quoted line checked against your document; nothing invented survives to the report.", them: "AI-generated content without an equivalent verification claim.", usWins: true },
      { dim: "Template library", us: "One clean, ATS-safe format in the builder.", them: "Larger template selection — their strength.", usWins: false },
      { dim: "Pricing model", us: US_PRICING, them: "Subscription with a lifetime-purchase option (as of mid-2026).", usWins: true },
      { dim: "Score honesty", us: US_HONESTY, them: "A single Rezi Score number.", usWins: true },
    ],
  },
  kickresume: {
    slug: "kickresume",
    name: "Kickresume",
    intro: "Kickresume is a design-forward resume builder with AI writing help and a large template gallery.",
    rows: [
      { dim: "Visual templates", us: "One clean, deliberately ATS-safe format.", them: "Beautiful, design-rich templates — their strength (though heavy designs can hurt ATS parsing; our vendor checks show exactly how).", usWins: false },
      { dim: "ATS analysis", us: US_FREE, them: "A resume checker exists, but the product's center of gravity is the builder.", usWins: true },
      { dim: "Score honesty", us: US_HONESTY, them: "Checker feedback without a verified audit trail.", usWins: true },
      { dim: "Pricing model", us: US_PRICING, them: "Freemium with subscription for premium templates and AI (as of mid-2026).", usWins: true },
      { dim: "Languages", us: "10 languages including full Spanish resume detection.", them: "Multi-language templates — broadly comparable here.", usWins: false },
    ],
  },
  enhancv: {
    slug: "enhancv",
    name: "Enhancv",
    intro: "Enhancv is a modern resume builder emphasizing personal-brand design and content suggestions.",
    rows: [
      { dim: "Design customization", us: "One clean, ATS-safe format.", them: "Highly customizable, modern designs — their strength (with the usual ATS-parsing tradeoffs; our per-vendor checks measure exactly those).", usWins: false },
      { dim: "Diagnostic analysis", us: US_FREE, them: "A content checker inside the builder; lighter than a standalone diagnostic.", usWins: true },
      { dim: "Verified output", us: "Every quote verified against your document; provenance labels on all expectations.", them: "No equivalent verification claim.", usWins: true },
      { dim: "Pricing model", us: US_PRICING, them: "Subscription (as of mid-2026).", usWins: true },
    ],
  },
};
