/**
 * THE RETIRED AGENT'S PAGE EXPLAINS ITSELF TO A SIGNED-OUT VISITOR (S12-024).
 *
 * WHAT WAS WRONG. /agent redirected every signed-out visitor to /auth, so a
 * link from the board, an old search result or Google's renderer landed on
 * a bare "Create your free account" for a product nobody can buy any more.
 *
 * WHAT HOLDS NOW, mounted for real: while the agent and its products are
 * off, a signed-out visitor stays on /agent and reads that the Apply Agent is
 * retired, that nothing is submitted for them, and where the free path
 * starts (/agents); a link offers sign-in for a past subscriber. No refund is
 * promised (sales are final). A signed-in subscriber still gets the console.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

let auth: { session: unknown; user: unknown; loading: boolean } = { session: null, user: null, loading: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    // Any chain the console's panels build answers nothing, as an empty table would.
    from: () => {
      const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, p) => {
          if (p === "then") return (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
          if (p === "maybeSingle" || p === "single") return async () => ({ data: null, error: null });
          return () => chain;
        },
      });
      return chain;
    },
    auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/account/AgentStatusBand", () => ({ AgentStatusBand: () => null }));
vi.mock("@/components/account/MorningQueuePanel", () => ({ MorningQueuePanel: () => null }));
vi.mock("@/components/account/PendingQuestionsPanel", () => ({ PendingQuestionsPanel: () => null }));
vi.mock("@/components/account/ApplyQueuePanel", () => ({ ApplyQueuePanel: () => null }));
vi.mock("@/components/account/ApplyProfilePanel", () => ({ ApplyProfilePanel: () => null }));
vi.mock("@/components/account/AgentControlsPanel", () => ({ AgentControlsPanel: () => null }));
vi.mock("@/components/account/AgentSetupChecklist", () => ({ AgentSetupChecklist: () => null }));
vi.mock("@/components/account/AgentNightSummary", () => ({ AgentNightSummary: () => null }));

import Agent from "../pages/Agent";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => { cleanup(); auth = { session: null, user: null, loading: false }; });

const mount = () => render(
  <MemoryRouter initialEntries={["/agent"]}>
    <Routes>
      <Route path="/agent" element={<Agent />} />
      <Route path="/auth" element={<div data-testid="auth-page">sign up form</div>} />
    </Routes>
  </MemoryRouter>,
);

describe("/agent for a signed-out visitor while the agent is retired", () => {
  it("stays on the page and says the agent is retired, with the free path", () => {
    mount();
    expect(screen.queryByTestId("auth-page"), "the visitor was sent to a sign-up form").toBeNull();
    const page = document.querySelector("[data-agent-retired-public]");
    expect(page?.textContent).toMatch(/The Apply Agent is retired/);
    expect(page?.textContent).toMatch(/nothing is submitted for you/);
    expect(page?.querySelector("a[href='/agents']")).toBeTruthy();
    expect(page?.querySelector("a[href^='/auth']")).toBeTruthy();
  });

  it("promises no refund", () => {
    mount();
    expect(document.body.textContent).not.toMatch(/refund/i);
  });

  it("a signed-in subscriber still gets the console", () => {
    auth = { session: { access_token: "jwt" }, user: { id: "u1", email: "u@example.com" }, loading: false };
    mount();
    expect(document.querySelector("[data-agent-retired-public]")).toBeNull();
  });
});
