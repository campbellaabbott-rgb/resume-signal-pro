// @ts-nocheck
// @vitest-environment node
//
// pdfjs-serverless auto-detects its runtime environment, and the project's
// default jsdom test environment (needed for React component tests) confuses
// it into thinking it's in a real browser with a working postMessage — it
// isn't, and that mismatch throws before any test code runs. This file's
// pure Node override matches what actually runs in the Deno edge function
// far better than jsdom does anyway.
//
// Regression test for parse-pdf's password/corrupted-file detection. This
// session found that the obvious approach (`instanceof PasswordException`,
// destructured from resolvePDFJS()) silently doesn't work — the class isn't
// actually re-exported from a plain import, so `instanceof undefined` would
// throw its own TypeError and never match. The real, working detection checks
// `.name` on the thrown error instead. Locks that in against real fixture
// files (not mocks) so a pdfjs-serverless version bump or a future "looks
// cleaner" refactor back to `instanceof` gets caught immediately.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolvePDFJS } from "pdfjs-serverless";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe("pdf.js getDocument error contract", () => {
  it("throws an error with name 'PasswordException' for a password-protected PDF", async () => {
    const { getDocument } = await resolvePDFJS();
    const data = loadFixture("password-protected.pdf");

    let caughtError: unknown;
    try {
      await getDocument({ data, useSystemFonts: true }).promise;
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeTruthy();
    expect((caughtError as { name?: string }).name).toBe("PasswordException");
  });

  it("throws an error with name 'InvalidPDFException' for a corrupted/non-PDF file", async () => {
    const { getDocument } = await resolvePDFJS();
    const data = loadFixture("corrupted.pdf");

    let caughtError: unknown;
    try {
      await getDocument({ data, useSystemFonts: true }).promise;
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeTruthy();
    expect((caughtError as { name?: string }).name).toBe("InvalidPDFException");
  });

  it("successfully extracts real text from a valid PDF", async () => {
    const { getDocument } = await resolvePDFJS();
    const data = loadFixture("valid-with-text.pdf");

    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    expect(doc.numPages).toBe(1);

    const page = await doc.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    expect(text).toContain("Regression test content");
  });

  it("PasswordException is NOT reliably available as an exported class (the bug this guards against)", async () => {
    // This is the actual root-cause check: confirms why `instanceof
    // PasswordException` is unsafe here, rather than just asserting the
    // working alternative. If this ever starts failing (i.e. the class
    // becomes reliably exported), the `.name`-based check in parse-pdf is
    // still correct but the instanceof guard comment can be revisited.
    const resolved = await resolvePDFJS();
    expect((resolved as Record<string, unknown>).PasswordException).toBeUndefined();
  });
});
