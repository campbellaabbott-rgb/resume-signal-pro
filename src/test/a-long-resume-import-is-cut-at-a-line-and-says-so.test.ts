// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * A LONG RÉSUMÉ IMPORT IS CUT AT A LINE, AND SAYS SO (S14X-071: C-S14-042),
 * the function.
 *
 * WHAT WAS WRONG. parse-resume-structured sent the model
 * resumeText.slice(0, 20000): a longer résumé was cut wherever character
 * 20,000 fell, often mid-word, and the answer carried nothing to say the rest
 * had been left out, so the builder could not tell the person.
 *
 * WHAT HOLDS NOW. The cap is unchanged (raising it is a cost decision), but
 * the cut falls at the last line break at or below it, and the answer says
 * resumeTruncated, importedChars and totalChars. The handler is run as
 * shipped, with only the network faked: the model is shown the cut text.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_MAX_CHARS, importSlice } from "../../supabase/functions/parse-resume-structured/import-slice";
import { WritingWorld, loadWriter, post, toolReply } from "./helpers/writing-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const line = (i: number) => `Line ${i}: led the quarterly planning for the regional sales team.`;
const resumeOf = (chars: number) => {
  const out: string[] = [];
  let n = 0;
  while (out.join("\n").length < chars) out.push(line(n++));
  return out.join("\n").slice(0, chars);
};

describe("importSlice", () => {
  it("keeps the cap at 20,000 characters", () => {
    expect(IMPORT_MAX_CHARS).toBe(20000);
  });

  it("a 31,000-character résumé is cut at a line break at or below the cap, and says so", () => {
    const text = resumeOf(31000);
    const s = importSlice(text);
    expect(s.truncated).toBe(true);
    expect(s.totalChars).toBe(31000);
    expect(s.importedChars).toBeLessThanOrEqual(20000);
    expect(s.importedChars).toBe(s.text.length);
    expect(text.slice(0, s.importedChars)).toBe(s.text);
    expect(text[s.importedChars], "the cut did not fall at a line break").toBe("\n");
    expect(s.text.endsWith("sales team.")).toBe(true);
  });

  it("a 9,000-character résumé is imported whole", () => {
    const text = resumeOf(9000);
    expect(importSlice(text)).toEqual({ text, truncated: false, importedChars: 9000, totalChars: 9000 });
  });

  it("a résumé with no line break near the cap is cut at a space, and never inside a surrogate pair", () => {
    const words = "word ".repeat(5000);
    const s = importSlice(words);
    expect(s.truncated).toBe(true);
    expect(s.text.endsWith("word")).toBe(true);
    const emoji = "a" + "😀".repeat(15000);
    const e = importSlice(emoji);
    expect(/[\uD800-\uDBFF]$/.test(e.text), "the cut split an emoji in two").toBe(false);
    expect(e.importedChars).toBeLessThanOrEqual(20000);
    expect(e.importedChars).toBe(e.text.length);
  });
});

describe("parse-resume-structured, run as shipped", () => {
  let world: WritingWorld;
  let handler: EdgeHandler;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("parse-resume-structured");
  });
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
    world.db.rpcs.purchase_spend_take = () => ({ data: true, error: null });
    world.reply = () => toolReply("submit_structured_resume", {
      contact: { fullName: "Jordan Probe", title: "", email: "", phone: "", location: "", linkedIn: "", website: "" },
      summary: "", experience: [], education: [], skills: [], certifications: [],
      resumeTruncated: false, importedChars: 1, totalChars: 1,
    });
  });

  it("shows the model the text up to a line break, and answers what it left out", async () => {
    const text = resumeOf(31000);
    const r = await post(handler, "parse-resume-structured", { resumeText: text }, "anon");
    expect(r.status).toBe(200);
    const want = importSlice(text);
    expect(r.body).toMatchObject({ success: true, resumeTruncated: true, importedChars: want.importedChars, totalChars: 31000 });
    const prompt = world.prompts();
    expect(prompt).toContain(want.text);
    expect(prompt).not.toContain(text.slice(want.importedChars, want.importedChars + 40));
  });

  it("a résumé under the cap is answered whole, and the model cannot claim otherwise", async () => {
    const text = resumeOf(9000);
    const r = await post(handler, "parse-resume-structured", { resumeText: text }, "anon");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, resumeTruncated: false, importedChars: 9000, totalChars: 9000 });
  });
});
