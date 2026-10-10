// Run only by src/test/the-test-setup-deleted-every-pdf-in-the-project-root.test.ts,
// through stray-pdf-probe.vitest.config.ts, in a scratch working directory.
// It writes a PDF where jsPDF's save() would, and leaves the sweep to the setup.
// The .txt beside it, which no sweep touches, says it ran and where.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";

it("writes a PDF into the working directory, as jsPDF's save() can", () => {
  writeFileSync(join(process.cwd(), "Resume_Analysis.pdf"), "%PDF-1.4 written by a test");
  writeFileSync(join(process.cwd(), "fixture-ran.txt"), process.cwd());
});
