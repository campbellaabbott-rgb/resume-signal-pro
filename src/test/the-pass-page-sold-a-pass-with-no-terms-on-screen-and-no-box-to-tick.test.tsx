/**
 * THE PASS PAGE SOLD A PASS WITH NO TERMS ON SCREEN AND NO BOX TO TICK (wave 3
 * review of payments-account).
 *
 * WHAT WAS WRONG THEN. /agents/pass offered "Buy a pass" with no Terms line
 * above the button and, with the EU/UK switch on, no waiver box: the buyer was
 * told to tick a box that was not there.
 *
 * WHAT HOLDS NOW (the apply pivot, owner decision 2026-10-11). The Agent Pass
 * is retired, so the page sells nothing at all — which is the stronger form
 * of the old property: there is no button to buy, so there is no purchase
 * without terms. Mounted for real, signed in, with the EU/UK switch both ways:
 * no buy control, no Terms line pretending to precede one, no checkout or
 * pass-status call, and the page says the pass is retired, how a past buyer
 * reaches the owner, and links the free path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const { invoke, sw } = vi.hoisted(() => ({ invoke: vi.fn(), sw: { on: false } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "u1", email: "buyer@example.com" } }, user: { id: "u1", email: "buyer@example.com" }, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return { supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: table, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/config/eu-consumer", () => ({
  get EU_UK_SALES_ON() { return sw.on; },
  WITHDRAWAL_DAYS: 14,
  WITHDRAWAL_WAIVER_VERSION: "2026-10-09",
}));

import AgentPass from "@/pages/AgentPass";

vi.setConfig(MOUNT_TEST_BUDGET);

const AGREE = en.purchaseTerms.agree.replace(/<\/?(terms|privacy)>/g, "");
const checkoutBodies = () => invoke.mock.calls.filter(([fn]) => fn === "create-pass-checkout").map(([, o]) => o.body);

beforeEach(() => {
  invoke.mockReset();
  sw.on = false;
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "agent-pass-status") return { data: { pass: { state: "none" }, key: { live: false } }, error: null };
    if (fn === "create-pass-checkout") return { data: { error: "refused for the test" }, error: null };
    return { data: null, error: null };
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/agents/pass"]}><AgentPass /></MemoryRouter></HelmetProvider>);

const SUPPORT = "resumeboostersupp@gmail.com";

describe("/agents/pass after the retirement", () => {
  for (const on of [false, true]) {
    it(`sells nothing and calls nothing, with the EU/UK switch ${on ? "on" : "off"}`, async () => {
      sw.on = on;
      mount();
      await screen.findByRole("heading", { level: 1, name: en.agentPass.retiredPageTitle });
      expect(screen.queryByRole("button", { name: /buy|pass|checkout/i })).toBeNull();
      expect(document.querySelector("main")!.querySelector("button"), "a control on the notice").toBeNull();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(screen.queryByText((_, el) => el?.tagName === "P" && el.textContent === AGREE)).toBeNull();
      expect(checkoutBodies()).toHaveLength(0);
      expect(invoke.mock.calls.map(([fn]) => fn)).toEqual([]);
      expect(document.body.textContent ?? "").not.toMatch(/\$\d/);
    });
  }

  it("tells a past buyer how to reach the owner, and links the free path", async () => {
    mount();
    await screen.findByRole("heading", { level: 1, name: en.agentPass.retiredPageTitle });
    expect(screen.getByText(en.agentPass.retiredBody)).toBeInTheDocument();
    const buyers = document.querySelector("[data-pass-buyers]")!;
    expect(buyers.querySelector("a")!.getAttribute("href")).toBe(`mailto:${SUPPORT}`);
    expect(screen.getByRole("link", { name: new RegExp(en.agentPass.freePathCta) }).getAttribute("href")).toBe("/agents");
  });
});
