// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * BAKED POSTING LINKS NAME ONLY MANIFEST PATHS (CRAWL18B-4, SEO audit
 * 2026-11-18b).
 *
 * BakedPostingLinks draws "Openings with a page of their own" from the rows
 * of /posting-pages.json. Held here:
 *
 *   - with no manifest, a manifest that lists no rows (today's bake), or no
 *     row that matches, it draws nothing: no heading over an empty list;
 *   - every href it draws is a path the manifest's "live" list names: a row
 *     for a page the live list does not name, a row with no title and a
 *     repeated page are dropped, a row written as an absolute URL links the
 *     path on this site, and a dotted key keeps the trailing slash the bake
 *     wrote;
 *   - a field page shows that field's rows, a company page that board's rows,
 *     and `limit` keeps the bake's first rows in its order;
 *   - the rows arrive with the file itself (loadPostingManifest), and a read
 *     that fails leaves nothing drawn.
 *
 * On f1ea5e353 neither the component nor the manifest's rows exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { BakedPostingLinks } from "@/components/seo/BakedPostingLinks";
import {
  POSTING_PAGES_MANIFEST_PATH,
  bakedPostingRows,
  parsePostingManifest,
  parsePostingManifestRows,
  selectBakedPostingRows,
  setPostingManifestForTests,
} from "@/lib/seo/posting-manifest";

const P = (s: string) => `/jobs/posting/${s}`;
const LIVE = [
  P("greenhouse/acme/1001"),
  P("greenhouse/acme/1002"),
  P("ashby/nimbus/4f2a"),
  P("workday/fivebelow~wd1~fivebelowcareers/JR1"),
  P("greenhouse/acme/10.04/"),
];
const ROWS = [
  { path: P("greenhouse/acme/1001"), title: "Staff Accountant", company: "Acme", token: "acme", field: "finance" },
  { path: P("greenhouse/acme/1002"), title: "Product Designer", company: "Acme", token: "acme", field: "design" },
  { path: P("ashby/nimbus/4f2a"), title: "Data Engineer", company: "Nimbus", token: "nimbus", field: "data_ai" },
  { path: P("workday/fivebelow~wd1~fivebelowcareers/JR1"), title: "Store Manager", company: "Five Below", token: "fivebelow~wd1~fivebelowcareers", field: "hospitality_retail" },
  { path: P("greenhouse/acme/10.04/"), title: "Audit Senior", company: "Acme", token: "acme", field: "finance" },
];
const hrefs = () => [...document.querySelectorAll<HTMLAnchorElement>("[data-baked-posting-links] a")].map((a) => a.getAttribute("href"));
const draw = (props: Parameters<typeof BakedPostingLinks>[0] = {}) =>
  render(<MemoryRouter><BakedPostingLinks {...props} /></MemoryRouter>);

const response = (body: unknown, type = "application/json") =>
  ({ ok: true, headers: { get: () => type }, json: async () => body }) as unknown as Response;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const offline: Fetcher = async () => { throw new Error("no network in tests"); };
let fetchStub = vi.fn<Fetcher>(offline);

beforeEach(() => {
  i18n.addResourceBundle("en", "translation", enListing, true, true);
  setPostingManifestForTests(null);
  fetchStub = vi.fn<Fetcher>(offline);
  vi.stubGlobal("fetch", fetchStub);
});
afterEach(() => { cleanup(); setPostingManifestForTests(null); vi.unstubAllGlobals(); });

describe("nothing to draw, nothing drawn", () => {
  it("with no manifest it draws no section and no heading", () => {
    const { container } = draw();
    expect(container.innerHTML).toBe("");
    expect(document.querySelector("[data-baked-posting-links]")).toBeNull();
  });

  it("a manifest with live paths but no rows (today's bake) draws nothing", () => {
    setPostingManifestForTests(LIVE);
    const { container } = draw();
    expect(container.innerHTML).toBe("");
  });

  it("a field or a board with no row draws nothing", () => {
    setPostingManifestForTests(LIVE, ROWS);
    draw({ field: "legal" });
    expect(document.querySelector("[data-baked-posting-links]")).toBeNull();
    cleanup();
    draw({ token: "globex" });
    expect(document.querySelector("[data-baked-posting-links]")).toBeNull();
  });
});

describe("every link is a page the manifest's live list names", () => {
  it("draws the rows in the bake's order, under 'Openings with a page of their own'", () => {
    setPostingManifestForTests(LIVE, ROWS);
    draw();
    const section = document.querySelector("[data-baked-posting-links]")!;
    expect(section.querySelector("h2")!.textContent).toBe("Openings with a page of their own");
    expect(section.getAttribute("aria-labelledby")).toBe(section.querySelector("h2")!.id);
    expect(hrefs()).toEqual(ROWS.map((r) => r.path));
    expect(section.textContent).toContain("Store Manager · Five Below");
  });

  it("drops a row the live list does not name, a row with no title, and a repeat", () => {
    const rows = parsePostingManifestRows({
      live: LIVE,
      rows: [
        { path: P("greenhouse/acme/9999"), title: "Retired Page", company: "Acme", token: "acme", field: "finance" },
        { path: P("greenhouse/acme/1001"), title: "   ", company: "Acme" },
        { path: P("greenhouse/acme/1002"), title: "Product Designer", company: "Acme", token: "acme", field: "design" },
        { path: P("greenhouse/acme/1002?ref=x"), title: "Product Designer (again)" },
        { path: "/jobs/company/acme", title: "A company page" },
        { path: 42, title: "Not a path" },
        "not a row",
      ],
    }, parsePostingManifest({ live: LIVE }));
    expect(rows.map((r) => r.path)).toEqual([P("greenhouse/acme/1002")]);
  });

  it("an absolute URL on this site links its path; a dotted key keeps the bake's trailing slash", () => {
    const rows = parsePostingManifestRows({
      rows: [
        { path: `https://resumebooster.work${P("greenhouse/acme/1001")}#top`, title: "Staff Accountant" },
        { path: P("greenhouse/acme/10.04/"), title: "Audit Senior" },
      ],
    }, parsePostingManifest({ live: LIVE }));
    expect(rows.map((r) => r.path)).toEqual([P("greenhouse/acme/1001"), P("greenhouse/acme/10.04/")]);
  });

  it("with no live list there are no rows, whatever the file's rows say", () => {
    expect(parsePostingManifestRows({ rows: ROWS }, parsePostingManifest({ rows: ROWS }))).toEqual([]);
    expect(parsePostingManifest({ rows: ROWS })).toBeNull();
  });

  it("every drawn href is in the live list, for every filter", () => {
    setPostingManifestForTests(LIVE, [...ROWS, { path: P("lever/globex/abc"), title: "Unlisted", company: "Globex", token: "globex", field: "design" }]);
    const live = new Set(parsePostingManifest(LIVE));
    for (const props of [{}, { field: "design" }, { field: "finance" }, { token: "acme" }, { limit: 2 }]) {
      draw(props);
      const drawn = hrefs();
      expect(drawn.length, JSON.stringify(props)).toBeGreaterThan(0);
      for (const h of drawn) expect(live.has(h!.replace(/\/$/, "")), `${JSON.stringify(props)} ${h}`).toBe(true);
      expect(drawn).not.toContain(P("lever/globex/abc"));
      cleanup();
    }
  });
});

describe("which rows a page shows", () => {
  it("a field page shows its field's rows; a company page its board's, with no employer name repeated", () => {
    setPostingManifestForTests(LIVE, ROWS);
    draw({ field: "finance" });
    expect(hrefs()).toEqual([P("greenhouse/acme/1001"), P("greenhouse/acme/10.04/")]);
    cleanup();
    draw({ token: "acme" });
    expect(hrefs()).toEqual([P("greenhouse/acme/1001"), P("greenhouse/acme/1002"), P("greenhouse/acme/10.04/")]);
    expect(document.querySelector("[data-baked-posting-links]")!.textContent).not.toContain("· Acme");
  });

  it("limit keeps the bake's first rows, in its order", () => {
    expect(selectBakedPostingRows(ROWS, { limit: 2 }).map((r) => r.title)).toEqual(["Staff Accountant", "Product Designer"]);
    expect(selectBakedPostingRows(ROWS, { limit: 0 })).toEqual([]);
    expect(selectBakedPostingRows(ROWS, { field: "finance", limit: 1 }).map((r) => r.title)).toEqual(["Staff Accountant"]);
  });
});

describe("the rows come with the file", () => {
  it("the section reads the file itself and draws its rows once they arrive", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchStub.mockImplementation(async () => { await gate; return response({ at: "2026-11-19", live: LIVE, rows: ROWS }); });
    draw({ limit: 3 });
    expect(hrefs()).toEqual([]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe(POSTING_PAGES_MANIFEST_PATH);
    await act(async () => { release(); await gate; });
    await waitFor(() => expect(hrefs()).toEqual(ROWS.slice(0, 3).map((r) => r.path)));
    expect(bakedPostingRows()).toHaveLength(ROWS.length);
  });

  it("the SPA fallback's HTML draws nothing", async () => {
    fetchStub.mockImplementation(async () => response("<!doctype html>", "text/html"));
    draw();
    await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(hrefs()).toEqual([]);
    expect(bakedPostingRows()).toEqual([]);
  });

  it("a failed read draws nothing", async () => {
    draw();
    await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(hrefs()).toEqual([]);
    expect(bakedPostingRows()).toEqual([]);
  });
});
