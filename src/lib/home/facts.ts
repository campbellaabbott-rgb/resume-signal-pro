/**
 * THE FIXED FACTS THE HOMEPAGE PRINTS, EACH READ FROM WHERE IT IS TRUE.
 *
 * Imported where a frontend module already holds the value; mirrored, with a
 * test that reads the runtime that enforces it, where none does yet:
 *
 *   scan allowance   supabase/functions/free-keyword-scan/index.ts
 *                    (FREE_SCANS_PER_DAY, SIGNED_IN_SCANS_PER_DAY), held by
 *                    src/test/hp-home-mirrors.test.ts. The corrected spec's
 *                    src/config/scan-allowance.ts replaces this mirror once it
 *                    exists (docs/homepage-pricing/README.md, switch-over).
 *   writing tools    one of each a day on a free account, five of each a day
 *                    and sixty of each a month on Pro (owner decision
 *                    2026-10-17); wave 4's WRITING_ALLOWANCE replaces these.
 *   prices           src/config/products.ts.
 *   retention        src/lib/resume-retention.ts.
 *   scan time        src/config/scan-timing.ts.
 */
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import { SCAN_RESULTS_WITHIN_SECONDS } from "@/config/scan-timing";
import { REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS, TEMP_RESUME_HOURS } from "@/lib/resume-retention";

export const HOME_FREE_SCANS_PER_DAY = 7;
export const HOME_SIGNED_IN_SCANS_PER_DAY = 15;

export const HOME_FREE_WRITING_PER_DAY = 1;
export const HOME_PRO_WRITING_PER_DAY = 5;
export const HOME_PRO_WRITING_PER_MONTH = 60;

export const HOME_FULL_ANALYSIS_USD: number = PRODUCTS.fullAnalysis.priceUsd;
export const HOME_PRO_USD_PER_MONTH: number = SUBSCRIPTIONS.pro.priceUsd;

export const HOME_SCAN_SECONDS: number = SCAN_RESULTS_WITHIN_SECONDS;
export const HOME_RESUME_TEXT_HOURS: number = TEMP_RESUME_HOURS;
export const HOME_FREE_REPORT_DAYS: number = REPORT_CACHE_DAYS;
export const HOME_PAID_REPORT_DAYS: number = SHARED_ANALYSIS_DAYS;
