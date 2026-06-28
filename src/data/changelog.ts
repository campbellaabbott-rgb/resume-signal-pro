// Public changelog content. Add new entries to the TOP of this array as features
// ship — newest first. Keep entries written for users (what changed and why it
// helps them), not engineering changelogs (no file names, no internal jargon).
//
// Title and description text live in src/i18n/locales/*.json under
// `changelogEntries.<id>.title` / `.description` (en.json is the source of
// truth), not inline here — the `id` below is just the lookup key. When
// adding a new entry, add the matching `changelogEntries.<id>` block to
// en.json AND translate it into the other 8 locale files, or it will show up
// untranslated (or trip the key-parity test) for non-English users.

export type ChangelogTag = "new" | "improved" | "fixed";

export interface ChangelogEntry {
  id: string; // key into changelogEntries.<id>.title/.description in the locale files
  date: string; // ISO date, e.g. "2026-06-26"
  tags: ChangelogTag[];
}

export const changelog: ChangelogEntry[] = [
  { id: "yourReportsSpeakYourLanguage", date: "2026-06-28", tags: ["improved"] },
  { id: "translatedHomepageAndScanFlow", date: "2026-06-28", tags: ["improved"] },
  { id: "fixedAtsDefenseDelivery", date: "2026-06-28", tags: ["fixed"] },
  { id: "moreReliableDownloads", date: "2026-06-28", tags: ["fixed"] },
  { id: "clearerMessagesHighDemand", date: "2026-06-28", tags: ["improved"] },
  { id: "realIndustryComparisons", date: "2026-06-28", tags: ["improved"] },
  { id: "moreSpecificKeywordBulletInsights", date: "2026-06-28", tags: ["improved"] },
  { id: "fixedWordUploads", date: "2026-06-27", tags: ["fixed"] },
  { id: "purchaseRecoveryFix", date: "2026-06-27", tags: ["fixed"] },
  { id: "checkoutReliabilityFixes", date: "2026-06-27", tags: ["fixed"] },
  { id: "moreMechanicalAtsChecks", date: "2026-06-27", tags: ["new"] },
  { id: "faqSectionTranslationFixes", date: "2026-06-27", tags: ["fixed"] },
  { id: "publicChangelog", date: "2026-06-26", tags: ["new"] },
  { id: "applyAssistant", date: "2026-06-26", tags: ["new"] },
  { id: "atsParseSimulation", date: "2026-06-25", tags: ["new"] },
  { id: "realSemanticJobMatching", date: "2026-06-25", tags: ["improved"] },
  { id: "resumeBuilder", date: "2026-06-24", tags: ["new"] },
  { id: "deeperInterviewCoachCareerPath", date: "2026-06-24", tags: ["improved"] },
  { id: "moreHonestScoring", date: "2026-06-23", tags: ["fixed"] },
  { id: "fasterPageLoads", date: "2026-06-22", tags: ["improved"] },
  { id: "scannedPdfDetection", date: "2026-06-21", tags: ["fixed"] },
];
