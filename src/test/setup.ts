import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach } from "vitest";
import { readdirSync, unlinkSync } from "fs";

// jsdom doesn't implement window.matchMedia at all — any component using the
// standard useIsMobile()-style hook (matchMedia-based responsive detection)
// throws without this shim. Always reports "not mobile" by default.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// jsPDF's .save() apparently has a Node-specific file-write fallback that
// writes a real PDF to the working directory when it doesn't detect a true
// browser — confirmed by these files actually appearing after a test run,
// even with HTMLAnchorElement.click() and URL.createObjectURL mocked in the
// individual export test files. They got committed once before this was
// caught (see git history). Belt-and-suspenders cleanup here, independent of
// whatever the exact mechanism turns out to be, plus a /*.pdf .gitignore
// entry as a second safety net if cleanup itself ever fails.
function cleanupStrayTestPdfs() {
  try {
    for (const file of readdirSync(".")) {
      if (file.endsWith(".pdf")) unlinkSync(file);
    }
  } catch {
    // Best-effort — never let cleanup itself fail a test run.
  }
}

afterEach(cleanupStrayTestPdfs);
afterAll(cleanupStrayTestPdfs);
