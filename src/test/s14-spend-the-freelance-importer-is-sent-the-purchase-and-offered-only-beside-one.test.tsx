/**
 * THE FREELANCE PROFILE IMPORTER IS SENT THE PURCHASE, AND OFFERED ONLY
 * BESIDE ONE (S14 hotfix, lane spend, M-S14-058).
 *
 * import-freelance-profile spent a model extraction for anyone holding the
 * publishable key. It now runs only for a Freelance Boost purchase, which it
 * reads from the session_id the page already holds for the generator. So the
 * page sends that session with the profile text, and offers the import only
 * where it holds one: a browser that bought here without the link sees the
 * "bought on this device" box and no importer it could not use.
 *
 * Mounted for real, with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-product-checkout", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-product-checkout")>()),
  useProductCheckout: () => ({ purchaseProduct: vi.fn(), isLoading: false, currentProduct: null }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import FreelanceBoost, { PURCHASE_KEY } from "../pages/FreelanceBoost";
import en from "../i18n/locales/en.json";

vi.setConfig(MOUNT_TEST_BUDGET);

const PROFILE = "Freelance UX designer on Upwork since 2021. Redesigned a dental practice's booking site in Figma; bookings doubled in three months. ".repeat(2);

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "recover-purchase") return { data: { found: false }, error: null };
    if (fn === "import-freelance-profile") return { data: { success: true, data: { projects: [], sourceGuess: "unknown" } }, error: null };
    return { data: null, error: null };
  });
});
afterEach(() => cleanup());

describe("the profile importer", () => {
  it("sends the purchase the link holds with the profile text", async () => {
    render(<MemoryRouter initialEntries={["/freelance-boost?session_id=cs_live_boost"]}><FreelanceBoost /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /^import$/i }, SLOW));
    fireEvent.change(await screen.findByPlaceholderText(/paste your full profile text/i, undefined, SLOW), { target: { value: PROFILE } });
    fireEvent.click(screen.getByRole("button", { name: /extract projects/i }));
    await waitFor(() => expect(invoke.mock.calls.some(([fn]) => fn === "import-freelance-profile")).toBe(true), SLOW);
    const [, opts] = invoke.mock.calls.find(([fn]) => fn === "import-freelance-profile")!;
    expect(opts.body).toEqual({ profileText: PROFILE, sessionId: "cs_live_boost" });
  });

  it("is not offered to a browser that bought here but holds no link: the importer would refuse it", async () => {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify({ at: Date.now() }));
    render(<MemoryRouter initialEntries={["/freelance-boost"]}><FreelanceBoost /></MemoryRouter>);
    expect(await screen.findByText(en.freelanceBoost.boughtHereTitle, undefined, SLOW)).toBeTruthy();
    expect(screen.queryByText(/import from your profile/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^import$/i })).toBeNull();
    expect(invoke.mock.calls.some(([fn]) => fn === "import-freelance-profile")).toBe(false);
  });
});
