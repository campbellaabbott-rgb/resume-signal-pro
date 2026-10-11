/**
 * A BOX TICKED ON ONE CARD WAS CONSENT FOR ANOTHER, AND THE SWITCH COULD NOT
 * FLIP (S11-141, S11-142).
 *
 * S11-141. The EU/UK box was one value for the whole page. Ticked on one
 * card, it was sent as the waiver for a purchase pressed on another card, and
 * it stayed ticked for every later purchase. Each Terms line now keeps its own
 * box; the checkout sends the box of the line whose block holds the press,
 * and that box clears as the checkout starts.
 *
 * S11-142. The box rendered only when the build flag VITE_EU_UK_SALES was on,
 * while the server refused every checkout without it once its own secret was
 * on: on switch-on day every purchase failed until a republish. The box now
 * also shows when create-checkout says the switch is on (asked once per
 * page), and when a refusal names it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const eu = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/eu-consumer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get EU_UK_SALES_ON() { return eu.on; },
}));

import { PurchaseTerms } from "@/components/PurchaseTerms";
import * as terms from "@/lib/purchase-terms";
import { consentWasRequired, purchaseTerms } from "@/lib/purchase-terms";

vi.setConfig(MOUNT_TEST_BUDGET);

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  eu.on = false;
  globalThis.fetch = realFetch;
  // Optional, so the same file runs against the module before S11-141.
  (terms as { resetPurchaseTermsForTests?: () => void }).resetPurchaseTermsForTests?.();
});

function TwoCards() {
  return (
    <div>
      <div data-testid="card-a">
        <PurchaseTerms kind="payment" />
        <button type="button">buy A</button>
      </div>
      <div data-testid="card-b">
        <PurchaseTerms kind="payment" />
        <button type="button">buy B</button>
      </div>
    </div>
  );
}
const boxOf = (card: string) => screen.getByTestId(card).querySelector("input[type=checkbox]") as HTMLInputElement;

describe("each Terms line holds its own box (S11-141)", () => {
  beforeEach(() => { eu.on = true; });

  it("a box ticked on card A is not the waiver for a purchase pressed on card B", () => {
    render(<TwoCards />);
    fireEvent.click(boxOf("card-a"));
    fireEvent.click(screen.getByRole("button", { name: "buy B" }));
    expect(purchaseTerms().withdrawalWaiver, "card A's box was sent as consent for card B's purchase").toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "buy A" }));
    expect(purchaseTerms().withdrawalWaiver).toBe(true);
  });

  it("the box is spent by the checkout it starts, and shows unticked again", async () => {
    render(<TwoCards />);
    fireEvent.click(boxOf("card-a"));
    fireEvent.click(screen.getByRole("button", { name: "buy A" }));
    expect(purchaseTerms().withdrawalWaiver).toBe(true);
    await waitFor(() => expect(boxOf("card-a").checked).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "buy A" }));
    expect(purchaseTerms().withdrawalWaiver, "one tick stood as consent for a later purchase").toBe(false);
  });

  it("a line that leaves the screen takes its box with it", () => {
    const { unmount } = render(<TwoCards />);
    fireEvent.click(boxOf("card-a"));
    unmount();
    render(<TwoCards />);
    fireEvent.click(screen.getByRole("button", { name: "buy A" }));
    expect(purchaseTerms().withdrawalWaiver).toBe(false);
  });
});

describe("the box shows when the server's switch is on (S11-142)", () => {
  it("with the build flag off, the box appears once create-checkout says the switch is on", async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/functions/v1/create-checkout")) {
        asked.push(`${init?.method ?? "GET"} ${url}`);
        return new Response(JSON.stringify({ euUkSales: true, withdrawalDays: 14 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
    render(<TwoCards />);
    await waitFor(() => expect(screen.getAllByRole("checkbox"), "the server said on and no box was shown").toHaveLength(2), SLOW);
    expect(asked, "the page asked the server more than once").toHaveLength(1);
    expect(asked[0]).toMatch(/^GET /);
    fireEvent.click(boxOf("card-b"));
    fireEvent.click(screen.getByRole("button", { name: "buy B" }));
    expect(purchaseTerms()).toMatchObject({ withdrawalWaiver: true });
  });

  it("with the server saying off, no box shows and nothing is sent", async () => {
    render(<TwoCards />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "buy A" }));
    expect(purchaseTerms().withdrawalWaiver).toBeUndefined();
  });

  it("a refusal that names the box shows it beside the button at once", async () => {
    render(<TwoCards />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const refusal = {
      error: "Please tick the box above the button to continue.",
      consentRequired: "withdrawal_waiver_required",
      consentBox: "withdrawalWaiver",
      consentText: "I want my purchase delivered now, and I understand that I lose my 14-day right to withdraw once it has been delivered.",
    };
    const ctx = { status: 400, clone: () => ({ json: async () => refusal }) };
    let refused = false;
    await act(async () => { refused = await consentWasRequired({ context: ctx }, null); });
    expect(refused).toBe(true);
    await waitFor(() => expect(screen.getAllByRole("checkbox"), "the refusal named a box the page still did not show").toHaveLength(2));
  });
});
