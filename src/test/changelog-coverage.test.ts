// Every changelog entry id must have title+description text in every locale.
// Exists because a changelog.ts id shipped with NO locale text (an insertion
// script died mid-run) and the key-parity test couldn't catch it — all nine
// locales were EQUALLY missing the key, so parity held while the page would
// have rendered a raw-key fallback.
import { describe, it, expect } from "vitest";
import { changelog } from "../data/changelog";
import en from "../i18n/changelog/en.json";
import es from "../i18n/changelog/es.json";
import hi from "../i18n/changelog/hi.json";

// Changelog copy moved OUT of the main locale bundle 2026-07-26 (81KB that
// every visitor downloaded for a page almost nobody opens); it now lives in
// src/i18n/changelog/ and loads on demand. The completeness rule is unchanged.
const locales = { en, es, hi } as const; // parity test guarantees the rest match en

describe("changelog ↔ locale coverage", () => {
  it("every entry id has text in the locales", () => {
    for (const entry of changelog) {
      for (const [lang, j] of Object.entries(locales)) {
        const e = (j as any).changelogEntries?.[entry.id];
        expect(e, `${lang}: missing changelogEntries.${entry.id}`).toBeTruthy();
        expect(e.title?.length, `${lang}: empty title for ${entry.id}`).toBeGreaterThan(4);
        expect(e.description?.length, `${lang}: empty description for ${entry.id}`).toBeGreaterThan(20);
      }
    }
  });
});
