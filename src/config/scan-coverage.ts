/**
 * HOW MANY INDUSTRIES THE SCANNER DETECTS, FOR SURFACES THAT STATE IT.
 *
 * The number is the detection table's own (INDUSTRY_KEYWORDS in
 * supabase/functions/free-keyword-scan/industry-detection.ts). That module is
 * far too large for the homepage bundle, so the count is written here and a
 * test holds it equal to the table (src/test/w4b-the-scanner-landing-states-
 * the-counts-the-product-has.test.tsx). The Hero printed "59" over a table of
 * 58, beside "10 languages" over eight (S12-047): both are now this constant
 * and LANGUAGE_COUNT (src/i18n/languages.ts), never typed into the markup.
 */
export const DETECTED_INDUSTRY_COUNT = 58;
