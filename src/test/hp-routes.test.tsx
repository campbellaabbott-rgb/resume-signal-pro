// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * THE SWITCH-OVER'S ROUTES (docs/homepage-pricing/README.md, step 1, as
 * corrected by hp/scanner's PR #49).
 *
 * The whole app is mounted at each address, through App.tsx's own router:
 *   - "/" renders the board-first homepage (its H1 is the owner's headline);
 *   - every address that meant the scanner ("/#upload" with or without a
 *     query, the report mails' "/?outcome=…&rid=…", "/?coupon=…", affiliate
 *     links "/?ref=…", the mails' rescan links) lands on /resume-checker with
 *     its query and hash, and the homepage's module is never imported on the
 *     way (the redirect is eager, the page lazy: spec P27);
 *   - "/pricing" renders the new pricing page (pricing-h1);
 *   - "/resume-checker" still renders the scanner and its uploader;
 *   - the homepage's quiet header carries no Start, and Start in the default
 *     header elsewhere opens /resume-checker#upload (step 11).
 * And App.tsx no longer mounts the scanner on "/" or keeps its old head.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    const self = () => th;
    for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "limit", "range", "or", "ilike"]) th[k] = self;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: { name: "x", message: "offline" } }) },
      from: () => table(),
      rpc: async () => ({ data: null, error: { message: "offline" } }),
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

/** How many times the homepage's module was loaded. A redirect must load it zero times. */
const loads = vi.hoisted(() => ({ home: 0 }));
vi.mock("../pages/home/HomePage", async (importOriginal) => {
  loads.home += 1;
  return importOriginal();
});

import App from "../App";

const SLOW = { timeout: 9000 } as const;
vi.setConfig({ testTimeout: 25_000 });

// jsdom has no scrolling; the scanner scrolls its uploader into view on "#upload".
Element.prototype.scrollIntoView = function scrollIntoView() {};

afterEach(() => {
  cleanup();
});

const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

function mountAt(address: string) {
  window.history.replaceState(null, "", address);
  return render(<App />);
}

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const app = strip(readFileSync(resolve(ROOT, "src/App.tsx"), "utf8"));

describe("App.tsx routes the switch-over", () => {
  it('"/" is the redirect around the lazy homepage; /pricing is the new page; the scanner keeps /resume-checker', () => {
    const root = app.split("\n").find((l) => l.includes('<Route path="/" ')) ?? "";
    expect(root).toMatch(/<Route path="\/" element=\{<ScannerAddressRedirect><HomePage \/><\/ScannerAddressRedirect>\} \/>/);
    expect(app).toMatch(/const HomePage = lazy\(\(\) => import\("\.\/pages\/home\/HomePage"\)\);/);
    expect(app).toMatch(/^import \{ ScannerAddressRedirect \} from "@\/components\/ScannerAddressRedirect";$/m);
    expect(app).toMatch(/const Pricing = lazy\(\(\) => import\("\.\/pages\/pricing\/PricingPage"\)\);/);
    expect(app).not.toMatch(/pages\/Pricing"/);
    expect(app, "the scanner's stand-in head at \"/\" is gone with the element it fed").not.toMatch(/SCANNER_AT_ROOT/);
    expect(app).toMatch(/<Route path="\/resume-checker" element=\{<Index landing=\{TOOL_LANDINGS\["resume-checker"\]\} \/>\} \/>/);
  });
});

describe("every address that meant the scanner lands on /resume-checker, without loading the homepage", () => {
  const cases: Array<[string, string]> = [
    ["/#upload", "/resume-checker#upload"],
    ["/?x=1#upload", "/resume-checker?x=1#upload"],
    ["/?rescan=1#upload", "/resume-checker?rescan=1#upload"],
    ["/?outcome=interview&rid=r-123", "/resume-checker?outcome=interview&rid=r-123"],
    ["/?coupon=SPRING", "/resume-checker?coupon=SPRING"],
    ["/?ref=AFF123", "/resume-checker?ref=AFF123"],
    ["/?utm_source=email&utm_medium=scan_report&utm_campaign=rescan", "/resume-checker?utm_source=email&utm_medium=scan_report&utm_campaign=rescan"],
  ];
  for (const [from, to] of cases) {
    it(`${from} -> ${to}`, async () => {
      mountAt(from);
      await waitFor(() => expect(here()).toBe(to), SLOW);
      expect(loads.home, "the homepage's chunk was loaded on the way to the scanner").toBe(0);
    });
  }

  it('"/resume-checker" still renders the scanner and its uploader', async () => {
    mountAt("/resume-checker");
    await waitFor(() => expect(document.getElementById("upload")).not.toBeNull(), SLOW);
    expect(document.querySelector("main h1")).not.toBeNull();
    expect(document.getElementById("home-h1")).toBeNull();
    expect(loads.home).toBe(0);
  });
});

describe("the new pages render at their addresses", () => {
  it('"/pricing" renders the new pricing page', async () => {
    mountAt("/pricing");
    await waitFor(() => expect(document.getElementById("pricing-h1")).not.toBeNull(), SLOW);
    expect(here()).toBe("/pricing");
  });

  it('Start in the default header elsewhere opens /resume-checker#upload', async () => {
    mountAt("/terms");
    const start = await screen.findByRole("button", { name: /^Start$/ }, SLOW);
    fireEvent.click(start);
    await waitFor(() => expect(here()).toBe("/resume-checker#upload"), SLOW);
  });

  it('"/" renders the homepage, with the owner\'s headline, its own canonical and a quiet header with no Start', async () => {
    mountAt("/");
    await waitFor(() => expect(document.getElementById("home-h1")).not.toBeNull(), SLOW);
    expect(document.getElementById("home-h1")!.textContent).toBe("Live jobs, straight from employers' own hiring systems.");
    expect(here()).toBe("/");
    expect(loads.home).toBe(1);
    expect(screen.queryByRole("button", { name: /^Start$/ })).toBeNull();
    expect(document.getElementById("upload"), "the scanner's uploader is not on the homepage").toBeNull();
    await waitFor(() => expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull(), SLOW);
    const canonical = document.head.querySelector('link[rel="canonical"]')!.getAttribute("href") ?? "";
    expect(canonical).toMatch(/^https:\/\/resumebooster\.work\/?$/);
    expect([...document.head.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute("href"))).not.toContain(expect.stringContaining("resume-checker"));
  });
});
