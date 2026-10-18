/**
 * A FREELANCE BUYER CAN REGENERATE THEIR SECTION (S12-105).
 *
 * The page said "Not happy with the output? We'll regenerate it free" and
 * offered no way to: a buyer who reopened the purchase link saw the saved
 * section and nothing else. The result now carries a Regenerate button that
 * writes again under the same purchase, and the server's own sentence for a
 * failed write ("your purchase is safe") is what the buyer reads.
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

import FreelanceBoost from "../pages/FreelanceBoost";

vi.setConfig(MOUNT_TEST_BUDGET);

const SECTION = { structure: "projects_section", structureNote: "note", header: "Freelance Projects", scopeStatement: "", projects: [{ clientLabel: "dental", bullets: ["Designed a booking site"], keywordsCovered: [] }], transitionParagraph: "", gapHandling: "", keywordCoverage: null };
const DRAFT = { projects: [{ clientType: "a dental practice", problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "more bookings", duration: "3 months" }], targetRole: "UX designer", jobPosting: "", employmentTimeline: "", situation: "alongside", workMode: "freelance" };

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  localStorage.setItem("freelanceBoostIntake", JSON.stringify(DRAFT));
});
afterEach(() => cleanup());

const mount = () => render(<MemoryRouter initialEntries={["/freelance-boost?session_id=cs_test_boost"]}><FreelanceBoost /></MemoryRouter>);

describe("the saved section has a Regenerate button", () => {
  it("writes again under the same purchase", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "recover-purchase") return { data: { found: true, purchases: [{ productType: "freelance_boost", generatedContent: SECTION }] }, error: null };
      if (fn === "generate-freelance-boost") return { data: { success: true, data: { ...SECTION, header: "Independent UX Consultant" } }, error: null };
      return { data: null, error: null };
    });
    mount();
    const button = await screen.findByRole("button", { name: /regenerate/i }, SLOW);
    fireEvent.click(button);
    await waitFor(() => expect(invoke.mock.calls.some(([fn]) => fn === "generate-freelance-boost")).toBe(true), SLOW);
    const call = invoke.mock.calls.find(([fn]) => fn === "generate-freelance-boost")!;
    expect(call[1].body.sessionId).toBe("cs_test_boost");
    expect(await screen.findByText("Independent UX Consultant", undefined, SLOW)).toBeTruthy();
  });

  it("a failed write shows the server's own sentence", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "recover-purchase") return { data: { found: true, purchases: [{ productType: "freelance_boost", generatedContent: SECTION }] }, error: null };
      if (fn === "generate-freelance-boost") {
        return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ error: "We couldn't write a complete section this time. Your purchase is safe — press Generate to try again." }), { status: 502 }) } };
      }
      return { data: null, error: null };
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /regenerate/i }, SLOW));
    expect(await screen.findByText(/couldn't write a complete section this time\. Your purchase is safe/i, undefined, SLOW)).toBeTruthy();
    expect(screen.queryByText(/non-2xx/)).toBeNull();
  });
});
