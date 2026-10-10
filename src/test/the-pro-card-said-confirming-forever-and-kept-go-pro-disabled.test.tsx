/**
 * THE PRO CARD SAID "CONFIRMING" FOREVER AND KEPT GO PRO DISABLED (wave 3
 * review of payments-account, S8-055 follow-up).
 *
 * WHAT WAS WRONG. Back from Stripe on ?pro=success&session_id=cs_..., the card
 * re-checked the plan PRO_CONFIRM_TRIES times and then stopped, but nothing
 * cleared the held session: the button stayed disabled and the card said
 * "Confirming your subscription" for as long as the page was open. A webhook
 * later than the asks, a 3DS payment left incomplete, or the success link
 * reopened from history after cancelling all left the buyer with no way to
 * subscribe and no word of what to do.
 *
 * WHAT HOLDS NOW, mounted for real with only the backend and auth faked:
 * once the asks run out with the plan still not live, the card says it could
 * not confirm yet and what to do, and Go Pro can be pressed again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "member@example.com" }, session: { access_token: "jwt" } }) }));

import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { PRO_CONFIRM_INTERVAL_MS, PRO_CONFIRM_TRIES } from "@/hooks/use-pro-subscription";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });

describe("a buyer back from Stripe whose plan never reads live", () => {
  it("is told it could not be confirmed yet, and can press Go Pro again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.replaceState(null, "", "/account?pro=success&session_id=cs_test_neverlive123");
    invoke.mockResolvedValue({ data: { active: false, status: "inactive", cached: true }, error: null });
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(en.proPlan.confirming)).toBeTruthy());
    for (let i = 0; i < PRO_CONFIRM_TRIES + 2; i++) await act(async () => { await vi.advanceTimersByTimeAsync(PRO_CONFIRM_INTERVAL_MS); });
    await waitFor(() => expect(screen.getByText(en.proPlan.notConfirmedYet)).toBeTruthy());
    expect(screen.queryByText(en.proPlan.confirming), "the card still says it is confirming").toBeNull();
    expect(screen.getByRole("button", { name: /Go Pro/ }).hasAttribute("disabled"), "Go Pro stayed disabled for good").toBe(false);
    expect(invoke.mock.calls.filter(([fn]) => fn === "check-subscription").length).toBe(PRO_CONFIRM_TRIES);
  });
});
