/**
 * ATS DEFENSE ASKS FOR THE ROLES IT TARGETS BEFORE CHECKOUT (S11-074; owner
 * decision 2026-10-11).
 *
 * The $15 ATS Defense sold "multi-role targeting (up to 3 roles)", and no buy
 * button asked for a role: the model guessed. Every buy button reaches the
 * checkout through purchaseProduct, which now asks for up to three roles in
 * the app's one dialog and sends them; closing the dialog starts no checkout.
 * Mounted for real, with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));

import { useProductCheckout } from "@/hooks/use-product-checkout";
import { TargetRolesDialog } from "@/components/TargetRolesDialog";

vi.setConfig(MOUNT_TEST_BUDGET);

function Buy({ product }: { product: "atsDefense" | "coverLetter" }) {
  const { purchaseProduct } = useProductCheckout();
  return <button type="button" onClick={() => { void purchaseProduct(product); }}>buy {product}</button>;
}

const checkoutBodies = () => invoke.mock.calls.filter(([f]) => f === "create-product-checkout").map(([, o]) => (o as { body: Record<string, unknown> }).body);

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("rb_resume_text", "A résumé held by this tab, long enough to be stored for the purchase. ".repeat(3));
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { url: null }, error: null });
});
afterEach(() => cleanup());

describe("buying ATS Defense", () => {
  it("asks for the roles first and sends the ones named", async () => {
    render(<><TargetRolesDialog /><Buy product="atsDefense" /></>);
    fireEvent.click(screen.getByRole("button", { name: "buy atsDefense" }));
    expect(await screen.findByText(en.atsRoles.title, {}, SLOW)).toBeInTheDocument();
    expect(checkoutBodies(), "a checkout started before the roles were asked").toEqual([]);
    fireEvent.change(screen.getByLabelText("Role 1"), { target: { value: "Data Analyst" } });
    fireEvent.change(screen.getByLabelText("Role 2"), { target: { value: "BI Developer" } });
    fireEvent.click(screen.getByRole("button", { name: en.atsRoles.continue }));
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1), SLOW);
    expect(checkoutBodies()[0], "the roles never reached the checkout").toMatchObject({ productId: "atsDefense", targetRoles: ["Data Analyst", "BI Developer"] });
  });

  it("starts no checkout when the question is closed", async () => {
    render(<><TargetRolesDialog /><Buy product="atsDefense" /></>);
    fireEvent.click(screen.getByRole("button", { name: "buy atsDefense" }));
    fireEvent.click(await screen.findByRole("button", { name: en.atsRoles.cancel }, SLOW));
    await new Promise((r) => setTimeout(r, 50));
    expect(checkoutBodies()).toEqual([]);
  });

  it("asks nothing for another product", async () => {
    render(<><TargetRolesDialog /><Buy product="coverLetter" /></>);
    fireEvent.click(screen.getByRole("button", { name: "buy coverLetter" }));
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1), SLOW);
    expect(screen.queryByText(en.atsRoles.title)).toBeNull();
    expect(checkoutBodies()[0].targetRoles).toBeUndefined();
  });
});
