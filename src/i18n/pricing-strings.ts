/**
 * THE PRICING PAGE'S ENGLISH STRINGS, ADDED WHEN THE PRICING PAGE'S CODE
 * LOADS (review round of 2026-10-26; see home-strings.ts for why). Every
 * component that renders a pricingPlans.* string imports this module.
 */
import i18n from "./index";
import type { Bundle } from "./merge-shards";
import pricing from "./shards/pricing/en.json";

i18n.addResourceBundle("en", "translation", pricing as Bundle, true, false);
