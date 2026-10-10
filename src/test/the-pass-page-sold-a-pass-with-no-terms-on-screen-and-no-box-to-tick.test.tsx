/**
 * THE PASS PAGE SOLD A PASS WITH NO TERMS ON SCREEN AND NO BOX TO TICK (wave 3
 * review of payments-account).
 *
 * WHAT WAS WRONG. /agents/pass offers "Buy a pass" to an account with no open
 * pass, and the button had no "By continuing you agree to the Terms" line
 * above it. With no line on screen purchaseTerms() sends no Terms version, so
 * the purchase was recorded with no assent; and with the EU/UK switch on,
 * create-pass-checkout refuses a body without the withdrawal waiver, which
 * this page never rendered, so the buyer was told to tick a box that was not
 * there and could not buy here at all.
 *
 * WHAT HOLDS NOW, the page mounted for real with only the backend and auth
 * faked: the line is above the button, the call carries the Terms version it
 * showed, and with the switch on the waiver box is there and its tick is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import { TERMS_VERSION } from "@/config/terms";

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

describe("buying a pass from /agents/pass", () => {
  it("names the Terms above the button, and the checkout call carries the version it showed", async () => {
    mount();
    const buy = await screen.findByRole("button", { name: /buy a pass/i });
    const line = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === AGREE);
    expect([...line.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/terms", "/privacy"]);
    fireEvent.click(buy);
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1));
    expect(checkoutBodies()[0].termsVersion).toBe(TERMS_VERSION);
  });

  it("with the EU/UK switch on, shows the waiver box the server requires and sends its tick", async () => {
    sw.on = true;
    mount();
    const buy = await screen.findByRole("button", { name: /buy a pass/i });
    const box = screen.getByRole("checkbox", { name: en.purchaseTerms.waiver.replace("{{days}}", "14") });
    fireEvent.click(box);
    fireEvent.click(buy);
    await waitFor(() => expect(checkoutBodies()).toHaveLength(1));
    expect(checkoutBodies()[0].withdrawalWaiver).toBe(true);
  });
});
