/**
 * AN OWNER DASHBOARD IN A HIDDEN TAB ASKS NOTHING UNTIL IT IS SHOWN AGAIN
 * (CW2-HB1, cost wave 2 item HB-1).
 *
 * WHAT WAS WRONG. /health-check re-read everything every 30 s, /errors every
 * 30 s while Live, and the industry and user-health panels every 60 s, with
 * the tab hidden as much as shown. Counted from the code, one /health-check tab
 * left open behind others cost about 1,620 edge calls, 120 health-check
 * gateway probes and 120 Stripe calls an hour, read by nobody.
 *
 * WHAT HOLDS NOW, by rendering each real poller with its network faked and the
 * clock faked:
 *   - while the document is hidden, five minutes pass with no request;
 *   - on return it reads once at once, then polls at its old cadence;
 *   - a visible tab polls exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const adminRpc = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));
vi.mock("@/lib/admin-auth", () => ({
  adminRpc: (...a: unknown[]) => adminRpc(...a),
  adminAuthHeaders: () => ({ "x-admin-key": "k" }),
  getStoredAdminKey: () => "k",
}));
vi.mock("@/components/dashboard/AdminAuthGate", () => ({ AdminAuthGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/hooks/use-circuit-breaker", () => ({ getAllCircuitStates: () => ({}), resetServiceCircuit: () => {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
// Each poller is rendered on its own: the page's other pollers are stubbed.
vi.mock("@/components/dashboard/HealthTrendChart", () => ({ HealthTrendChart: () => null }));
vi.mock("@/components/dashboard/EmailTrendChart", () => ({ EmailTrendChart: () => null }));
vi.mock("@/components/dashboard/WebhookTrendChart", () => ({ WebhookTrendChart: () => null }));
vi.mock("@/components/dashboard/AIGenerationTrendChart", () => ({ AIGenerationTrendChart: () => null }));
vi.mock("@/components/dashboard/HealthHistoryChart", () => ({ HealthHistoryChart: () => null }));
vi.mock("@/components/dashboard/GeoPerformanceChart", () => ({ GeoPerformanceChart: () => null }));
vi.mock("@/components/dashboard/ErrorTrendChart", () => ({ ErrorTrendChart: () => null }));
vi.mock("@/components/dashboard/LegacyUserHealthTable", () => ({ LegacyUserHealthTable: () => null }));
vi.mock("@/components/dashboard/ErrorDiagnostics", () => ({ ErrorDiagnostics: () => null }));
vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: () => null, BarChart: Stub, Bar: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null };
});

import HealthCheck from "@/pages/HealthCheck";
import ErrorDashboard from "@/pages/ErrorDashboard";
import { IndustryDetectionChart } from "@/components/dashboard/IndustryDetectionChart";
import { UserHealthTable } from "@/components/dashboard/UserHealthTable";

let visibility: DocumentVisibilityState = "visible";
const setVisibility = async (v: DocumentVisibilityState) => {
  visibility = v;
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
};
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const asked = () => invoke.mock.calls.length + adminRpc.mock.calls.length + rpc.mock.calls.length + from.mock.calls.length;

/** A query builder that answers an empty read to any chain. */
const emptyQuery = (): unknown => new Proxy(() => {}, {
  get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null, count: 0 }) : emptyQuery()),
  apply: () => emptyQuery(),
});

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  invoke.mockReset(); adminRpc.mockReset(); rpc.mockReset(); from.mockReset();
  invoke.mockImplementation(async (fn: string) => ({ data: fn === "get-error-telemetry" ? { data: [] } : null, error: null }));
  adminRpc.mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValue({ data: [], error: null });
  from.mockImplementation(() => emptyQuery());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (document as { hidden?: unknown }).hidden;
});

const POLLERS = [
  { name: "/health-check", every: 30_000, mount: () => render(<MemoryRouter><HealthCheck /></MemoryRouter>) },
  { name: "/errors (Live)", every: 30_000, mount: () => render(<MemoryRouter><ErrorDashboard /></MemoryRouter>) },
  { name: "the industry detection panel", every: 60_000, mount: () => render(<IndustryDetectionChart />) },
  { name: "the user health panel", every: 60_000, mount: () => render(<UserHealthTable />) },
];

describe.each(POLLERS)("$name", ({ every, mount }) => {
  it("a visible tab polls at its cadence (the control)", async () => {
    mount();
    await advance(0);
    const first = asked();
    expect(first, "the first read asked nothing").toBeGreaterThan(0);
    await advance(every);
    expect(asked()).toBeGreaterThan(first);
  });

  it("asks nothing while hidden, reads once on return, then polls again", async () => {
    mount();
    await advance(0);
    await setVisibility("hidden");
    const hidden = asked();
    await advance(5 * 60_000);
    expect(asked(), "the hidden tab kept asking").toBe(hidden);

    await setVisibility("visible");
    const back = asked();
    expect(back, "the tab came back and read nothing").toBeGreaterThan(hidden);
    await advance(every);
    expect(asked(), "polling did not resume").toBeGreaterThan(back);
  });

  it("a tab hidden and shown again inside one period does not read twice on top of its poll", async () => {
    mount();
    await advance(0);
    await setVisibility("hidden");
    await setVisibility("visible");
    const back = asked();
    await advance(every - 1);
    expect(asked(), "a second timer kept running beside the restarted one").toBe(back);
  });
});
