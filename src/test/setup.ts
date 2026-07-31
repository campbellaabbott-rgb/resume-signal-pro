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

// ---------------------------------------------------------------------------
// Keep marketing components off the network.
//
// AtsCoverage sits on the front page and asks the database one question on
// mount: is the apply worker live? Any suite that renders Index therefore fired
// a real RPC, and the answer arrived — or didn't — at an unpredictable moment
// relative to the assertions. Adding that component turned a green suite into
// one that failed a different test on each run.
//
// Intercepted here rather than branched around in the component. Production
// code that checks `is this a test` drifts from production behaviour, and the
// thing worth testing is what real users get.
//
// Deliberately narrow: only this one endpoint, and only to answer "offline",
// which is the component's safe default and what a fresh environment sees
// anyway. Every other request still hits whatever the suite has arranged.
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url && url.includes("/rest/v1/rpc/agent_sender_public_status")) {
    return Promise.resolve(new Response("false", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  }
  return realFetch(input as RequestInfo, init);
}) as typeof globalThis.fetch;
