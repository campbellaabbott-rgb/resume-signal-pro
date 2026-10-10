// @vitest-environment node
/**
 * THE TEST SETUP DELETED EVERY PDF IN THE PROJECT ROOT (L12-13).
 *
 * src/test/setup.ts runs before every test file and swept stray jsPDF output
 * after every test with readdirSync(".") and an unlink of every *.pdf -- no
 * record of which files a test had written. A sample résumé kept at the root
 * vanished the first time an unrelated test ran, and /*.pdf is gitignored, so
 * it was unrecoverable. The sweep now remembers what was there when it was
 * made and deletes only what appeared after. Run here in a scratch directory.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strayPdfSweeper } from "./helpers/stray-test-pdfs";

describe("the stray-PDF sweep", () => {
  it("keeps a PDF that was there before, and deletes the one a test wrote", () => {
    const dir = mkdtempSync(join(tmpdir(), "stray-pdf-"));
    writeFileSync(join(dir, "my-resume.pdf"), "%PDF-1.4 owner's file");
    const sweep = strayPdfSweeper(dir);
    writeFileSync(join(dir, "Resume_Analysis.pdf"), "%PDF-1.4 written by jsPDF in a test");
    writeFileSync(join(dir, "notes.txt"), "not a pdf");
    sweep();
    expect(existsSync(join(dir, "my-resume.pdf")), "the owner's PDF was deleted").toBe(true);
    expect(existsSync(join(dir, "Resume_Analysis.pdf")), "positive control: the test's PDF must go").toBe(false);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });

  it("sweeps again after every test, and a directory it cannot read fails nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "stray-pdf-"));
    const sweep = strayPdfSweeper(dir);
    writeFileSync(join(dir, "a.pdf"), "x");
    sweep();
    writeFileSync(join(dir, "b.pdf"), "x");
    sweep();
    expect(existsSync(join(dir, "a.pdf")) || existsSync(join(dir, "b.pdf"))).toBe(false);
    expect(() => strayPdfSweeper(join(dir, "no-such-dir"))()).not.toThrow();
  });
});
