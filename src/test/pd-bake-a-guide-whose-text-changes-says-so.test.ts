/**
 * A GUIDE WHOSE TEXT CHANGES SAYS SO (SEO report 2026-10-12, SEO-025).
 *
 * /guides/what-resume-score-means carried lastmod and dateModified 2026-07-06
 * while its text changed on 2026-10-08 and again on 2026-10-10: the bake took
 * the guide's own `updated` as its date, and nobody moved `updated`. The bake
 * now dates a guide by the later of `updated` and the day its fingerprint last
 * changed (prerender-pages.mjs pageDates), and this file is the other half:
 * it records each guide's text hash beside the `updated` it shipped with, and
 * fails when the text moves while `updated` stays where it was.
 *
 * Changed a guide on purpose? Move its `updated` to the day of the change,
 * then record the new hash and date below.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { GUIDES, type Guide } from "@/data/guides";

const RECORDED: Record<string, { hash: string; updated: string }> = {
  "why-resumes-get-rejected": { hash: "16227d3ef5313fba", updated: "2026-07-06" },
  "ats-auto-rejection-myth": { hash: "393684fd362a65c7", updated: "2026-07-06" },
  "resume-keywords-guide": { hash: "3eeb80151ceb3f02", updated: "2026-07-06" },
  "career-change-resume": { hash: "4104274e7d696b5e", updated: "2026-07-06" },
  "resume-format-that-survives-ats": { hash: "f9f66986ed7052f9", updated: "2026-07-06" },
  "freelance-work-on-resume": { hash: "a233ea58ac95e571", updated: "2026-07-08" },
  "fractional-roles-on-resume": { hash: "f13365b34d992b63", updated: "2026-07-08" },
  "what-resume-score-means": { hash: "3b87cd6327e2fd30", updated: "2026-10-10" },
  "how-the-apply-agent-works": { hash: "6c15fd28569af597", updated: "2026-10-12" },
};

/** What a guide says: everything a reader or a crawler reads of it. */
export const guideText = (g: Pick<Guide, "title" | "h1" | "description" | "tldr" | "sections" | "faqs">) =>
  JSON.stringify([g.title, g.h1, g.description, g.tldr, g.sections, g.faqs ?? []]);
export const guideHash = (g: Parameters<typeof guideText>[0]) => createHash("sha1").update(guideText(g)).digest("hex").slice(0, 16);

/** The offence, or null: text moved and `updated` did not. */
export function staleUpdated(g: Guide, recorded: { hash: string; updated: string } | undefined): string | null {
  if (!recorded) return `${g.slug} has no recorded hash: record it`;
  if (guideHash(g) !== recorded.hash && g.updated <= recorded.updated) {
    return `${g.slug}: its text changed but \`updated\` is still ${g.updated}; move it to the day of the change and record the new hash`;
  }
  return null;
}

describe("a guide whose text changes moves its stated date", () => {
  it("every guide is recorded, and none changed under an unmoved date", () => {
    const offences = Object.values(GUIDES).map((g) => staleUpdated(g, RECORDED[g.slug])).filter(Boolean);
    expect(offences).toEqual([]);
    expect(Object.keys(RECORDED).sort()).toEqual(Object.keys(GUIDES).sort());
  });

  it("teeth: one changed word under the same date fails; the same word with a later date passes", () => {
    const g = GUIDES["what-resume-score-means"];
    const edited = { ...g, tldr: `${g.tldr} One more sentence.` };
    expect(staleUpdated(edited, RECORDED[g.slug])).toMatch(/text changed but `updated` is still/);
    expect(staleUpdated({ ...edited, updated: "2026-10-13" }, RECORDED[g.slug])).toBeNull();
  });
});
