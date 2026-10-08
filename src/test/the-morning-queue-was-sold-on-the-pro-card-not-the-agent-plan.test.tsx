/**
 * THE MORNING QUEUE WAS SOLD ON THE PRO CARD, NOT ON THE AGENT PLAN.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04, L3-04). "Morning Queue" led the
 * $45 Pro card's perks while its entitlement is the $99 agent price's alone,
 * so a Pro buyer met the agent's paywall; wave 1 took the line off the Pro
 * card and left it on neither, so the plan that does include it never said so.
 *
 * Both cards mounted for real, with only the backend and auth faked: the
 * agent plan's card lists the Morning Queue, the Pro card does not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import { SUBSCRIPTIONS } from "@/config/products";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({
    pro: { active: false, status: null, currentPeriodEnd: null, loading: false, trialing: false, linkPending: false },
    subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn(),
  }),
}));

import { AgentSubscriptionCard } from "@/components/AgentSubscriptionCard";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const queueName = new RegExp(SUBSCRIPTIONS.agent.name, "i");

describe("the Morning Queue is sold by the plan that includes it", () => {
  it("the agent plan's card lists it", () => {
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    expect(screen.getByText(en.agentPlan.perkMorningQueue)).toBeTruthy();
    expect(screen.getAllByText(queueName).length).toBeGreaterThan(0);
  });

  it("the Pro card does not", () => {
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    expect(screen.queryAllByText(queueName)).toEqual([]);
  });
});
