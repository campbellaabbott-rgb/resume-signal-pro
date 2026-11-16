/**
 * A REFUSED DELETE LINKS THE STRIPE BILLING PAGE IT TELLS YOU TO USE (S14X-230).
 *
 * WHAT WAS WRONG. A plan billed to the account's address but not linked to
 * the account refuses the delete: "Cancel it from Stripe's billing page
 * first, then delete the account." delete-account answers that page's address
 * as portalLoginUrl beside the code, but the account page kept only the
 * message keys, so the sentence named a page the reader had no way to reach.
 *
 * WHAT HOLDS NOW, with the card mounted and the refusal built by the same
 * helper the account page uses (lib/account-delete):
 *   - a Stripe billing address renders as a link to exactly that address;
 *   - no address renders the support line instead;
 *   - an address on any other host renders no link at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataPrivacyCard } from "@/components/account/DataPrivacyCard";
import { deleteRefusalView } from "@/lib/account-delete";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";
import accountEn from "../i18n/shards/account/en.json";

afterEach(cleanup);

const refuseWith = async (body: Record<string, unknown>) => {
  render(<DataPrivacyCard onExport={() => undefined} onDelete={async () => deleteRefusalView(body)} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" })); });
  return document.querySelector("[data-delete-refusal]")!;
};

describe("a refusal for a plan that is not linked to the account", () => {
  it("links Stripe's billing page when delete-account answered its address", async () => {
    const box = await refuseWith({ code: "subscription_unlinked", portalLoginUrl: "https://billing.stripe.com/p/login/test_x" });
    expect(box.textContent).toMatch(/Stripe's billing page first/);
    const link = screen.getByRole("link", { name: accountEn.accountView.deleteBillingPage });
    expect(link.getAttribute("href")).toBe("https://billing.stripe.com/p/login/test_x");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
  });

  it("says where to write when delete-account answered no address", async () => {
    const box = await refuseWith({ code: "subscription_unlinked" });
    expect(box.querySelector("a")).toBeNull();
    expect(box.textContent).toContain(accountEn.accountView.deleteBillingSupport.replace("{{support}}", AUTH_SUPPORT_EMAIL));
  });

  it("links nothing when the address is not on Stripe's billing host", async () => {
    const box = await refuseWith({ code: "subscription_unlinked", portalLoginUrl: "https://billing.stripe.com.example.net/login" });
    expect(box.querySelector("a")).toBeNull();
    expect(box.querySelector("[data-billing-support]")).not.toBeNull();
  });
});

describe("any other refusal", () => {
  it("carries no billing line, even when an address came with it", async () => {
    const box = await refuseWith({ code: "files_not_deleted", portalLoginUrl: "https://billing.stripe.com/p/login/test_x" });
    expect(box.querySelector("[data-billing-page]")).toBeNull();
    expect(box.querySelector("[data-billing-support]")).toBeNull();
  });
});
