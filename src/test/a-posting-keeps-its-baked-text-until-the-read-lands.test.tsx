/**
 * A POSTING PAGE KEEPS ITS BAKED TEXT UNTIL ITS READ LANDS (PERFORMANCE-5, SEO
 * audit 2026-11-18).
 *
 * main.tsx keeps the baked page on screen until React's tree holds a page
 * (src/lib/keep-prerendered-page.ts routeHasCommitted: a main, h1 or header).
 * The posting page's first commit was its header, its <main> with the
 * breadcrumb and a spinner while its one detail read was in flight, so the
 * baked posting left at that commit: #root's text went 7,871 -> 669 -> 7,637
 * characters on the phone profile (0.6 to 1.6 s of "Loading this posting..."),
 * and a slow or refused read left the reader less than the file they were
 * sent.
 *
 * Held here, with a real React root beside a baked posting the way main.tsx
 * mounts it: while the detail read is pending the baked nodes stay, the page
 * draws only a hidden, marked <main> (nothing above the baked page), and the
 * commit that brings the answer replaces the baked page in one step (no frame
 * empty, none with both). After a client-side navigation (no baked page) the
 * spinner shows as before. On 9c9234e9a the baked posting is gone while the
 * read is still pending.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

// A whole page mounts here: waits name the condition they wait for, under the
// suite's one budget (helpers/mount-budget.ts), never a fixed sleep a loaded
// machine can outrun.
vi.setConfig(MOUNT_TEST_BUDGET);

import JobPosting from "@/pages/JobPosting";
import {
  APP_MOUNT_ATTRIBUTE,
  ROUTE_PENDING_ATTRIBUTE,
  mountBesidePrerendered,
  prerenderedPageShowing,
  routeHasCommitted,
} from "@/lib/keep-prerendered-page";

const PATH = "/jobs/posting/greenhouse/acme/4012345";
const BAKED_DESC = "Acme is hiring a staff accountant to own the monthly close (the baked file's copy).";
const BAKED = `<header class="baked"><a href="/">Resume Booster</a></header><main id="main-content" class="baked"><h1>Staff Accountant</h1><p>${BAKED_DESC}</p></main><footer class="baked">Footer links</footer>`;
const LIVE_DESC = "We are hiring a staff accountant to own the monthly close and lead a team of four. ".repeat(3);

const detail = () => ({
  data: {
    job: {
      id: "greenhouse:acme:4012345", source: "greenhouse", token: "acme", company: "Acme", title: "Staff Accountant",
      location: "Leeds", country: "GB", postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      missingSince: null, agency: false, applyUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
    },
    description: LIVE_DESC,
  },
  error: null,
});

let root: Root | null = null;
let texts: string[] = [];
let recorder: MutationObserver | null = null;
let actEnv: unknown;

function bakedPage() {
  document.head.innerHTML = `<meta name="x-prerendered" content="1" />`;
  document.body.innerHTML = `<div id="root">${BAKED}</div>`;
  return document.getElementById("root")!;
}
/** #root's text after every batch of DOM changes: what each frame could paint. */
function record(container: HTMLElement) {
  texts = [container.textContent ?? ""];
  recorder = new MutationObserver(() => texts.push(container.textContent ?? ""));
  recorder.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
}
const app = () => (
  <HelmetProvider>
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
      </Routes>
    </MemoryRouter>
  </HelmetProvider>
);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  invoke.mockReset();
  clearBoardBudgetRefusal();
  actEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  // A browser, not act(): commits happen when React schedules them.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(() => {
  recorder?.disconnect();
  root?.unmount();
  root = null;
  cleanup();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnv;
});

describe("a baked posting page while its detail read is in flight", () => {
  it("keeps the baked text on screen until the read resolves, then React's page replaces it in one step", async () => {
    const read = deferred<ReturnType<typeof detail>>();
    invoke.mockImplementation(() => read.promise);
    const container = bakedPage();
    const mount = mountBesidePrerendered(document, container);
    record(container);
    root = createRoot(mount);
    root.render(app());
    await vi.waitFor(() => expect(invoke, "the detail read was asked").toHaveBeenCalled(), SLOW);
    await vi.waitFor(() => expect(mount.querySelector(`main[${ROUTE_PENDING_ATTRIBUTE}]`), "the page drew its marked main").not.toBeNull(), SLOW);

    expect(container.textContent, "the baked posting is still on screen while the read is pending").toContain(BAKED_DESC);
    expect(container.querySelector("header.baked")).not.toBeNull();
    expect(container.querySelector("footer.baked")).not.toBeNull();
    const pending = mount.querySelector(`main[${ROUTE_PENDING_ATTRIBUTE}]`) as HTMLElement | null;
    expect(pending, "the page drew its marked main").not.toBeNull();
    expect(pending!.hidden).toBe(true);
    expect(pending!.id, "the skip link's target stays the baked main").toBe("");
    expect(mount.querySelector("header, footer"), "nothing is drawn above the baked page").toBeNull();
    expect(texts.some((t) => /Loading this posting/.test(t)), "no frame swapped the baked text for the spinner").toBe(false);
    expect(prerenderedPageShowing(document)).toBe(true);

    read.resolve(detail());
    await vi.waitFor(() => expect(container.textContent).toContain("We are hiring a staff accountant"), SLOW);

    expect(container.textContent).not.toContain(BAKED_DESC);
    expect(container.querySelector(".baked")).toBeNull();
    expect(container.textContent).toContain("We are hiring a staff accountant");
    expect(mount.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)).toBeNull();
    expect(mount.querySelector("main")!.id).toBe("main-content");
    expect(mount.querySelector("main")!.hidden).toBe(false);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(texts.filter((t) => t.trim() === ""), "a frame with an empty #root").toEqual([]);
    for (const t of texts) expect(t.includes(BAKED_DESC) && t.includes("We are hiring a staff accountant"), `both pages in one frame: ${t.slice(0, 80)}`).toBe(false);
    expect(prerenderedPageShowing(document)).toBe(false);
  });

  it("a failed read replaces the baked page with the page's answer, as before (no baked page is held for good)", async () => {
    invoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError", context: { status: 500 } } });
    const container = bakedPage();
    const mount = mountBesidePrerendered(document, container);
    root = createRoot(mount);
    root.render(app());
    // The page retries once after 1.2 s before it says it could not load.
    await vi.waitFor(() => expect(container.textContent).toMatch(/We couldn't load this posting just now/), SLOW);
    expect(container.querySelector(".baked")).toBeNull();
  });
});

describe("a posting page reached by a client-side navigation (no baked page left)", () => {
  it("shows its spinner while the read is in flight, as before", async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnv;
    render(app());
    expect(await screen.findByText(/Loading this posting/)).toBeVisible();
    expect(document.querySelector(`[${ROUTE_PENDING_ATTRIBUTE}]`)).toBeNull();
    expect(document.getElementById("main-content")).not.toBeNull();
    expect(prerenderedPageShowing(document)).toBe(false);
  });
});

describe("the readiness test", () => {
  it("a tree holding the pending mark is not a page, even with a header and a main; it is once the mark goes", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.innerHTML = `<header>Site</header><main ${ROUTE_PENDING_ATTRIBUTE}="" hidden><h1>x</h1></main>`;
    expect(routeHasCommitted(div)).toBe(false);
    div.querySelector("main")!.removeAttribute(ROUTE_PENDING_ATTRIBUTE);
    expect(routeHasCommitted(div)).toBe(true);
  });

  it("the mark leaving on its own (an attribute change, no new node) lets the baked page go", async () => {
    const container = bakedPage();
    const mount = mountBesidePrerendered(document, container);
    expect(mount.hasAttribute(APP_MOUNT_ATTRIBUTE)).toBe(true);
    mount.innerHTML = `<main ${ROUTE_PENDING_ATTRIBUTE}="" hidden><h1>Staff Accountant</h1><p>live</p></main>`;
    await settle(0);
    expect(container.querySelector(".baked"), "held while marked").not.toBeNull();
    mount.querySelector("main")!.removeAttribute(ROUTE_PENDING_ATTRIBUTE);
    await settle(0);
    expect(container.querySelector(".baked"), "released by the attribute change alone").toBeNull();
  });
});
