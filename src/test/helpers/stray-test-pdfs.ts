import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PDFs A TEST WROTE, AND ONLY THOSE.
 *
 * jsPDF's save() can write a real file into the working directory under
 * jsdom, so the test setup sweeps stray PDFs after every test. It used to
 * delete EVERY *.pdf in the directory -- a sample résumé kept at the project
 * root vanished the first time any test ran (L12-13), and /*.pdf is
 * gitignored, so nothing could bring it back.
 *
 * This takes the list when it is created and returns a sweep that deletes
 * only the PDFs that were not on it. Best effort, like the sweep it replaces:
 * cleanup never fails a test.
 */
export function strayPdfSweeper(dir = "."): () => void {
  const pdfs = (): string[] => {
    try { return readdirSync(dir).filter((f) => f.endsWith(".pdf")); } catch { return []; }
  };
  const before = new Set(pdfs());
  return () => {
    for (const f of pdfs()) {
      if (before.has(f)) continue;
      try { unlinkSync(join(dir, f)); } catch { /* best effort */ }
    }
  };
}
