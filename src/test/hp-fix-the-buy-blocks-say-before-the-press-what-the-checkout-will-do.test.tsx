/**
 * THE BUY BLOCKS SAY BEFORE THE PRESS WHAT THE CHECKOUT WILL DO (review round
 * of 2026-10-26).
 *
 *   - Once sales open, /pricing showed Go Pro and the Full Analysis link to a
 *     browser whose time zone is in the EU, the EEA, the UK or India, and both
 *     checkouts then refuse it (sales-territory.ts). Wave 4's Pro card already
 *     shows its time-zone notice where it would buy; the pricing page's two
 *     buy blocks now do the same (an active member still sees Manage).
 *   - The limits table printed 25 fits a day in Claude Code for Pro too,
 *     while a key on a Pro account scores 1,000 a day (agent-mcp
 *     fitStandingOf, fit-allowance.ts FIT_FULL_PER_DAY).
 *   - PurchaseTerms typed "$45" into its renewal line and the renewal box's
 *     label, beside a Go Pro button that writes the price the reader's way
 *     ("45 $" in German): two spellings of one price in one block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";

const auth = vi.hoisted(() => ({ user: null as null | { email: string } }));
const sub = vi.hoisted(() => ({ active: false, status: null as string | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user, session: null }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: sub.active, status: sub.status, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false }),
}));

import { FullAnalysisBuy, ProBuy, ProBuyBlock } from "@/components/pricing/BuyBlock";
import { limitGroups } from "@/components/pricing/limit-groups";
import { MCP_FIT_FULL_PER_DAY as MCP_TOOLS_FIT_FULL } from "@/config/mcp-tools";
import { FIT_FULL_PER_DAY } from "../../supabase/functions/_shared/fit-allowance";
import { MCP_FIT_FULL_PER_DAY } from "@/components/pricing/plan-facts";
import type { SaleGates } from "@/components/pricing/sale-gates";

const ROOT = resolve(__dirname, "../..");
const OPEN: SaleGates = {
  seller: { legalName: "Test Seller (not real)", postalAddress: "1 Test Street" },
  fullAnalysis: { onSale: true, closedBy: null },
  pro: { onSale: true, closedBy: null },
  alertsStatable: true,
  previewOpen: false,
};

let zone = "America/New_York";
beforeEach(() => {
  zone = "America/New_York";
  auth.user = null;
  sub.active = false;
  sub.status = null;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: zone } as Intl.ResolvedDateTimeFormatOptions;
  });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const mount = (node: JSX.Element) => render(<MemoryRouter>{node}</MemoryRouter>);

describe("a browser in a territory checkout refuses", () => {
  it("sees the time-zone notice where it would buy, on both cards", () => {
    zone = "Europe/Berlin";
    const { container } = mount(<><FullAnalysisBuy gates={OPEN} /><ProBuy gates={OPEN} /></>);
    expect(container.querySelector("[data-buy]"), "a buy control rendered for a refused territory").toBeNull();
    expect(container.querySelectorAll("[data-region-notice]")).toHaveLength(2);
  });

  it("an active Pro member there still sees Manage", () => {
    zone = "Europe/Berlin";
    auth.user = { email: "member@example.test" };
    sub.active = true;
    sub.status = "active";
    const { container } = mount(<ProBuy gates={OPEN} />);
    expect(container.querySelector("[data-pro-state=active]")).not.toBeNull();
  });

  it("a browser elsewhere sees both buy controls (positive control)", () => {
    const { container } = mount(<><FullAnalysisBuy gates={OPEN} /><ProBuy gates={OPEN} /></>);
    expect(container.querySelector("[data-buy=full-analysis]")).not.toBeNull();
    expect(container.querySelector("[data-buy=pro]")).not.toBeNull();
    expect(container.querySelector("[data-region-notice]")).toBeNull();
  });

  it("while sales are closed the page asks the server nothing about the territory", () => {
    zone = "Europe/Berlin";
    const closed: SaleGates = { ...OPEN, seller: null, fullAnalysis: { onSale: false, closedBy: "seller" }, pro: { onSale: false, closedBy: "seller" } };
    mount(<><FullAnalysisBuy gates={closed} /><ProBuy gates={closed} /></>);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("the limits table's Claude Code fit row", () => {
  it("gives Pro the allowance a key on a Pro account has", () => {
    expect(MCP_FIT_FULL_PER_DAY).toBe(FIT_FULL_PER_DAY);
    expect(MCP_FIT_FULL_PER_DAY).toBe(MCP_TOOLS_FIT_FULL);
    const L = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    const { groups } = limitGroups(L, OPEN, { money: (n) => `$${n}`, count: (n) => n.toLocaleString("en-US") });
    const row = groups.flatMap((g) => g.rows).find((r) => r.id === "code-fit")!;
    expect(row.cells[2].text).toBe(`fitProKey${JSON.stringify({ n: "1,000" })}`);
    expect(row.cells[0].text).toBe(row.cells[1].text);
  });

  it("every language carries the Pro cell's sentence", () => {
    for (const f of readdirSync(resolve(ROOT, "src/i18n/shards/pricing")).filter((n) => n.endsWith(".json"))) {
      const s = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/pricing", f), "utf8")).pricingPlans.limits.fitProKey;
      expect(s, f).toContain("{{n}}");
    }
  });
});

describe("one spelling of Pro's price in its buy block", () => {
  it("the renewal line and the box's label write the price as Go Pro does, in German too", async () => {
    await i18n.changeLanguage("de");
    const { container } = mount(<ProBuyBlock gates={OPEN} onGoPro={() => {}} />);
    const text = container.textContent ?? "";
    const button = container.querySelector("[data-buy=pro]")?.textContent ?? "";
    const goProPrice = /(\d+\s?\$|\$\s?\d+)/.exec(button)?.[1];
    expect(goProPrice, "Go Pro names its price").toBeTruthy();
    expect(text).not.toMatch(/\$45\b/);
    expect(text.split(goProPrice!).length - 1, "the renewal line and the box name the price as Go Pro does").toBeGreaterThanOrEqual(3);
  });
});
