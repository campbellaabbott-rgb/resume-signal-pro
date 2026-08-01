/**
 * The seams around the tailored cover note — the parts no unit test of the
 * gate itself can see.
 *
 * `cover-note.test.ts` proves the gate accepts honest notes and rejects
 * invented ones. That is necessary and not sufficient: a perfect gate wired to
 * nothing sends the generic note forever, and the symptom is an ABSENCE, which
 * is exactly what the fallback is designed to look like. These pin the wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPacket, COVER_NOTE_FIELD_KEY } from "../../supabase/functions/_shared/submission-packet";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the reserved key is mirrored across runtimes", () => {
  it("the worker's copy of COVER_NOTE_FIELD_KEY matches the packet builder's", () => {
    // Deno one side, Node the other — they cannot import from each other, so
    // the constant is hand-copied and this is the only thing stopping a rename
    // on one side from silently sending the generic note forever.
    const worker = read("worker/src/index.ts");
    const m = worker.match(/const COVER_NOTE_FIELD_KEY = "([^"]+)"/);
    expect(m, "worker/src/index.ts no longer declares COVER_NOTE_FIELD_KEY").toBeTruthy();
    expect(m![1]).toBe(COVER_NOTE_FIELD_KEY);
  });

  it("the worker actually prefers the tailored note over the standing one", () => {
    const worker = read("worker/src/index.ts");
    // The override has to WIN. `a.coverNote || tailored` would typecheck, pass
    // every other test here, and never use a tailored note whenever the
    // candidate had written one — which is every case that matters.
    expect(worker).toMatch(/coverNote:\s*tailored\s*\|\|/);
    expect(worker).toMatch(/toStanding\(claimed\.answers,\s*claimed\.packet\?\.fields\)/);
  });
});

describe("the note is carried but never counted", () => {
  const questions = [
    { label: "Full name", required: true },
    { label: "Email", required: true },
  ];
  const profile = { fullName: "Jane Okafor", email: "jane@example.com" };

  it("adds the note to fields without inflating autoFilled", () => {
    const without = buildPacket({
      questions, profile, standing: {}, drafted: [], automationTier: "auto",
    });
    const withNote = buildPacket({
      questions, profile, standing: {}, drafted: [], automationTier: "auto",
      coverNote: { value: "A note about my work.", tailored: true },
    });
    expect(withNote.fields.length).toBe(withoutNoteFieldCount(without) + 1);
    // The number a candidate reads as "how much of the form did it fill".
    expect(withNote.autoFilled).toBe(without.autoFilled);
    expect(withNote.total).toBe(without.total);
  });

  it("records whether the note was tailored or sent as written", () => {
    const tailored = buildPacket({
      questions, profile, standing: {}, drafted: [], automationTier: "auto",
      coverNote: { value: "x".repeat(50), tailored: true },
    }).fields.find((f) => f.key === COVER_NOTE_FIELD_KEY);
    const verbatim = buildPacket({
      questions, profile, standing: {}, drafted: [], automationTier: "auto",
      coverNote: { value: "x".repeat(50), tailored: false },
    }).fields.find((f) => f.key === COVER_NOTE_FIELD_KEY);
    // A reviewer must be able to tell a generated sentence from the
    // candidate's own words without reading both and guessing.
    expect(tailored?.source).toBe("drafted");
    expect(verbatim?.source).toBe("standing");
  });

  it("cannot make an otherwise-empty packet look ready", () => {
    const p = buildPacket({
      questions: [{ label: "Upload CV", required: true, fieldType: "file" }],
      profile: {}, standing: {}, drafted: [], automationTier: "auto",
      coverNote: { value: "A note.", tailored: true },
    });
    // The CV is missing, so this packet blocks. The note must not rescue it.
    expect(p.ready).toBe(false);
  });

  const withoutNoteFieldCount = (p: ReturnType<typeof buildPacket>) => p.fields.length;
});

describe("tailoring stays opt-in", () => {
  it("the column defaults to false", () => {
    const sql = read("supabase/migrations/20260801220000_tailor_cover_note.sql");
    expect(sql).toMatch(/tailor_cover_note\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
  });

  it("apply-agent only tailors when the candidate switched it on", () => {
    const fn = read("supabase/functions/apply-agent/index.ts");
    expect(fn).toMatch(/if \(m\.tailor_cover_note &&/);
  });

  it("a rejected draft falls back rather than blocking the application", () => {
    const fn = read("supabase/functions/apply-agent/index.ts");
    // The fallback is assigned BEFORE the attempt, so every failure path —
    // throw, null, timeout — lands on the candidate's own note by default.
    const assignIdx = fn.indexOf("{ value: t(m.cover_note), tailored: false }");
    const attemptIdx = fn.indexOf("if (m.tailor_cover_note &&");
    expect(assignIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(attemptIdx);
    // And nothing in the tailoring path may push a blocker.
    const slice = fn.slice(attemptIdx, fn.indexOf("const packet = buildPacket"));
    expect(slice).not.toMatch(/blockers\.push/);
  });
});

describe("the profile copy cannot go stale", () => {
  const panel = read("src/components/account/ApplyProfilePanel.tsx");

  it("does not promise the note is never rewritten while tailoring exists", () => {
    // The old hint said flatly that this exact text reaches every employer and
    // is not rewritten per job. That was true until the toggle shipped. If the
    // conditional is ever collapsed back to the single string, this fails.
    expect(panel).toContain("applyProfile.coverNoteHintTailored");
    expect(panel).toMatch(/p\.tailor_cover_note\s*\n?\s*\?\s*t\("applyProfile\.coverNoteHintTailored"/);
  });

  it("the tailored hint promises exactly what the gate enforces", () => {
    const hint = panel.slice(panel.indexOf("applyProfile.coverNoteHintTailored"));
    expect(hint.slice(0, 600)).toMatch(/résumé and the posting actually say/);
    expect(hint.slice(0, 600)).toMatch(/sent exactly as written/);
  });
});
