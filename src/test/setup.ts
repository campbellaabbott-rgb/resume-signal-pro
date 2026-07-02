import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach } from "vitest";

// The Claude Code harness passes --localstorage-file without a valid path,
// which causes jsdom to replace window.localStorage with a broken stub that
// lacks standard methods (clear, key, length). Install a working in-memory
// implementation unconditionally so all tests get a reliable localStorage.
if (typeof window !== "undefined") {
  const store: Record<string, string> = {};
  const localStorageMock: Storage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
  Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });
}
import { readdirSync, unlinkSync } from "fs";

// Initialize i18n with the bundled English resources so components using
// useTranslation() render real English text in tests instead of raw keys.
// Placed after the localStorage mock above — the language detector reads it.
import "@/i18n";

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
