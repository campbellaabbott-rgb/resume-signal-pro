// @vitest-environment node
/**
 * THE TEST SETUP DELETED EVERY PDF IN THE PROJECT ROOT (L12-13).
 *
 * src/test/setup.ts runs before every test file and swept stray jsPDF output
 * after every test with readdirSync(".") and an unlink of every *.pdf -- no
 * record of which files a test had written. A sample résumé kept at the root
 * vanished the first time an unrelated test ran, and /*.pdf is gitignored, so
 * it was unrecoverable. The sweep now remembers what was there when it was
 * made and deletes only what appeared after.
 *
 * The first case runs the setup the suite really loads: a child vitest, on the
 * suite's own config narrowed to one fixture that writes a PDF, started in a
 * scratch working directory that already holds one. The others run the sweep
 * itself in a scratch directory.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { strayPdfSweeper } from "./helpers/stray-test-pdfs";

const ROOT = resolve(__dirname, "../..");

describe("the setup the suite loads", () => {
  it("keeps a PDF that was in the working directory before it loaded, and sweeps the one a test wrote", () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "stray-pdf-setup-")));
    writeFileSync(join(cwd, "owner-sample.pdf"), "%PDF-1.4 owner's file");
    const vitest = join(dirname(createRequire(join(ROOT, "package.json")).resolve("vitest/package.json")), "vitest.mjs");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|TINYPOOL)/.test(k)));
    const r = spawnSync(process.execPath, [vitest, "run", "--config", join(ROOT, "src/test/fixtures/stray-pdf-probe.vitest.config.ts")], { cwd, env, encoding: "utf8", timeout: 100_000 });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(existsSync(join(cwd, "fixture-ran.txt")), `the fixture never ran in the scratch directory\n${r.stdout}${r.stderr}`).toBe(true);
    expect(readFileSync(join(cwd, "fixture-ran.txt"), "utf8")).toBe(cwd);
    expect(existsSync(join(cwd, "owner-sample.pdf")), "the setup deleted a PDF that was there before it loaded").toBe(true);
    expect(existsSync(join(cwd, "Resume_Analysis.pdf")), "positive control: the setup must sweep the PDF the test wrote").toBe(false);
  }, 120_000);
});

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
