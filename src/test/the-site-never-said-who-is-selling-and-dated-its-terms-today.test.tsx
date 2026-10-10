import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { SellerIdentity } from "@/components/SellerIdentity";
import { PRIVACY_LAST_UPDATED, SELLER, TERMS_LAST_UPDATED, sellerIdentity } from "@/config/seller";

/**
 * WHAT WAS WRONG (commercial-readiness plan 2026-10-08, item 10; register
 * L1-09): no legal name or postal address appeared in the footer, the Terms
 * or the Privacy policy, and both legal pages printed "Last updated:" with
 * `new Date()`, so the date was always today. The owner has not chosen the
 * selling entity yet, so the place for it exists and stays empty, and an
 * empty identity renders nothing rather than a placeholder.
 */

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => codeOf(readFileSync(resolve(ROOT, p), "utf8"));
const ACME = { legalName: "Example Seller LLC", postalAddress: "1 Main St, Springfield" };

describe("the seller is named only once the owner has set it", () => {
  it("ships empty, and empty renders nothing on any surface", () => {
    expect(SELLER).toEqual({ legalName: "", postalAddress: "" });
    expect(sellerIdentity()).toBeNull();
    for (const variant of ["footer", "terms", "privacy"] as const) {
      const { container } = render(<SellerIdentity variant={variant} />);
      expect(container.innerHTML, variant).toBe("");
    }
  });

  it("a name with no address is still not an identity", () => {
    expect(sellerIdentity({ legalName: "Example Seller LLC", postalAddress: " " })).toBeNull();
  });

  it("once set, the footer, the Terms and the Privacy policy each say it", () => {
    expect(render(<SellerIdentity variant="footer" seller={ACME} />).container.textContent).toBe("Sold by Example Seller LLC, 1 Main St, Springfield.");
    expect(render(<SellerIdentity variant="terms" seller={ACME} />).container.textContent).toContain("agreement between you and Example Seller LLC");
    expect(render(<SellerIdentity variant="privacy" seller={ACME} />).container.textContent).toContain("controller of your personal data is Example Seller LLC");
  });

  it("the footer, both legal pages and the bake's crawlable footer read the one constant", () => {
    expect(code("src/components/Footer.tsx")).toMatch(/<SellerIdentity variant="footer"/);
    expect(code("src/pages/Terms.tsx")).toMatch(/<SellerIdentity variant="terms"/);
    expect(code("src/pages/Privacy.tsx")).toMatch(/<SellerIdentity variant="privacy"/);
    expect(code("scripts/prerender-seo.mjs")).toMatch(/const SELLER_ID = D\.sellerIdentity\(\);/);
  });
});

describe("the legal pages carry the day their words last changed", () => {
  it("is a literal date, not today", () => {
    for (const d of [TERMS_LAST_UPDATED, PRIVACY_LAST_UPDATED]) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const page of ["src/pages/Terms.tsx", "src/pages/Privacy.tsx"]) {
      expect(code(page), page).not.toMatch(/\{new Date\(\)\.toLocaleDateString/);
    }
  });

  it("the bake writes both pages, so a crawler no longer gets the homepage there", () => {
    const bake = code("scripts/prerender-seo.mjs");
    expect(bake).toMatch(/legal\("\/terms", "terms", D\.TERMS_LAST_UPDATED/);
    expect(bake).toMatch(/legal\("\/privacy", "privacy", D\.PRIVACY_LAST_UPDATED/);
  });
});
