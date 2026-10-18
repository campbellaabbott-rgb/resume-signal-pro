/**
 * AN INTERNAL TOOL IS NEVER INDEXED (S13-131).
 *
 * /dev/checkout-test set document.title and nothing else, so a crawler that
 * runs scripts read an indexable "Dev Checkout Test" page listing every SKU,
 * its Stripe price id and the test-card numbers. Its head now says noindex.
 * (The robots.txt Disallow line is the bake builder's file: hand-off.)
 */
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) } },
}));

import DevCheckoutTest from "@/pages/DevCheckoutTest";

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
});
