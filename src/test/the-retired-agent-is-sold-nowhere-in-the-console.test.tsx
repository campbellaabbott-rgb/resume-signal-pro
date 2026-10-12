/**
 * THE RETIRED AGENT IS SOLD NOWHERE IN THE CONSOLE.
 *
 * Owner decision 2026-10-11 (the apply pivot): the Agent plan, the Agent Pass
 * and the $7 Apply Assistant are no longer sold, and the server-side apply
 * agent is switched off. Wave 4's frontend took them off /agents, the
 * homepage and pricing, but three signed-in surfaces it did not own still
 * sold them: the Morning Queue panel's $99 subscribe button (and its "your
 * pass funds this agent" line and a sentence on what the agent does every
 * night), the /agent console's pass offer, and the application kit's $7
 * purchase on the account tracker. A buy there now reaches a 410.
 *
 * Mounted as shipped, with the real switch module (nothing stubs it here):
 *   - the panel shows the retirement notice, no subscribe button, no pass line;
 *   - the application kit offers a member without Pro nothing to buy, and a
 *     Pro member still generates the kit the plan includes;
 *   - the Apply Assistant is out of the catalogue's on-sale list;
 *   - /agent renders the notice where it offered the pass.
 * The dormant copy (paywall, pass line) is proved with the switch stubbed on in
 * the-agent-paywall-promised-a-free-week-to-customers-it-charges-at-once and
 * a-pass-holder-can-switch-the-agent-on.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { isProductHidden, getAllProducts, PRODUCTS } from "@/config/products";
import { APPLY_AGENT_ON, AGENT_PRODUCTS_ON_SALE } from "../../supabase/functions/_shared/apply-agent-switch";

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

const access = { value: { active: false, tier: "none", status: "inactive", pass: { state: "none", usable: false } } as Record<string, unknown> };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (fn: string) => fn === "agent-access" ? { data: access.value, error: null } : { data: null, error: null },
    },
    from: () => table(),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true }) }));

import { MorningQueuePanel } from "../components/account/MorningQueuePanel";
import { ApplyKitPanel } from "../components/account/ApplyKitPanel";
import { AgentRetiredNotice } from "../components/agents/AgentRetiredNotice";

const RESUME = "Registered nurse with eight years on acute medical wards, charge-nurse rotations, and a BSN; ".repeat(3);
const POSTING = "Registered Nurse, Medical-Surgical. Acme Health is hiring an RN for its acute ward; BSN preferred.";
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("the switch ships off", () => {
  it("neither the agent nor its products are on", () => {
    expect(APPLY_AGENT_ON).toBe(false);
    expect(AGENT_PRODUCTS_ON_SALE).toBe(false);
  });
});

describe("the Morning Queue panel, as a customer with no plan sees it", () => {
  it("shows the retirement notice and the free path, and no subscribe button", async () => {
    access.value = { active: false, tier: "none", status: "inactive", pass: { state: "none", usable: false } };
    render(<MemoryRouter><MorningQueuePanel userId="u-9" email="new@example.com" defaultResume={RESUME} /></MemoryRouter>);
    const notice = await screen.findByText(/our own apply agent is switched off/);
    expect(notice).toBeTruthy();
    expect(screen.getByRole("link", { name: /Connect your AI/ }).getAttribute("href")).toBe("/agents");
    expect(screen.queryByRole("button", { name: /Start the Apply Agent|days free for first-time subscribers/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\/month|first-time subscribers start with|Every night the agent scans/);
  });

  it("a past pass holder is not told the pass funds an agent that is switched off", async () => {
    access.value = { active: true, tier: "pass", status: "active", pass: { state: "active", usable: true, applicationsLeft: 7 } };
    render(<MemoryRouter><MorningQueuePanel userId="u-7" email="pass@example.com" defaultResume={RESUME} /></MemoryRouter>);
    await screen.findByText(/Bought one before\? We will refund it or honour it/);
    expect(document.body.textContent).not.toMatch(/Your Agent Pass funds this agent/);
  });
});

describe("the application kit sells nothing to a member without Pro", () => {
  it("renders nothing without Pro, and the Pro kit button with it", () => {
    const off = render(<MemoryRouter><ApplyKitPanel jobPosting={POSTING} resumeText={RESUME} proActive={false} /></MemoryRouter>);
    expect(off.container.textContent).toBe("");
    off.unmount();
    render(<MemoryRouter><ApplyKitPanel jobPosting={POSTING} resumeText={RESUME} proActive /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Application kit/ })).toBeTruthy();
  });

  it("the Apply Assistant is out of the catalogue's on-sale list, and still defined for its past buyers' success page", () => {
    expect(isProductHidden("applyAssistant")).toBe(true);
    expect(getAllProducts()).not.toContain(PRODUCTS.applyAssistant);
    expect(PRODUCTS.applyAssistant.id).toBe("apply_assistant");
  });
});

describe("/agent says the agent is retired where it offered the pass", () => {
  it("the notice names the change, the refund, the address and the free path", () => {
    render(<MemoryRouter><AgentRetiredNotice /></MemoryRouter>);
    const box = document.querySelector("[data-agent-retired]")!;
    expect(box.textContent).toMatch(/does not send applications for anyone/);
    expect(box.querySelector("a[href^='mailto:']")!.getAttribute("href")).toBe("mailto:resumeboostersupp@gmail.com");
    expect(box.querySelector("a[href='/agents']")).toBeTruthy();
    expect(box.textContent).not.toMatch(/\$\d/);
  });

  it("Agent.tsx renders the notice unless the switch puts the pass back on sale", () => {
    const page = read("src/pages/Agent.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(page).toMatch(/\{AGENT_PRODUCTS_ON_SALE \? \([\s\S]*agentPage\.connectInstead[\s\S]*\) : \(\s*<AgentRetiredNotice/);
    expect(page).toMatch(/from "\.\.\/\.\.\/supabase\/functions\/_shared\/apply-agent-switch"/);
  });
});
