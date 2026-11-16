/**
 * A COUNTRY PAGE OPENS THE SCAN ON ITS OWN MARKET (S14X-032).
 *
 * The CV standards pages cover every market the scanner keeps standards for
 * (COUNTRY_STANDARDS, 52 of them), and each page's "check my CV" button
 * opened the scanner with no market, whose "Applying in" select offered 24
 * hand-picked countries. A reader from the Japan page had to find Japan
 * again, and a reader from the Peru, Kenya or Vietnam page could not pick
 * their market at all. Now the select offers every market the scanner has
 * standards for, named in the reader's language, the country pages link with
 * ?market=<ISO>, and the page reads it (an unknown code leaves auto-detect).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "insert", "upsert", "update", "delete"]) chain[k] = () => chain;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const RESUME = "Jane Doe\nData Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day";
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void }) => (
    <button type="button" onClick={() => p.onResumeDraftChange?.(RESUME)}>draft</button>
  ),
}));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import Index from "@/pages/Index";
import CvStandards from "@/pages/CvStandards";
import { SCANNER_QUERY_PARAMS } from "@/lib/scanner-address";

afterEach(() => { cleanup(); });

const ROOT = resolve(__dirname, "../..");
/** The ISO keys of the scanner's standards, read from its source. */
const standardsKeys = () => [...readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/country-standards.ts"), "utf8")
  .matchAll(/^ {2}([A-Z]{2}): \{/gm)].map((m) => m[1]);
/** The list module, or null where it does not exist. */
const markets = async () => {
  try { return await import("@/config/scan-markets"); } catch { return null; }
};

describe("the select offers every market the scanner keeps standards for", () => {
  it("the market list is the standards' ISO set", async () => {
    const m = await markets();
    expect(m, "no market list").not.toBeNull();
    expect(standardsKeys().length).toBe(52);
    expect(m!.SCAN_MARKETS.map((x) => x.iso).sort()).toEqual(standardsKeys().sort());
  });

  it("names each market in the reader's language", async () => {
    const m = await markets();
    expect(m!.scanMarketName("DE", "de")).toBe("Deutschland");
    expect(m!.scanMarketName("JP", "en")).toBe("Japan");
    expect(m!.scanMarketFor("jp")).toBe("JP");
    expect(m!.scanMarketFor("ZZ")).toBeNull();
  });
});

async function selectAt(entry: string): Promise<HTMLSelectElement> {
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route path="/resume-checker" element={<Index />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
  return await waitFor(() => {
    const s = (screen.getAllByRole("combobox") as HTMLSelectElement[]).find((el) => el.querySelector('option[value=""]'));
    expect(s, "no Applying-in select").toBeTruthy();
    return s!;
  }, SLOW);
}

describe("the scanner reads ?market=", () => {
  it("/resume-checker?market=JP opens with Japan chosen among all 52 markets", async () => {
    const select = await selectAt("/resume-checker?market=JP");
    await waitFor(() => expect(select.value).toBe("JP"), SLOW);
    expect(select.querySelectorAll('option:not([value=""])').length).toBe(52);
  });

  it("an unknown code leaves auto-detect", async () => {
    const select = await selectAt("/resume-checker?market=ZZ");
    expect(select.value).toBe("");
  });

  it("market is one of the scanner's own query parameters, so / sends it on", () => {
    expect(SCANNER_QUERY_PARAMS).toContain("market");
  });
});

describe("the country page links the scan with its market", () => {
  it("the Japan page's button opens /resume-checker?market=JP", () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/cv-standards/japan"]}>
          <Routes><Route path="/cv-standards/:country" element={<CvStandards />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("/resume-checker?market=JP");
  });
});
