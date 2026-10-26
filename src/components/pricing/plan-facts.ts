/**
 * EVERY NUMBER THE PRICING PAGE PRINTS, IN ONE PLACE, EACH NAMED WITH THE
 * SOURCE IT MIRRORS.
 *
 * The page never types a price, a limit or a retention period into a
 * sentence: every string interpolates one of these. Each value is a mirror of
 * the constant that decides it, and src/test/hp-pricing-mirrors.test.ts reads
 * that constant and fails on drift. Where the deciding constant lives on a
 * branch that has not merged yet (wave 4), the test pins it the day the file
 * appears, and docs/homepage-pricing/README.md lists the switch-over pin.
 *
 *   FULL_ANALYSIS_PRICE_USD   src/config/products.ts PRODUCTS.fullAnalysis.priceUsd
 *   PRO_PRICE_USD             supabase/functions/_shared/pro.ts PRO_PRICE_CENTS / 100
 *   BUILDER_PRICE_USD         src/config/builder-plan.ts BUILDER_PLAN_PRICE_USD (wave 4)
 *   BUILDER_PROPOSED_PER_DAY  supabase/functions/public-api BUILDER_PROPOSED.perDay (wave 4)
 *   FREE_SCANS_PER_DAY        supabase/functions/free-keyword-scan FREE_SCANS_PER_DAY
 *   SIGNED_IN_SCANS_PER_DAY   supabase/functions/free-keyword-scan SIGNED_IN_SCANS_PER_DAY
 *   WRITING                   src/config/writing-allowance.ts WRITING_ALLOWANCE (wave 4)
 *   FREE_KEY_DAILY_QUOTA      src/config/mcp-tools.ts MCP_FREE_KEY_DAILY_QUOTA
 *   MCP_FIT_FREE_PER_DAY      src/config/mcp-tools.ts MCP_FIT_FREE_PER_DAY (wave 4)
 *   WITHHELD_SOURCE_NAMES     src/config/mcp-tools.ts MCP_WITHHELD_SOURCES, by display name
 *   FREE_REPORT_DAYS          src/lib/resume-retention.ts REPORT_CACHE_DAYS
 *   FULL_ANALYSIS_LINK_DAYS   src/lib/resume-retention.ts SHARED_ANALYSIS_DAYS
 *
 * mcp-tools.ts is about 1,200 lines and builder-plan.ts is not on this base,
 * so the page reads these mirrors instead of importing either.
 */
import { REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS } from "@/lib/resume-retention";

export const FULL_ANALYSIS_PRICE_USD = 5;
export const PRO_PRICE_USD = 45;
export const BUILDER_PRICE_USD = 49;
export const BUILDER_PROPOSED_PER_DAY = 5000;

export const FREE_SCANS_PER_DAY = 7;
export const SIGNED_IN_SCANS_PER_DAY = 15;

/** The writing tools: one of each a UTC day on a free account; Pro five a day and sixty a month. */
export const WRITING = Object.freeze({
  freePerToolPerDay: 1,
  proPackagesPerDay: 5,
  proPackagesPerMonth: 60,
});

export const FREE_KEY_DAILY_QUOTA = 1000;
export const MCP_FIT_FREE_PER_DAY = 25;

/** The source keys the data API and the AI connector leave out, and the names a reader knows them by. */
export const WITHHELD_SOURCES: readonly string[] = ["usajobs", "smartrecruiters"];
export const WITHHELD_SOURCE_NAMES: Readonly<Record<string, string>> = {
  smartrecruiters: "SmartRecruiters",
  usajobs: "USAJOBS",
};

export const FREE_REPORT_DAYS: number = REPORT_CACHE_DAYS;
export const FULL_ANALYSIS_LINK_DAYS: number = SHARED_ANALYSIS_DAYS;

/**
 * The day the limits table was last read against the server constants above.
 * Printed under the table ("Limits as of ..."), so it names its date basis.
 * Bump it in the commit that changes any value in this file.
 */
export const LIMITS_AS_OF = "2026-10-17";

/** The places a buyer cannot buy from yet, as the page names them (owner decisions 13 and G3). */
export const REFUSED_TERRITORIES = ["EU", "EEA", "UK", "IN"] as const;
