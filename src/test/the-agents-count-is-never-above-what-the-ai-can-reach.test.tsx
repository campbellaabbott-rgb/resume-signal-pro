/**
 * THE /agents COUNT IS NEVER ABOVE WHAT THE AI CAN REACH (CJ-11, GEO-1107-03,
 * 2026-11-07).
 *
 * The React hero said "Search 1,020,000+ live postings" from Claude or
 * ChatGPT (the whole board, floored to ten thousand) and the bake said
 * "950,000+", while the connector never hands on the withheld systems'
 * postings: the homepage's own line said the AI searches 939,488 of
 * 1,036,774. Both copies now print the homepage's figure, from the same read
 * (get_board_vendor_counts) and the same subtraction (aiReach), exact and
 * dated, with the line naming what stays on the website; an unread board
 * prints no figure. Judged on the rendered page, the executed bake and the
 * committed llms.txt.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bakeAgents, bakedText, SAMPLE_VENDOR_READ } from "./helpers/agents-bake";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit", "in"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
  return th;
}

import AgentConnect from "../pages/AgentConnect";
import { aiReach } from "../lib/home/board-figures";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const ROOT = resolve(__dirname, "../..");
const REACH = aiReach(SAMPLE_VENDOR_READ.counts, SAMPLE_VENDOR_READ.openTotal)!;
/** Every number a sentence prints, as integers. */
const numbers = (s: string) => [...s.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)].map((m) => Number(m[0].replace(/,/g, "")));

const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);

describe("the React /agents hero", () => {
  beforeEach(() => { rpc.mockReset(); window.history.replaceState(null, "", "/agents"); });

  it("prints the postings the AI can reach, exact, with the dated line naming what stays on the website", async () => {
    rpc.mockImplementation(async (fn: string) => fn === "get_board_vendor_counts"
      ? { data: { sourcesFacet: SAMPLE_VENDOR_READ.counts, openTotal: SAMPLE_VENDOR_READ.openTotal, as_of: SAMPLE_VENDOR_READ.asOf.toISOString() }, error: null }
      : { data: null, error: null });
    mount();
    await waitFor(() => expect(document.querySelector("[data-agents-reach]")).not.toBeNull(), SLOW);
    const hero = document.querySelector("[data-agents-hero-sub]")!.textContent!;
    expect(hero).toContain("908,491 live postings");
    expect(hero).not.toMatch(/\d\+/);
    for (const n of numbers(hero)) expect(n, "the hero prints a figure above what the AI can reach").toBeLessThanOrEqual(REACH.searchable);
    const line = document.querySelector("[data-agents-reach]")!.textContent!;
    expect(line).toBe("Your AI searches 908,491 of the 998,218 open postings: USAJOBS and SmartRecruiters postings (89,727) stay on this website. Counted 8 Nov 2026, 09:52 UTC.");
    expect(document.querySelector("[data-agents-reach] time")!.getAttribute("datetime")).toBe("2026-11-08T09:52:00.000Z");
  });

  it("an unread board prints no figure at all, never the board's floored total", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: "boom" } }));
    mount();
    await waitFor(() => expect(document.querySelector("[data-agents-hero-sub]")).not.toBeNull(), SLOW);
    const hero = document.querySelector("[data-agents-hero-sub]")!.textContent!;
    expect(numbers(hero)).toEqual([]);
    expect(document.querySelector("[data-agents-reach]")).toBeNull();
  });

  it("the page reads the homepage's reach, not the floored board total", () => {
    const src = readFileSync(resolve(ROOT, "src/pages/AgentConnect.tsx"), "utf8").replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(src).toMatch(/aiReach\(vendor\.counts, vendor\.openTotal\)/);
    expect(src).not.toMatch(/useBoardTotals|roundedFloor/);
  });
});

describe("the baked /agents", () => {
  it("prints the same reach, dated, in the lede, the description and the structured data, and never the whole board", async () => {
    const page = await bakeAgents();
    const text = bakedText(page.content);
    expect(text).toContain("908,491 live postings (counted 8 Nov 2026)");
    expect(text).toContain("Your AI searches 908,491 of the 998,218 open postings: USAJOBS and SmartRecruiters postings (89,727) stay on this website. Counted 8 Nov 2026, 09:52 UTC.");
    expect(page.description).toContain("908,491 live postings");
    // The harness hands the block a board total of 1,024,524 and a floor
    // that prints "N+": neither may reach the page.
    expect(text).not.toMatch(/1024524|1,024,524|\d\+ live postings/);
    expect(page.description).not.toMatch(/\d\+/);
    for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+) live postings/g)) {
      expect(Number(m[1].replace(/,/g, "")), "a baked figure above what the AI can reach").toBeLessThanOrEqual(REACH.searchable);
    }
  });

  it("an unread board bakes no figure", async () => {
    const page = await bakeAgents({ read: null });
    const text = bakedText(page.content);
    expect(text).not.toMatch(/\d[\d,]* live postings/);
    expect(text).not.toContain("Your AI searches");
    expect(page.description).not.toMatch(/\d/);
  });

  it("teeth: a read whose withheld systems are missing is unmeasured, and bakes no figure rather than the whole board", async () => {
    const { usajobs: _u, ...rest } = SAMPLE_VENDOR_READ.counts;
    const page = await bakeAgents({ read: { ...SAMPLE_VENDOR_READ, counts: rest } });
    expect(bakedText(page.content)).not.toMatch(/\d[\d,]* live postings/);
  });
});

describe("the committed llms.txt", () => {
  it("states the reach as the page does, and its numbers add up: reachable plus withheld is the total", () => {
    const llms = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
    const m = /Your AI searches ([\d,]+) of the ([\d,]+) open postings: USAJOBS and SmartRecruiters postings \(([\d,]+)\) stay on this website\. Counted [^.]+ UTC\./.exec(llms);
    expect(m, "llms.txt lost the reach sentence the bake refreshes").not.toBeNull();
    const [reach, total, withheld] = m!.slice(1, 4).map((x) => Number(x.replace(/,/g, "")));
    expect(reach + withheld).toBe(total);
    expect(reach).toBeLessThan(total);
    // The bake restates it from a live read with the same pattern.
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toContain("if (LLMS_REACH_LINE) sub(/Your AI searches [\\d,]+ of the [\\d,]+ open postings: [^.]+\\. Counted [^.]+ UTC\\./, LLMS_REACH_LINE);");
  });
});
