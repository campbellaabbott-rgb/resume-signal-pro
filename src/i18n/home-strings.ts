/**
 * THE HOMEPAGE'S ENGLISH STRINGS, ADDED WHEN THE HOMEPAGE'S CODE LOADS
 * (review round of 2026-10-26).
 *
 * In the eager glob (src/i18n/index.ts) they rode in the entry chunk every
 * page loads. Every component that renders a home.* string imports this
 * module for its side effect, so the strings arrive in the homepage's own
 * chunk and are in place before any of those components renders. Other
 * languages' home shards load with their main file (index.ts loadLocale).
 * A test fails on a translating component under src/components/home or
 * src/pages/home that does not import it.
 */
import i18n from "./index";
import type { Bundle } from "./merge-shards";
import home from "./shards/home/en.json";

i18n.addResourceBundle("en", "translation", home as Bundle, true, false);
