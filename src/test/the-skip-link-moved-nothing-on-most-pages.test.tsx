// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * THE SKIP LINK MOVED NOTHING ON MOST PAGES (S8-095).
 *
 * index.html's first focusable element is `<a href="#main-content">Skip to
 * main content</a>`, on every page. Only Index, Jobs, Explore and
 * GhostJobIndex render that id; /terms, /pricing, /auth, /account and some
 * thirty-five others render a bare <main> (or none), so for a keyboard user
 * the first key press on those pages moved neither focus nor scroll. The whole
 * app is mounted here at /terms with the skip link where index.html puts it,
 * and the press must land focus on the page's main region.
 *
 * And the same mount proves the visit recorder, now above every route, cannot
 * take the app down: with sessionStorage throwing (a private window with site
 * data blocked) the page still renders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    const self = () => th;
    for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "limit"]) th[k] = self;
    th.maybeSingle = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: { name: "x", message: "offline" } }) },
      from: () => table(),
      rpc: async () => ({ data: [] }),
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

// The recorder made to throw the way a blocked sessionStorage makes it throw
// (initFunnelTracking reads it unguarded; jsdom's Storage cannot be made to
// refuse access, so the throw is planted one level up).
let recorderThrows = false;
vi.mock("@/hooks/use-funnel-tracking", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/use-funnel-tracking")>();
  return {
    ...real,
    initFunnelTracking: () => {
      if (recorderThrows) throw new DOMException("The operation is insecure.", "SecurityError");
      return real.initFunnelTracking();
    },
  };
});

import App from "../App";

const SLOW = { timeout: 8000 } as const;
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  document.querySelectorAll('a[href="#main-content"]').forEach((a) => a.remove());
  vi.restoreAllMocks();
});

function skipLink(): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = "#main-content";
  a.textContent = "Skip to main content";
  document.body.prepend(a);
  return a;
}

describe("the skip link moved nothing on most pages", () => {
  it("on /terms (no #main-content) the press lands focus on the page's main region", async () => {
    window.history.replaceState(null, "", "/terms");
    const link = skipLink();
    render(<App />);
    await waitFor(() => expect(document.querySelector("main")).not.toBeNull(), SLOW);
    expect(document.getElementById("main-content"), "this page has no #main-content: the case under test").toBeNull();
    fireEvent.click(link);
    expect(document.activeElement, "the skip link left focus where it was").toBe(document.querySelector("main"));
  });

  it("a blocked sessionStorage does not take the app down with the visit recorder", async () => {
    window.history.replaceState(null, "", "/terms");
    recorderThrows = true;
    try {
      render(<App />);
      await waitFor(() => expect(document.querySelector("main h1")).not.toBeNull(), SLOW);
      expect(document.body.textContent).not.toContain("Something went wrong");
    } finally { recorderThrows = false; }
  });

  it("positive control: with storage available the page renders the same way", async () => {
    window.history.replaceState(null, "", "/terms");
    render(<App />);
    await waitFor(() => expect(document.querySelector("main h1")).not.toBeNull(), SLOW);
    expect(document.body.textContent).not.toContain("Something went wrong");
  });
});
