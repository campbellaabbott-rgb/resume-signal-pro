/**
 * THE FREE-SCAN ALLOWANCE IS READ FROM ONE MODULE (register S13-094).
 *
 * The uploader's footer said "7 free scans per day" in every locale whatever
 * the sign-in state, while the scanner gives a signed-in account 15, and
 * Index.tsx carried three '|| 7' fallbacks. Changing either server constant
 * would have left about 27 strings false with every test green. Now the
 * figure comes from src/config/scan-allowance.ts, which this file holds equal
 * to both scanners, and no locale types it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const auth = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAuth: () => ({ session: auth.session, user: auth.session?.user ?? null, loading: false }),
}));

import { FREE_SCANS_PER_DAY, SIGNED_IN_SCANS_PER_DAY, scansPerDayFor } from "@/config/scan-allowance";
import { ResumeUploader } from "@/components/ResumeUploader";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const constant = (src: string, name: string) => Number(new RegExp(`const ${name} = (\\d+);`).exec(src)?.[1]);

afterEach(() => { cleanup(); auth.session = null; });

describe("the allowance module mirrors what refuses the next scan", () => {
  for (const fn of ["free-keyword-scan", "free-keyword-scan-stream"]) {
    it(fn, () => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(constant(src, "FREE_SCANS_PER_DAY")).toBe(FREE_SCANS_PER_DAY);
      expect(constant(src, "SIGNED_IN_SCANS_PER_DAY")).toBe(SIGNED_IN_SCANS_PER_DAY);
    });
  }
  it("a signed-in visitor gets more", () => {
    expect(scansPerDayFor(false)).toBe(FREE_SCANS_PER_DAY);
    expect(scansPerDayFor(true)).toBe(SIGNED_IN_SCANS_PER_DAY);
    expect(SIGNED_IN_SCANS_PER_DAY).toBeGreaterThan(FREE_SCANS_PER_DAY);
  });
});

describe("no locale types the allowance", () => {
  const dir = resolve(ROOT, "src/i18n/locales");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(file, () => {
      const footer = String(JSON.parse(readFileSync(resolve(dir, file), "utf8")).uploader.scanFooter);
      expect(footer.split("{{scans}}").length - 1, "the footer does not interpolate the allowance").toBe(1);
      expect(footer.replace(/\{\{\w+\}\}/g, ""), "a number typed into the footer").not.toMatch(/\d/);
    });
  }
});

describe("the uploader states this visitor's allowance", () => {
  const footer = () => {
    const { container } = render(
      <MemoryRouter>
        <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} />
      </MemoryRouter>,
    );
    return container.textContent ?? "";
  };
  it("signed out", () => {
    const text = footer();
    expect(text).toContain(`${FREE_SCANS_PER_DAY} free scans per day`);
    expect(text).not.toContain(`${SIGNED_IN_SCANS_PER_DAY} free scans per day`);
  });
  it("signed in", () => {
    auth.session = { user: { id: "u-1" } };
    const text = footer();
    expect(text, "a signed-in visitor was told the signed-out allowance").toContain(`${SIGNED_IN_SCANS_PER_DAY} free scans per day`);
    expect(text).not.toContain(`${FREE_SCANS_PER_DAY} free scans per day`);
  });
});

describe("the page keeps no allowance of its own", () => {
  it("Index.tsx has no '|| 7' fallback for the limit", () => {
    const src = read("src/pages/Index.tsx");
    expect(src).not.toMatch(/scansLimit\)?\s*\|\|\s*\d+/);
    expect(src).toMatch(/from "@\/config\/scan-allowance"/);
  });
});
