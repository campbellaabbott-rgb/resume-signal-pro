/**
 * A LINK DRAWN AS A BUTTON OR A CHIP IS 44PX UNDER A FINGER (spec section 8).
 *
 * index.css sets `a[href] { min-height: 24px }` in its base layer. Tailwind
 * 3's @layer is not a native cascade layer, so specificity decides, and
 * a[href] (0,1,1) beats any single-class utility (0,1,0): `min-h-10` or
 * `coarse:min-h-11` on a link never applies. Measured on hp/integration
 * 70e4e525 at 375 px under a coarse pointer, "See all postings", "Create a
 * free account", "Scan my résumé free", the AI buttons and the pricing jump
 * links were 38 px tall, the field chips 28 px, the pricing CTA 40 px. A
 * <button> is unaffected (`button` is 0,0,1).
 *
 * jsdom computes no layout, so this holds the cascade rule on what renders:
 * on every link in the pages' own content (the board's JobCard rows are the
 * design train's and are left out),
 *   - no min-height utility that cannot win, unless an important one
 *     (`!min-h-…`) on the same link sets the floor (the Button primitive's
 *     own `wrap` variant adds a min-h-10 that only an important class beats);
 *   - every link drawn as a box (a border or a fill) has a 44 px floor under
 *     a coarse pointer that can win (`coarse:!min-h-11` or a height).
 * The headless run under a coarse pointer measures the result
 * (docs/homepage-pricing/README.md, "What was measured").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    rpc: async () => ({ data: null, error: null }),
    from: () => stubTable(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import HomePage from "@/pages/home/HomePage";
import { PricingView } from "@/components/pricing/PricingView";
import { resolveSaleGates } from "@/components/pricing/sale-gates";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

const OPEN_GATES = { seller: true, fullAnalysisOnSale: true, proOnSale: true, fullAnalysisDelivers: true, alertsStatable: true };

/** A min-height utility a[href] beats: any variant chain, then min-h- without "!". */
const LOSES = /^(?:[\w-]+:)*min-h-/;
/** A link drawn as a box: a border or a fill, not a text link. */
const isBox = (cls: string[]) => cls.some((c) => /^(?:border|border-[\w-]+|bg-(?!clip)[\w-]+)$/.test(c)) && !cls.includes("link");
/** A 44 px floor under a coarse pointer that a[href] cannot beat. */
const COARSE_FLOOR = /^(?:coarse:!min-h-11|!min-h-11|coarse:!?h-11|!?h-11)$/;
/** An important min-height, which beats a[href]. */
const WINS = /^(?:[\w-]+:)*!min-h-/;

function audit(scope: Element): string[] {
  const problems: string[] = [];
  for (const a of scope.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (a.closest("[data-home-rows]")) continue;
    const cls = a.className.split(/\s+/).filter(Boolean);
    const label = `${(a.textContent ?? "").trim().slice(0, 40)} (${a.getAttribute("href")})`;
    const floored = cls.some((c) => WINS.test(c));
    if (!floored) for (const c of cls) if (LOSES.test(c)) problems.push(`${label}: "${c}" never applies to a link`);
    if (isBox(cls) && !cls.some((c) => COARSE_FLOOR.test(c))) problems.push(`${label}: a box link with no 44px floor under a finger`);
  }
  return problems;
}

describe("links drawn as buttons and chips reach 44px under a finger", () => {
  it("the homepage, every gate open (account strip, plan strip, scan and AI buttons, field chips)", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <HelmetProvider>
          <MemoryRouter>
            <HomePage gates={OPEN_GATES} />
          </MemoryRouter>
        </HelmetProvider>,
      ));
    });
    const main = container.querySelector("main")!;
    expect(main.querySelectorAll("a[href]").length).toBeGreaterThan(10);
    expect(audit(main)).toEqual([]);
  });

  for (const [name, input] of [["as shipped", undefined], ["preview forced open", { previewOpen: true }]] as const) {
    it(`the pricing page, ${name} (jump links, the free account button, the Full Analysis buy link)`, () => {
      const { container } = render(
        <MemoryRouter>
          <PricingView postings={{ openTotal: 1040488, asOf: "2026-10-17T22:45:00Z" }} gates={resolveSaleGates(input)} />
        </MemoryRouter>,
      );
      expect(container.querySelectorAll("a[href]").length).toBeGreaterThan(5);
      expect(audit(container)).toEqual([]);
    });
  }
});
