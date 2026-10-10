/**
 * THE SELLER WAS NAMED NOWHERE (commercial-readiness plan 2026-10-08, item
 * 10; owner decision 2026-10-08).
 *
 * No legal name or postal address appeared in the footer, the Terms, the
 * Privacy policy, beside a buy button or in marketing mail. The owner has not
 * chosen the entity yet, so the place is built EMPTY: src/config/seller.ts
 * (mirrored in supabase/functions/_shared/seller.ts) renders nothing while
 * unset, and once both halves are filled in, every one of those places shows
 * them. The mail half is in the-seller-was-named-in-no-marketing-mail.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const { seller } = vi.hoisted(() => ({ seller: { legalName: "", postalAddress: "" } }));
vi.mock("@/config/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/seller")>();
  return { ...real, SELLER: seller, sellerIdentity: (s = seller) => real.sellerIdentity(s) };
});
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } }));

import { Footer } from "@/components/Footer";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";

const page = (el: React.ReactElement) => render(<HelmetProvider><MemoryRouter>{el}</MemoryRouter></HelmetProvider>);
afterEach(() => { cleanup(); seller.legalName = ""; seller.postalAddress = ""; });

describe("while the seller is not set", () => {
  it("the shipped config is empty in both runtimes, and nothing claims an identity", async () => {
    const web = await vi.importActual<typeof import("@/config/seller")>("@/config/seller");
    const edge = await import("../../supabase/functions/_shared/seller");
    expect(web.SELLER).toEqual(edge.SELLER);
    expect(web.SELLER).toEqual({ legalName: "", postalAddress: "" });
    page(<><Footer /><PurchaseTerms kind="payment" /></>);
    expect(screen.queryByTestId("seller-identity")).toBeNull();
  });

  it("half an identity is no identity", () => {
    seller.legalName = "Example Seller LLC";
    page(<Footer />);
    expect(screen.queryByTestId("seller-identity")).toBeNull();
  });
});

describe("once the owner sets it", () => {
  const set = () => { seller.legalName = "Example Seller LLC"; seller.postalAddress = "1 Example Street, Springfield, CA 90000, USA"; };

  it("the footer and every buy button name the seller and the address", () => {
    set();
    page(<><Footer /><PurchaseTerms kind="subscription" plan="pro" /></>);
    const lines = screen.getAllByTestId("seller-identity").map((el) => el.textContent);
    const sold = "Sold by Example Seller LLC, 1 Example Street, Springfield, CA 90000, USA.";
    expect(lines).toEqual([sold, sold]);
  });

  it("the Terms name the party, and the Privacy policy the controller", () => {
    set();
    page(<Terms />);
    expect(screen.getByText("These Terms are an agreement between you and Example Seller LLC, 1 Example Street, Springfield, CA 90000, USA.")).toBeTruthy();
    cleanup();
    page(<Privacy />);
    expect(screen.getByText("The controller of your personal data is Example Seller LLC, 1 Example Street, Springfield, CA 90000, USA.")).toBeTruthy();
  });
});
