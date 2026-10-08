/**
 * THE AGENT PAYWALL PROMISED A FREE WEEK TO CUSTOMERS IT CHARGES AT ONCE.
 *
 * WHAT WAS WRONG (review of L6-29). create-agent-checkout offers the trial
 * once per customer, but the surfaces that sell the agent still promised it
 * to everyone: the Morning Queue paywall said "7 mornings free" and its
 * button, the one that starts the checkout, "Try the Apply Agent free for 7
 * days"; after paying, every subscriber read "You're subscribed — 7 days free
 * before the first charge", a returning one just charged included. The trial
 * length was typed in each place rather than read from the mirror of
 * AGENT_TRIAL_DAYS.
 *
 * Mounted, not read: the paywall as a customer with no plan sees it, and the
 * banner for each answer the checkout gives on its success URL.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SUBSCRIPTIONS } from "@/config/products";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

function table() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "is", "upsert", "delete"]) th[k] = self;
  th.limit = async () => ({ data: [], error: null });
  th.maybeSingle = async () => ({ data: null, error: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (fn: string) => fn === "agent-access"
        ? { data: { active: false, tier: "none", status: "inactive", pass: { state: "none", usable: false } }, error: null }
        : { data: null, error: null },
    },
    from: () => table(),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true }) }));

import { MorningQueuePanel } from "../components/account/MorningQueuePanel";
import { AgentWelcomeBanner, agentWelcomeFrom } from "../components/account/AgentWelcomeBanner";

const RESUME = "Registered nurse with eight years on acute medical wards, charge-nurse rotations, and a BSN; ".repeat(3);
const DAYS = SUBSCRIPTIONS.agent.trialDays;
const PRICE = SUBSCRIPTIONS.agent.priceUsd;

describe("the paywall says the trial is for first-time subscribers, at the checkout's length and price", () => {
  it("the sentence and the button that starts the checkout", async () => {
    render(<MemoryRouter><MorningQueuePanel userId="u-9" email="new@example.com" defaultResume={RESUME} /></MemoryRouter>);
    const cta = await screen.findByRole("button", { name: new RegExp(`${DAYS} days free for first-time subscribers`) });
    expect(cta).toBeTruthy();
    const boundary = screen.getByText(/first-time subscribers start with/);
    expect(boundary.textContent).toContain(`$${PRICE}/month`);
    expect(boundary.textContent).toContain(`${DAYS} days free`);
    expect(boundary.textContent).not.toContain("{{");
    expect(document.body.textContent).not.toMatch(/mornings free|free for \d+ days/);
  });
});

describe("the welcome banner names a trial only when the checkout gave one", () => {
  it("a checkout that charged at once is told it is subscribed, and nothing about free days", () => {
    const w = agentWelcomeFrom("1");
    expect(w).toBe("charged");
    render(<AgentWelcomeBanner welcome={w!} />);
    expect(screen.getByRole("status").textContent).toMatch(/You're subscribed\./);
    expect(screen.getByRole("status").textContent).not.toMatch(/days free|first charge/);
  });

  it("a trial checkout is told the trial's length, from the mirror", () => {
    render(<AgentWelcomeBanner welcome={agentWelcomeFrom("trial")!} />);
    expect(screen.getByRole("status").textContent).toContain(`${DAYS} days free before the first charge`);
  });

  it("no flag, or one the checkout never writes, shows no banner", () => {
    expect(agentWelcomeFrom(null)).toBeNull();
    expect(agentWelcomeFrom("yes")).toBeNull();
  });
});
