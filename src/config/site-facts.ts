/**
 * THE FACTS THE HOME PAGE AND THE SCANNER PAGES BOTH PRINT, IN ONE PLACE.
 *
 * The home page and the scanner landers (/resume-checker, /ats-resume-test,
 * /resume-score) each spelled out how many languages the scanner reads, how
 * many hiring systems the board reads, how long a résumé is kept and how many
 * industries the detector knows, and they drifted apart (design audit DX12).
 * Every one of them now reads this module, and every value here is derived
 * from the list that is the truth, never retyped:
 *
 *   languages       src/i18n/index.ts (the interface languages)
 *   hiring systems  src/config/ats-vendors.ts SERVING_SOURCES (dormant ones excluded)
 *   retention       src/lib/resume-retention.ts (held to the code by its own test)
 *   industries      the scanner's detection table: 58 entries, held equal to the
 *                   table by src/test/the-homepage-states-the-scanners-own-industry-count.test.ts
 *                   once the home page reads it from here
 */
import { LANGUAGE_COUNT } from "@/i18n";
import { SERVING_SOURCES } from "@/config/ats-vendors";
import { REPORT_CACHE_DAYS, TEMP_RESUME_HOURS } from "@/lib/resume-retention";

export const SITE_LANGUAGE_COUNT: number = LANGUAGE_COUNT;

/** Hiring systems the board serves rows from today. */
export const SERVING_SYSTEM_COUNT: number = SERVING_SOURCES.length;

/** How long an uploaded or pasted résumé's text is held, in hours. */
export const RESUME_TEXT_HOURS: number = TEMP_RESUME_HOURS;

/** How long a finished free report is cached, in days. */
export const FREE_REPORT_DAYS: number = REPORT_CACHE_DAYS;

/** Industries the scanner's detection table holds. */
export const DETECTED_INDUSTRY_COUNT = 58;
