/**
 * SHORTLIST REDACTION NAMED THE CATEGORY IT HID (S14X-023).
 *
 * WHAT WAS WRONG. Every redaction left a labelled mark in the text the scorer
 * read: [REDACTED-FAMILY] where "Maternity leave" had been,
 * [REDACTED-VETERAN], [REDACTED-CITIZENSHIP], [REDACTED-ADA],
 * [REDACTED-AFFINITY]. The mark told the model exactly which protected
 * category the candidate belonged to, which is the fact redaction exists to
 * hide, and the prompt itself named "[REDACTED-ADA] content".
 *
 * WHAT HOLDS NOW: the scored text carries one neutral mark, [REDACTED]; a
 * leave reads "Career break" so the gap stays and the reason goes; the audit
 * (exclusionsApplied) still names every category that fired, and the
 * prompt names no category.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactForScoring } from "../../supabase/functions/shortlist-evaluate/redaction";

describe("the scored text names no protected category", () => {
  const r = redactForScoring("Jane Okafor\nEXPERIENCE\nMaternity leave, 2019 – 2020\nU.S. Army veteran\nRequires visa sponsorship\nI have ADHD\nMember of the Society of Women Engineers\nReligion: Hindu\nDate of birth: 03/14/1970");

  it("carries no [REDACTED-<category>] mark, only the neutral one", () => {
    expect(r.redacted).not.toMatch(/\[REDACTED-[A-Z0-9_]+\]/);
    expect(r.redacted).toContain("[REDACTED]");
  });

  it("reads a leave as a career break, keeping the dates", () => {
    expect(r.redacted).toContain("Career break, 2019 – 2020");
    expect(r.redacted).not.toMatch(/maternity/i);
  });

  it("still names every category in the audit", () => {
    const features = r.exclusionsApplied.map((e) => e.feature);
    for (const f of ["family_status", "veteran_status", "citizenship_status", "disability_mention", "affinity_group", "religion", "date_of_birth"]) {
      expect(features, f).toContain(f);
    }
  });
});

describe("the scorer's instructions name no category either", () => {
  const src = readFileSync(join(process.cwd(), "supabase/functions/shortlist-evaluate/index.ts"), "utf8");
  const prompt = src.slice(src.indexOf("const systemPrompt"), src.indexOf("Return via the submit_evaluation tool."));

  it("tells the model about one neutral mark and career breaks", () => {
    expect(prompt).not.toMatch(/\[REDACTED-/);
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).toMatch(/career breaks must not lower any score/);
  });

  it("records the new prompt as its own version", () => {
    expect(src).toMatch(/const PROMPT_VERSION = "shortlist-v3";/);
  });
});
