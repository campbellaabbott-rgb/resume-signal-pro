/**
 * SHORTLIST REDACTION LET A NAME BELOW LINE SIX, OR IN CHINESE, REACH THE
 * MODEL (S14X-072, S14X-105).
 *
 * WHAT WAS WRONG. The name finder read only the first six non-empty lines,
 * so a CV that opened with "CURRICULUM VITAE / Page 1 of 2 / Confidential /
 * Contact / phone / city" sent the name on line seven to the scorer, and a
 * table-layout CV with the name further down did the same. Nothing said a
 * name had not been found. Chinese and Japanese CVs fared worse: "姓名：王小明"
 * and "氏名　山田 花子" were never read as name labels, "王小明负责项目" kept the
 * name because no word boundary sits inside a run of Han characters, and a
 * "Wang Xiaoming 王小明" header masked one form at most.
 *
 * WHAT HOLDS NOW: every line of the header block is read; the uploaded file's
 * name is a hint used when the text shows its words; the result says
 * nameFound, and the handler stores it so the page can warn; Chinese,
 * Japanese and Korean name labels are read (with or without internal spaces),
 * the name is masked inside a run of characters, both forms of a mixed
 * header go, and 个人简历, 履歴書, 職務経歴書, 工作经历 and 教育背景 are headings,
 * never a name.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

describe("a name anywhere in the header block, or only in the file name, is masked", () => {
  it("reads a name on line seven of the header block", () => {
    const r = redactForScoring("CURRICULUM VITAE\nPage 1 of 2\nConfidential\nContact\n+1 555 123 4567\nAustin, TX\nJane Okafor\nSenior Engineer at Acme\nOkafor led the team.");
    expect(r.redacted).not.toMatch(/Okafor/);
    expect(r.nameFound).toBe(true);
  });

  it("uses the file name's words when no line reads as a name", () => {
    const text = "SKILLS\nPython, SQL, Airflow\nEXPERIENCE\nData engineer at Acme for 6 years\nThe pipelines Okafor built at Acme ran nightly.\nREFERENCES\nAvailable from Jane Okafor on request";
    expect(redactForScoring(text).redacted).toMatch(/Okafor/);
    const r = redactForScoring(text, { nameHint: "Jane_Okafor_CV.pdf" });
    expect(r.redacted).not.toMatch(/Okafor|Jane/);
    expect(r.nameFound).toBe(true);
  });

  it("a file name that is not a name in the text masks nothing", () => {
    const r = redactForScoring("EXPERIENCE\nBuilt pipelines for 10 years at Acme Corp.\nSKILLS\nPython, SQL", { nameHint: "Candidate 7.pdf" });
    expect(r.redacted).toContain("Built pipelines for 10 years at Acme Corp.");
    expect(r.nameFound).toBe(false);
  });

  it("says nameFound === false when nothing read as a name", () => {
    expect(redactForScoring("EXPERIENCE\nBuilt pipelines for 10 years at Acme Corp.\nSKILLS\nPython, SQL").nameFound).toBe(false);
  });
});

describe("the handler keeps whether a name was found, and passes the file name as the hint", () => {
  const src = readFileSync(join(process.cwd(), "supabase/functions/shortlist-evaluate/index.ts"), "utf8");
  it("records parsed_fields.redaction.nameDetected and hands fileName to the redactor", () => {
    expect(src).toMatch(/redaction: \{ nameDetected: nameFound \}/);
    expect(src).toMatch(/nameHint: fileName/);
  });
});

describe("Chinese, Japanese and mixed headers", () => {
  it("masks a 姓名 label's name inside a run of characters and keeps the title and heading", () => {
    const r = redactForScoring("个人简历\n姓名：王小明\n性别：女\n工作经历\n王小明负责项目");
    expect(r.redacted).not.toMatch(/王小明/);
    expect(r.redacted).toContain("个人简历");
    expect(r.redacted).toContain("工作经历");
    expect(r.redacted).toContain("[CANDIDATE]负责项目");
  });

  it("reads 氏名 with an ideographic space and keeps 履歴書 and 職務経歴書", () => {
    const r = redactForScoring("履歴書\n氏名　山田 花子\n職務経歴書\n山田花子は開発を担当");
    expect(r.redacted).not.toMatch(/山田/);
    expect(r.redacted).toContain("履歴書");
    expect(r.redacted).toContain("職務経歴書");
  });

  it("reads '姓 名' with a space inside the label and keeps 教育背景", () => {
    const r = redactForScoring("简历\n姓 名：李雷\n教育背景\n李雷在北京大学");
    expect(r.redacted).not.toMatch(/李雷/);
    expect(r.redacted).toContain("教育背景");
  });

  it("masks both forms of a 'Latin + CJK' header", () => {
    const r = redactForScoring("Wang Xiaoming 王小明\n工作经历\n王小明 and Wang Xiaoming led X");
    expect(r.redacted).not.toMatch(/王小明|Xiaoming/);
    expect(r.redacted).toContain("工作经历");
  });

  it("never reads a job title as the name", () => {
    const r = redactForScoring("软件工程师\n王小明\n工作经历\n软件工程师，负责后端开发");
    expect(r.redacted).toContain("软件工程师，负责后端开发");
    expect(r.redacted).not.toMatch(/王小明/);
  });
});
