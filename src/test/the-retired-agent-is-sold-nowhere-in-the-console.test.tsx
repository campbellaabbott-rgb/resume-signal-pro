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
 *
 * The review of 9fe3bc0d found four more console surfaces still describing a
 * running agent: the status band ("starts working overnight", and to a
 * subscriber "our sender is offline ... resumes automatically", the steady
 * state once apply-broker records no heartbeat), the Morning Queue bridge card
 * ("reviews thousands of fresh postings overnight"), the prepared-applications
 * panel (Approve and send, Try again, "the agent works overnight") and the
 * tracker's "The agent can apply to this one for you" on saved rows. Mounted
 * as shipped, each now says nothing of the kind.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { isProductHidden, getAllProducts, PRODUCTS } from "@/config/products";
import { APPLY_AGENT_ON, AGENT_PRODUCTS_ON_SALE } from "../../supabase/functions/_shared/apply-agent-switch";

vi.setConfig(MOUNT_TEST_BUDGET);

const tables: Record<string, unknown[]> = {};
const rpcAnswers: Record<string, unknown> = {};
function table(name = "") {
  const rows = () => tables[name] ?? [];
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "is", "upsert", "delete"]) th[k] = self;
  th.limit = async () => ({ data: rows(), error: null });
  th.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: rows(), error: null }).then(ok);
  return th;
}

const access = { value: { active: false, tier: "none", status: "inactive", pass: { state: "none", usable: false } } as Record<string, unknown> };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (fn: string) => fn === "agent-access" ? { data: access.value, error: null } : { data: null, error: null },
    },
    from: (name: string) => table(name),
    rpc: async (fn: string) => ({ data: rpcAnswers[fn] ?? null, error: null }),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true }) }));

import { MorningQueuePanel } from "../components/account/MorningQueuePanel";
import { ApplyKitPanel } from "../components/account/ApplyKitPanel";
import { AgentRetiredNotice } from "../components/agents/AgentRetiredNotice";
import { AgentStatusBand } from "../components/account/AgentStatusBand";
import { AgentBridgeCard } from "../components/account/AgentBridgeCard";
import { ApplyQueuePanel } from "../components/account/ApplyQueuePanel";

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

// S12-171: a subscriber the agent-access read still calls active was offered
// "Activate mandate" and the search form for an agent that is switched off;
// the mandate it made kept the sender health check alarming every six hours.
describe("the Morning Queue panel offers no mandate while the agent is off", () => {
  it("an active plan sees no search form and no button that activates a mandate", async () => {
    access.value = { active: true, tier: "agent", status: "active", pass: { state: "none", usable: false } };
    render(<MemoryRouter><MorningQueuePanel userId="u-5" email="sub@example.com" defaultResume={RESUME} /></MemoryRouter>);
    await screen.findByText(/our own apply agent is switched off/);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole("button", { name: /Activate mandate|Start the agent with these/ })).toBeNull();
    expect(screen.queryByText(/Picks per morning/)).toBeNull();
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

/** Lets every mount effect and the stubbed reads settle before a page is read. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const RUNNING_AGENT = /overnight|resumes automatically|starts working|Approve and send|Try again|filled in for you|can apply to this one/i;

describe("the status band says nothing of a running agent while it is switched off", () => {
  it("a signed-in visitor with no mandate is not told the agent starts working overnight", async () => {
    tables.agent_mandates = [];
    access.value = { active: false, tier: "none", status: "inactive", agentSwitchedOff: true };
    const { container } = render(<MemoryRouter><AgentStatusBand userId="u-1" email="a@example.com" /></MemoryRouter>);
    await settle();
    expect(container.textContent).not.toMatch(RUNNING_AGENT);
    expect(container.textContent).toBe("");
  });

  it("a subscriber is not told the sender is offline and resumes automatically", async () => {
    tables.agent_mandates = [{ user_id: "u-2", apply_mode: "review", resume_path: "u-2/cv.pdf", full_name: "Ann Lee", email: "s@example.com", phone: "+15550100" }];
    access.value = { active: true, tier: "agent", status: "active", agentSwitchedOff: true };
    rpcAnswers.agent_sender_online = false;
    const { container } = render(<MemoryRouter><AgentStatusBand userId="u-2" email="s@example.com" /></MemoryRouter>);
    await settle();
    expect(container.textContent).not.toMatch(RUNNING_AGENT);
    expect(container.textContent).toBe("");
    delete rpcAnswers.agent_sender_online;
    tables.agent_mandates = [];
  });
});

describe("the Morning Queue bridge card is gone while there is no queue", () => {
  it("renders nothing, so no line says the agent reviews postings overnight", () => {
    const { container } = render(<MemoryRouter><AgentBridgeCard topGap="SQL" /></MemoryRouter>);
    expect(container.textContent).toBe("");
  });
});

describe("the prepared-applications panel offers no send", () => {
  it("a person with no packet sees no panel, and no line about the agent working overnight", async () => {
    tables.agent_submissions = [];
    const { container } = render(<MemoryRouter><ApplyQueuePanel userId="u-3" /></MemoryRouter>);
    await settle();
    expect(container.textContent).not.toMatch(RUNNING_AGENT);
    expect(container.textContent).toBe("");
  });

  it("a past buyer still sees their packet, with no Approve and send and no Try again", async () => {
    const base = {
      posting_id: "breezy:acme:abc", title: "Staff Nurse", company: "Acme Health", apply_url: "https://acme.breezy.hr/p/abc",
      source: "breezy", fields: {}, questions: [], questions_are_real: true, blockers: [], fit_pct: 80,
      prepared_at: "2026-10-01T00:00:00Z", submitted_at: null, submitted_via: null, attempts: 0,
      claimed_at: null, released_at: null, claimable_at: null, sent_answers: null, sent_evidence: null,
    };
    tables.agent_submissions = [
      { ...base, id: 11, status: "ready", release_refusal: "review_mode" },
      { ...base, id: 12, status: "failed", release_refusal: "sender_offline", attempts: 3 },
    ];
    render(<MemoryRouter><ApplyQueuePanel userId="u-4" /></MemoryRouter>);
    await screen.findAllByText("Staff Nurse");
    expect(screen.queryByRole("button", { name: /Approve and send/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/filled in for you|overnight/);
    tables.agent_submissions = [];
  });

  it("a stale page that asks anyway is told the agent is switched off, not to refresh and try again", () => {
    const src = read("src/components/account/ApplyQueuePanel.tsx");
    expect(src).toMatch(/agent_switched_off: t\("agentPass\.retiredBody"/);
  });
});

describe("the account tracker does not offer the agent on a saved row", () => {
  it("the agent-can-apply link renders only while the agent is switched on", () => {
    const page = read("src/pages/Account.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(page).toMatch(/\{APPLY_AGENT_ON && a\.status === "saved" && a\.job_id && isSendableVendor\(a\.job_id\) && \(/);
    expect(page).toMatch(/\{user && APPLY_AGENT_ON && <div className="mt-6" id="apply-profile">/);
    expect(page).toMatch(/from "\.\.\/\.\.\/supabase\/functions\/_shared\/apply-agent-switch"/);
  });
});
