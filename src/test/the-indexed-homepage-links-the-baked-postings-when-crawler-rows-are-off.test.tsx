// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * THE INDEXED HOMEPAGE LINKS THE BAKED POSTINGS WHEN THE CRAWLER'S ROWS ARE
 * OFF (CRAWL18B-1 and CRAWL18B-4, SEO audit 2026-11-18b).
 *
 * The baked "/" links eight posting pages. Googlebot's renderer runs the
 * page's JavaScript, main.tsx takes the baked page down once React commits,
 * and a crawler gets no live rows (useHomeRows is "off"), so the homepage
 * Google indexed linked no posting page at all.
 *
 * Held here: rendered with Googlebot's user agent and a /posting-pages.json
 * that carries rows, "/" draws "Openings with a page of their own" with the
 * manifest's first eight rows, every href a page the manifest's live list
 * names, in its order, and still makes no list call. A person's visit
 * (status "loading", then "ready") never reads the file and draws no such
 * section; nor does a crawler's visit when the file has no rows.
 *
 * On f1ea5e353 the Googlebot render draws 0 of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import HomePage from "@/pages/home/HomePage";
import { HOME_BAKED_POSTING_LINKS } from "@/components/home/HomeBoardRows";
import { POSTING_PAGES_MANIFEST_PATH, setPostingManifestForTests } from "@/lib/seo/posting-manifest";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;

const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const PERSON = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const AS_OF = "2026-11-19T01:02:00.000Z";

// Ten rows the bake lists, and one row for a page its live list does not name.
const LIVE = Array.from({ length: 10 }, (_, i) => `/jobs/posting/greenhouse/acme/${1001 + i}`);
const ROWS = [
  { path: "/jobs/posting/greenhouse/acme/9999", title: "A page the live list does not name", company: "Acme", token: "acme", field: "finance" },
  ...LIVE.map((path, i) => ({ path, title: `Role ${i + 1}`, company: "Acme", token: "acme", field: i % 2 ? "design" : "finance" })),
];

const fetchStub = vi.fn();
const manifestReads = () => fetchStub.mock.calls.filter(([url]) => url === POSTING_PAGES_MANIFEST_PATH);
const json = (body: unknown) => ({ ok: true, headers: { get: () => "application/json" }, json: async () => body }) as unknown as Response;

function arrange(manifest: unknown) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_board_vendor_counts") return { data: { as_of: AS_OF, cached: true, openTotal: 1050888, sourcesFacet: { workday: 447174, greenhouse: 58486 } }, error: null };
    if (fn === "get_freshness_stats") return { data: [{ boards: 44499, p50_min: 172.1, p95_min: 351.8, max_min: 2990, computed_at: AS_OF }], error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async () => ({ data: { jobs: [], total: 0 }, error: null }));
  fetchStub.mockImplementation(async (url: string) =>
    url === POSTING_PAGES_MANIFEST_PATH && manifest ? json(manifest) : ({ ok: false, status: 404, headers: { get: () => "text/html" } } as unknown as Response));
}

function as(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => userAgent });
}

const mount = () => render(
  <HelmetProvider>
    <MemoryRouter initialEntries={["/"]}>
      <HomePage />
    </MemoryRouter>
  </HelmetProvider>,
);
const section = () => document.querySelector("[data-baked-posting-links]");
const bakedHrefs = () => [...document.querySelectorAll<HTMLAnchorElement>("[data-baked-posting-links] a")].map((a) => a.getAttribute("href"));

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  fetchStub.mockReset();
  vi.stubGlobal("fetch", fetchStub);
  setPostingManifestForTests(null);
  try { sessionStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPostingManifestForTests(null);
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => PERSON });
});

describe("Googlebot's render of /", () => {
  it(`draws the manifest's first ${HOME_BAKED_POSTING_LINKS} rows, each a page the live list names, in the bake's order`, async () => {
    expect(HOME_BAKED_POSTING_LINKS).toBe(8);
    as(GOOGLEBOT);
    arrange({ at: "2026-11-19", live: LIVE, rows: ROWS });
    mount();
    await waitFor(() => expect(bakedHrefs()).toHaveLength(8), SLOW);
    expect(bakedHrefs()).toEqual(LIVE.slice(0, 8));
    expect(bakedHrefs()).not.toContain("/jobs/posting/greenhouse/acme/9999");
    expect(section()!.querySelector("h3")!.textContent).toBe("Openings with a page of their own");
    expect(manifestReads()).toHaveLength(1);
    expect(invoke.mock.calls.filter(([fn]) => fn === "job-board"), "a crawler still makes no list call").toEqual([]);
    expect(document.querySelector("[data-home-rows]")).toBeNull();
    expect(screen.getByRole("link", { name: "See all postings" })).toHaveAttribute("href", "/jobs");
  });

  it("draws nothing while the manifest lists no rows (a bake before the rows were added)", async () => {
    as(GOOGLEBOT);
    arrange({ at: "2026-11-19", live: LIVE });
    mount();
    await waitFor(() => expect(manifestReads()).toHaveLength(1), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(section()).toBeNull();
    expect(screen.getByRole("link", { name: "See all postings" })).toBeInTheDocument();
  });
});

describe("a person's visit", () => {
  it("never reads the manifest and draws no baked-postings section", async () => {
    as(PERSON);
    arrange({ at: "2026-11-19", live: LIVE, rows: ROWS });
    mount();
    await waitFor(() => expect(invoke.mock.calls.some(([fn]) => fn === "job-board")).toBe(true), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(section()).toBeNull();
    expect(manifestReads()).toEqual([]);
  });
});
