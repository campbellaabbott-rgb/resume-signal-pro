// @vitest-environment node
/**
 * RECRUITEE TRIPWIRE (board .103 rider): A KEYLESS RECRUITEE READ NEEDS A
 * RECORDED DECISION BEFORE THE KEY IS REQUIRED.
 *
 * Recruitee's keyless /api/offers access ends on 2027-02-10 (the legal ledger,
 * 2026-11-16), and about 2,016 catalogued boards read it with no key and no
 * recorded decision (OD18, the feed letter). Nothing in the code dates that.
 * This test turns red on 2027-01-15, four weeks before, while any function
 * still reads the keyless path and no decision is written below. To clear it,
 * either move every reader off the keyless path, or record the decision in
 * DECISION with its date and who made it.
 *
 * Comments are stripped before matching, so a reader named only in a comment
 * (sources.ts's header) does not count, and the matcher is checked to find
 * today's readers, so the wire cannot pass because it looks at nothing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const RED_FROM = Date.parse("2027-01-15T00:00:00Z");
/** The owner's dated decision on keyless Recruitee reads (OD18), once one exists. */
const DECISION: string | null = null;

const READERS = [
  "supabase/functions/job-board/index.ts",
  "supabase/functions/_shared/application-form.ts",
  "supabase/functions/job-board/sources.ts",
];
const KEYLESS = /recruitee\.com\/api\/offers\//g;
const codeOf = (src: string) => ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText;
const keylessReads = (src: string) => (codeOf(src).match(KEYLESS) ?? []).length;
const readersToday = () => READERS
  .map((f) => [f, keylessReads(readFileSync(resolve(__dirname, "../..", f), "utf8"))] as const)
  .filter(([, n]) => n > 0);
const verdict = (now: number, readers: ReadonlyArray<unknown>, decision: string | null) =>
  now >= RED_FROM && readers.length > 0 && !decision ? "red" : "green";

describe("the matcher", () => {
  it("counts a keyless read in code and ignores one named only in a comment", () => {
    expect(keylessReads("const u = `https://${s.token}.recruitee.com/api/offers/`;")).toBe(1);
    expect(keylessReads("//   Recruitee:  https://{token}.recruitee.com/api/offers/\nconst x = 1;")).toBe(0);
    expect(keylessReads("/** https://acme.recruitee.com/api/offers/ */\nexport {};")).toBe(0);
  });

  it("finds today's keyless readers: the board's feed and detail reads, and the application form", () => {
    expect(Object.fromEntries(readersToday())).toEqual({
      "supabase/functions/job-board/index.ts": 2,
      "supabase/functions/_shared/application-form.ts": 1,
    });
  });
});

describe("the date", () => {
  it("is red from 2027-01-15 while a keyless reader stands and no decision is recorded, and not a day before", () => {
    const readers = readersToday();
    expect(verdict(RED_FROM - 86_400_000, readers, null)).toBe("green");
    expect(verdict(RED_FROM, readers, null)).toBe("red");
    expect(verdict(RED_FROM, readers, "OD18 2027-01-10: example")).toBe("green");
    expect(verdict(RED_FROM, [], null)).toBe("green");
  });

  it("today: a keyless Recruitee read has a recorded decision, or it is not yet 2027-01-15", () => {
    const readers = readersToday();
    expect(
      verdict(Date.now(), readers, DECISION),
      `Recruitee's keyless access ends 2027-02-10. Still reading it: ${readers.map(([f, n]) => `${f} (${n})`).join(", ")}. Move them to a key, or record the owner's decision (OD18) in DECISION.`,
    ).toBe("green");
  });
});
