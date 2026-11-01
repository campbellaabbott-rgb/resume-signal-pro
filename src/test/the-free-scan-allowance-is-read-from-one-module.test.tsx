/**
 * THE FREE-SCAN ALLOWANCE IS READ FROM ONE MODULE (register S13-094).
 *
 * The uploader's footer said "7 free scans per day" in every locale whatever
 * the sign-in state, while the scanner gives a signed-in account 15, and
 * Index.tsx carried three '|| 7' fallbacks. Changing either server constant
 * would have left about 27 strings false with every test green. Now the
 * figure comes from src/config/scan-allowance.ts, which this file holds equal
 * to both scanners, and no locale types it.
 *
 * Review fix (2026-11-01). A signed-in Pro account, which the scanner never
 * caps (accountProStanding), was told "15 free scans per day". The footer
 * now asks the same plan check the account page does and, for a live plan
 * this account can use, says there is no daily cap.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string } },
  plan: null as null | Record<string, unknown>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: {
      invoke: vi.fn(async (name: string) => (name === "check-subscription" ? { data: auth.plan, error: null } : { data: null, error: null })),
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAuth: () => ({ session: auth.session, user: auth.session?.user ?? null, loading: false }),
}));

import { FREE_SCANS_PER_DAY, SIGNED_IN_SCANS_PER_DAY, scansPerDayFor } from "@/config/scan-allowance";
import { ResumeUploader } from "@/components/ResumeUploader";
import { SCAN_RESULTS_WITHIN_SECONDS } from "@/config/scan-timing";
import en from "@/i18n/locales/en.json";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const constant = (src: string, name: string) => Number(new RegExp(`const ${name} = (\\d+);`).exec(src)?.[1]);

afterEach(() => { cleanup(); auth.session = null; auth.plan = null; });

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
  const mountFooter = () => render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} />
    </MemoryRouter>,
  );
  it("a signed-in Pro account is told it has no daily cap, never a free allowance", async () => {
    auth.session = { user: { id: "u-pro", email: "pro@example.test" } };
    auth.plan = { active: true, status: "active", planTier: "pro" };
    const { container } = mountFooter();
    await waitFor(() => expect(container.textContent).toContain(en.uploader.scanFooterPro.replace("{{seconds}}", String(SCAN_RESULTS_WITHIN_SECONDS))));
    expect(container.textContent).not.toMatch(/free scans per day/);
  });
  it("a signed-in account without a live plan, or whose plan is not linked yet, still reads its allowance", async () => {
    for (const plan of [{ active: false, status: null }, { active: true, status: "active", linkPending: true }]) {
      auth.session = { user: { id: "u-2", email: "someone@example.test" } };
      auth.plan = plan;
      const { container, unmount } = mountFooter();
      // Let the plan check answer before reading.
      await waitFor(async () => {
        const { supabase } = await import("@/integrations/supabase/client");
        expect(vi.mocked(supabase.functions.invoke).mock.calls.some(([n]) => n === "check-subscription")).toBe(true);
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(container.textContent, JSON.stringify(plan)).toContain(`${SIGNED_IN_SCANS_PER_DAY} free scans per day`);
      expect(container.textContent).not.toContain("no daily cap");
      unmount();
    }
  });
  it("a signed-out visitor with a remembered Pro address is not told no cap: the scanner caps by account", async () => {
    localStorage.setItem("rb_last_email", "pro@example.test");
    auth.plan = { active: true, status: "active", planTier: "pro" };
    try {
      const { container } = mountFooter();
      await new Promise((r) => setTimeout(r, 30));
      expect(container.textContent).toContain(`${FREE_SCANS_PER_DAY} free scans per day`);
      expect(container.textContent).not.toContain("no daily cap");
    } finally {
      localStorage.removeItem("rb_last_email");
    }
  });
  it("every locale says the Pro footer with no typed figure", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const pro = String(JSON.parse(readFileSync(resolve(dir, file), "utf8")).uploader.scanFooterPro ?? "");
      expect(pro, file).toContain("{{seconds}}");
      expect(pro.replace(/\{\{\w+\}\}/g, ""), `${file}: a number typed into the Pro footer`).not.toMatch(/\d/);
      expect(pro, file).not.toContain("{{scans}}");
    }
  });
});

describe("the page keeps no allowance of its own", () => {
  it("Index.tsx has no '|| 7' fallback for the limit", () => {
    const src = read("src/pages/Index.tsx");
    expect(src).not.toMatch(/scansLimit\)?\s*\|\|\s*\d+/);
    expect(src).toMatch(/from "@\/config\/scan-allowance"/);
  });
});
