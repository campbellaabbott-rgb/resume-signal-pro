/**
 * WHAT THE BUILDER IMPORTS, AND HOW A REPORT'S REWRITES LAND (platform sweep
 * L3-11, L3-12).
 *
 * L3-11. A first /builder visit saved the empty starting résumé as a draft,
 * and any saved draft made the builder skip the import without asking. So
 * "Build a clean, structured version of this résumé" from the free report, or
 * "Open in builder" after a paid rewrite, opened an empty page, or last
 * week's résumé for this week's scan. Now an empty draft counts as no draft
 * and is never saved; the draft remembers a fingerprint of the text it was
 * imported from, and when this tab holds a different scan the builder asks
 * once whether to replace the draft with it.
 *
 * L3-12. The rewrites matched any bullet that contained, or was contained in,
 * a rewrite's "before" text, and a rewrite was never used up: a short bullet
 * ("Sales") took a long bullet's rewrite, so the document lost a real line and
 * held one sentence twice, and the toast counted both. Exact matches go
 * first, a near match must be about the same length, and each rewrite is used
 * once.
 */
import type { BuilderResume } from "@/types/resume-builder";

/** Where the draft's source fingerprint is kept, beside the draft itself. */
export const IMPORTED_FROM_KEY = "resumeBuilderImportedFrom";

/** Shortest text worth sending to the structured parser. */
export const MIN_IMPORT_CHARS = 50;

const filled = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/** True when anything in the résumé was typed or imported. */
export function builderResumeHasContent(r: BuilderResume | null | undefined): boolean {
  if (!r) return false;
  if (Object.values(r.contact ?? {}).some(filled) || filled(r.summary)) return true;
  if ((r.skills ?? []).some(filled) || (r.certifications ?? []).some(filled)) return true;
  if ((r.experience ?? []).some((e) =>
    [e.company, e.title, e.location, e.startDate, e.endDate].some(filled) || (e.bullets ?? []).some(filled))) return true;
  return (r.education ?? []).some((e) =>
    [e.school, e.degree, e.field, e.startDate, e.endDate, e.details].some(filled));
}

/**
 * A short change detector for the scanned text (FNV-1a over the trimmed
 * text). Not a secret and not an identifier: it only tells one scan from the
 * next, in the browser that holds both.
 */
export function textFingerprint(text: string): string {
  let h = 0x811c9dc5;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16)}`;
}

export type ImportDecision = "none" | "import" | "ask" | "ask-fixes" | "keep";

/**
 * What the builder does on opening:
 *   none       no scanned text in this tab to import;
 *   import     no draft with content: import without asking;
 *   ask-fixes  the report's "fixes applied" handoff over a draft: confirm;
 *   ask        a draft, and this tab holds a scan not yet offered: confirm;
 *   keep       the draft came from (or was already offered) this scan.
 *
 * An EMPTY draft keeps too when this scan was already imported or offered
 * (S11-144): "Start Over" clears the draft and marks the tab's scan as
 * offered, so leaving before typing does not re-import (and re-parse) it on
 * the next visit. The report's "fixes applied" handoff is a fresh request and
 * still imports.
 */
export function importDecision(opts: {
  draft: BuilderResume | null;
  sessionText: string | null | undefined;
  hasFixes: boolean;
  lastOffered: string | null;
}): ImportDecision {
  const text = (opts.sessionText ?? "").trim();
  if (text.length < MIN_IMPORT_CHARS) return "none";
  if (!builderResumeHasContent(opts.draft)) {
    return !opts.hasFixes && opts.lastOffered === textFingerprint(text) ? "keep" : "import";
  }
  if (opts.hasFixes) return "ask-fixes";
  return opts.lastOffered === textFingerprint(text) ? "keep" : "ask";
}

const normalizeBullet = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A near match: one contains the other and the shorter is at least this share of the longer. */
const NEAR_LENGTH_RATIO = 0.8;

/**
 * Puts the report's rewritten bullets in place of the originals. Exact
 * matches (after normalising case and punctuation) are taken first; then a
 * bullet and a rewrite's "before" of about the same length where one contains
 * the other. Each rewrite replaces one bullet at most.
 */
export function applyScanRewrites(
  resume: BuilderResume,
  rewrites: ReadonlyArray<{ before: string; after: string }>,
): { resume: BuilderResume; applied: number } {
  const pool = rewrites
    .map((r) => ({ key: normalizeBullet(String(r.before ?? "")), after: String(r.after ?? ""), used: false }))
    .filter((r) => r.key && r.after.trim());
  const slots = resume.experience.map((e) => e.bullets.map((b) => ({ key: normalizeBullet(b), to: null as string | null })));
  const near = (a: string, b: string) =>
    (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= NEAR_LENGTH_RATIO;

  for (const pass of [(a: string, b: string) => a === b, near]) {
    for (const entry of slots) {
      for (const slot of entry) {
        if (!slot.key || slot.to !== null) continue;
        const hit = pool.find((r) => !r.used && pass(slot.key, r.key));
        if (hit) {
          hit.used = true;
          slot.to = hit.after;
        }
      }
    }
  }

  let applied = 0;
  const experience = resume.experience.map((entry, i) => ({
    ...entry,
    bullets: entry.bullets.map((b, j) => {
      const to = slots[i][j].to;
      if (to === null) return b;
      applied += 1;
      return to;
    }),
  }));
  return { resume: { ...resume, experience }, applied };
}
