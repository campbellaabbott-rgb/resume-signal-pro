/**
 * AN INTERNAL TOOL IS NEVER INDEXED (S13-131).
 *
 * /dev/checkout-test set document.title and nothing else, so a crawler that
 * runs scripts read an indexable "Dev Checkout Test" page listing every SKU,
 * its Stripe price id and the test-card numbers. Its head now says noindex.
 * (The robots.txt Disallow line is the bake builder's file: hand-off.)
 *
 * And it says so once. The address has no baked file, so it is served the
 * root index.html, whose template carries <meta name="robots" content="index,
 * follow">: React's noindex was added beside it, and the head carried two
 * contradicting directives (measured on the built page, 2026-10-24). A robots
 * meta React writes now supersedes the template's, as its title and share
 * tags do.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) } },
}));

import DevCheckoutTest from "@/pages/DevCheckoutTest";

afterEach(() => { cleanup(); document.head.innerHTML = ""; });

describe("the dev checkout tester", () => {
  it("renders a noindex head", async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/dev/checkout-test"]}>
          <DevCheckoutTest />
        </MemoryRouter>
      </HelmetProvider>,
    );
    await waitFor(() => {
      const robots = [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content") ?? "");
      expect(robots.some((r) => /noindex/.test(r)), `robots: ${robots.join(" | ") || "none"}`).toBe(true);
    });
  });

  it("leaves one robots directive, noindex, over the template's index, follow", async () => {
    document.head.innerHTML = `<meta name="robots" content="index, follow"><title>Resume Booster</title>`;
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/dev/checkout-test"]}>
          <DevCheckoutTest />
        </MemoryRouter>
      </HelmetProvider>,
    );
    await waitFor(() => {
      const robots = [...document.head.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content") ?? "");
      expect(robots, `robots: ${robots.join(" | ")}`).toEqual(["noindex,nofollow"]);
    });
  });
});
