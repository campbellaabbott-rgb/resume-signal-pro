/**
 * A $29 AGENT PASS HOLDER COULD NEVER SWITCH THE AGENT ON (L3-02), AND A HELD
 * PACKET HAD NO WAY TO GO (register 1.09).
 *
 * Mounted, not read. agent-access answered only about the $99 subscription,
 * so a pass-only account saw the $99 paywall with Activate disabled — and the
 * only writer of agent_mandates.active sat behind that button, so every
 * request_application answered "your agent is switched off". And the queue
 * told a candidate to approve a held packet while showing no control that
 * could. Both are proved on the real components, against a stand-in backend
 * whose agent-access answers the way the 2026-10-05 function does.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

type Invoke = (fn: string, opts?: { body?: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>;
const state: { access: unknown; packets: unknown[]; calls: Array<{ fn: string; body: unknown }> } = {
  access: null, packets: [], calls: [],
};
const invoke = vi.fn<Invoke>(async (fn, opts) => {
  state.calls.push({ fn, body: opts?.body });
  if (fn === "agent-access") {
    const body = (opts?.body ?? {}) as { action?: string };
    if (body.action === "approve" || body.action === "cancel") return { data: { ok: true, reason: body.action === "approve" ? "approved" : "cancelled" }, error: null };
    return { data: state.access, error: null };
  }
  return { data: null, error: null };
});

function table(name: string) {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "is", "upsert", "delete"]) th[k] = self;
  const rows = name === "agent_submissions" ? state.packets : [];
  th.limit = async () => ({ data: rows, error: null });
  th.maybeSingle = async () => ({ data: null, error: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: rows, error: null }).then(ok);
  return th;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: Parameters<Invoke>) => invoke(...a) },
    from: (t: string) => table(t),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true }) }));

import { MorningQueuePanel } from "../components/account/MorningQueuePanel";
import { ApplyQueuePanel } from "../components/account/ApplyQueuePanel";

const RESUME = "Registered nurse with eight years on acute medical wards, charge-nurse rotations, and a BSN; ".repeat(3);

beforeEach(() => {
  state.access = null;
  state.packets = [];
  state.calls = [];
  invoke.mockClear();
});

describe("a pass-only account sees its pass, not the $99 paywall, and can activate", () => {
  it("asks agent-access about the signed-in account — carrying, at most, its own address", async () => {
    // The 2026-10-05 function reads identity from the session and ignores the
    // body; the panel sends its own address only so an older bundle still
    // answers in the deploy window. Never an action, never anyone else.
    state.access = { active: true, tier: "pass", status: "pass", pass: { state: "unactivated", usable: true, applicationsLeft: 10 } };
    render(<MemoryRouter><MorningQueuePanel userId="u-1" email="ana@example.com" defaultResume={RESUME} /></MemoryRouter>);
    await waitFor(() => expect(state.calls.some((c) => c.fn === "agent-access")).toBe(true));
    const call = state.calls.find((c) => c.fn === "agent-access")!;
    expect(call.body).toEqual({ email: "ana@example.com" });
  });

  it("names the pass, hides the paywall, and enables Activate", async () => {
    state.access = { active: true, tier: "pass", status: "pass", pass: { state: "live", usable: true, applicationsLeft: 7 } };
    render(<MemoryRouter><MorningQueuePanel userId="u-1" email="ana@example.com" defaultResume={RESUME} /></MemoryRouter>);
    await screen.findByText(/Your Agent Pass funds this agent: 7 applications left/);
    expect(screen.queryByText(/Start the Apply Agent — \d+ days free for first-time subscribers/)).toBeNull();
    const activate = await screen.findByRole("button", { name: /Activate mandate/ });
    expect(activate).not.toBeDisabled();
  });

  it("an account with neither plan nor pass still sees the paywall, and Activate stays off", async () => {
    state.access = { active: false, tier: "none", status: "inactive", pass: { state: "none", usable: false } };
    render(<MemoryRouter><MorningQueuePanel userId="u-2" email="bo@example.com" defaultResume={RESUME} /></MemoryRouter>);
    await screen.findByText(/Start the Apply Agent — \d+ days free for first-time subscribers/);
    expect(await screen.findByRole("button", { name: /Activate mandate/ })).toBeDisabled();
  });
});

describe("a held packet can be approved, and a waiting one stopped", () => {
  const held = {
    id: 41, posting_id: "breezy:acme:1", title: "Nurse", company: "Acme", apply_url: "https://x", source: "breezy",
    status: "ready", fields: {}, questions: [], questions_are_real: false, blockers: [], fit_pct: 80,
    prepared_at: new Date().toISOString(), submitted_at: null, submitted_via: null, sent_answers: null, sent_evidence: null,
    release_refusal: "held-for-review", attempts: 0, claimed_at: null, released_at: null, claimable_at: null,
  };

  it("Approve and send releases it through agent-access, for this packet only", async () => {
    state.packets = [held];
    render(<MemoryRouter><ApplyQueuePanel userId="u-1" /></MemoryRouter>);
    const approve = await screen.findByRole("button", { name: /Approve and send/ });
    fireEvent.click(approve);
    await waitFor(() => expect(state.calls.some((c) => c.fn === "agent-access" && (c.body as { action?: string })?.action === "approve")).toBe(true));
    expect(state.calls.find((c) => (c.body as { action?: string })?.action === "approve")!.body).toEqual({ action: "approve", id: 41 });
  });

  it("a packet on a vendor the worker cannot complete offers no approval, only a stop", async () => {
    state.packets = [{ ...held, id: 42, source: "oracle", posting_id: "oracle:acme:2" }];
    render(<MemoryRouter><ApplyQueuePanel userId="u-1" /></MemoryRouter>);
    await screen.findByRole("button", { name: /Don't send this/ });
    expect(screen.queryByRole("button", { name: /Approve and send/ })).toBeNull();
  });

  it("a packet a worker holds right now offers neither", async () => {
    state.packets = [{ ...held, id: 43, released_at: new Date().toISOString(), release_refusal: "", claimed_at: new Date().toISOString() }];
    render(<MemoryRouter><ApplyQueuePanel userId="u-1" /></MemoryRouter>);
    await screen.findByText("Nurse");
    expect(screen.queryByRole("button", { name: /Approve and send|Don't send this/ })).toBeNull();
  });
});
