/**
 * THE SWITCH-OVER CANNOT ROUTE A PAGE THAT SHOWS A CUT PRODUCT.
 *
 * Both new pages render today's shared chrome: the Header (a filled Start
 * button beside the page's one filled button) and the Footer, whose
 * resources list still links "Freelance Boost". Owner decision: a cut
 * product is never shown. The chrome belongs to hp/honesty, and this round
 * may not edit it, so the gate sits here and fires the moment it matters:
 *
 *   - always: the page's own content (<main>) names no cut product, and every
 *     cut name on the page sits in the shared header or footer;
 *   - THE GATE: once src/App.tsx routes either new page, the whole rendered
 *     page (header, main and footer) names no cut product, the header carries
 *     no filled button, and main carries exactly one. The pre-push suite then
 *     fails until hp/honesty's quiet Header and its Footer without Freelance
 *     Boost have landed (docs/homepage-pricing/README.md, switch-over step 9).
 *
 * HP_ASSUME_ROUTED=1 runs the gate as if the switch-over had happened, so the
 * integrator can check readiness before editing App.tsx. On this branch it
 * fails on the Footer's Freelance Boost and the Header's filled Start.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
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
import PricingPage from "@/pages/pricing/PricingPage";
import { PASS, PRODUCTS, SUBSCRIPTIONS } from "@/config/products";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

/** Every product the owner cut, by the names a reader would see. */
const CUT_NAMES: readonly string[] = [
  ...new Set([
    ...Object.entries(PRODUCTS).filter(([id]) => id !== "fullAnalysis").map(([, p]) => p.name),
    SUBSCRIPTIONS.agent.name,
    PASS.name,
    "Freelance Boost",
    "Transition Pro",
    "Scan Pack",
    "Premium",
    "Apply Agent",
    "Apply Assistant",
    "Agent plan",
    "Agent Pass",
  ]),
];
const CUT = new RegExp(`${CUT_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|\\bun${"limited"}\\b`, "gi");

/** True once App.tsx routes either new page (switch-over step 1), or when asked to assume it. */
export function switchedOver(appSource: string): boolean {
  return /pages\/home\/HomePage|pages\/pricing\/PricingPage/.test(appSource);
}
const ROUTED = process.env.HP_ASSUME_ROUTED === "1" || switchedOver(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));

type Where = "header" | "main" | "footer" | "elsewhere";
interface Leak { name: string; where: Where }

function leaksIn(root: HTMLElement): Leak[] {
  const out: Leak[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    for (const m of text.matchAll(CUT)) {
      const el = n.parentElement;
      const where: Where = el?.closest("header") ? "header" : el?.closest("main") ? "main" : el?.closest("footer") ? "footer" : "elsewhere";
      out.push({ name: m[0], where });
    }
  }
  return out;
}

const filled = (scope: Element | null) =>
  scope ? [...scope.querySelectorAll<HTMLElement>("button, a")].filter((e) => /(^|\s)bg-primary(\s|$)/.test(e.className)) : [];

async function mountPage(which: "home" | "pricing"): Promise<HTMLElement> {
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[which === "home" ? "/" : "/pricing"]}>
          {which === "home" ? <HomePage /> : <PricingPage />}
        </MemoryRouter>
      </HelmetProvider>,
    ));
  });
  return container;
}

describe("the switch-over gate on the shared chrome", () => {
  it("the gate reads App.tsx: today's routes do not count as switched over", () => {
    expect(switchedOver('const Index = lazy(() => import("./pages/Index"));')).toBe(false);
    expect(switchedOver('const HomePage = lazy(() => import("./pages/home/HomePage"));')).toBe(true);
    expect(switchedOver('const Pricing = lazy(() => import("./pages/pricing/PricingPage"));')).toBe(true);
  });

  for (const which of ["home", "pricing"] as const) {
    it(`${which}: the page's own content names no cut product; any cut name sits in the shared chrome`, async () => {
      const page = await mountPage(which);
      expect(page.querySelector("main")).not.toBeNull();
      const leaks = leaksIn(page);
      expect(leaks.filter((l) => l.where === "main" || l.where === "elsewhere")).toEqual([]);
      expect(filled(page.querySelector("main")).length, "one filled button in the page's own content").toBe(1);
    });

    it(`${which}: THE GATE: once routed, nothing on the whole page names a cut product, and the header has no filled button`, async () => {
      const page = await mountPage(which);
      if (!ROUTED) {
        // Before the switch-over the gate is armed but not yet live. It goes
        // live in the same commit that routes the page.
        expect(switchedOver(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"))).toBe(false);
        return;
      }
      expect(leaksIn(page), "a cut product on a routed page (Footer or Header: hp/honesty)").toEqual([]);
      expect(filled(page.querySelector("header")).map((e) => e.textContent), "a filled button in the header beside the page's one").toEqual([]);
      expect(filled(page.querySelector("main")).length).toBe(1);
    });
  }
});
