// @vitest-environment jsdom
/**
 * /COMPANIES DATES ITS COUNTS AND SAYS WHOSE SYSTEMS THESE ARE.
 *
 * Honesty review of 3ebdcbb2 (2026-10-12): the redesigned directory read
 * "Every posting comes from the employer's own hiring system — no
 * aggregators, no reposts." directly above a list whose seventh row was
 * USAJOBS (9,648 open roles), which the company page itself calls a federal
 * listing site, not an employer; and its board count and every row's figure
 * carried no date. The text had been carried into nine languages.
 *
 * Held here, in every locale: no "no aggregators" sentence; the intro names
 * USAJOBS and staffing-agency boards for what they are; every count prints
 * under the date of the board's count pass (the reply's refreshedAt); and a
 * reply with no such time prints names only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import Companies from "@/pages/Companies";

const ROOT = resolve(__dirname, "../..");
const SHARDS = resolve(ROOT, "src/i18n/shards/company");
const REPLY = {
  companies: [
    { token: "dominos", name: "Domino's", open: 21066 },
    { token: "usajobs", name: "USAJOBS", open: 9648 },
  ],
  companiesOpenCount: 32060,
};
const SLOW = { timeout: 4000 } as const;

beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); });
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); });

describe("the intro", () => {
  it.each(readdirSync(SHARDS).filter((f) => f.endsWith(".json")))("%s: names agencies and USAJOBS, and makes no 'no aggregators' claim", (f) => {
    const dir = (JSON.parse(readFileSync(resolve(SHARDS, f), "utf8")) as { companyProfile: { directory: Record<string, string> } }).companyProfile.directory;
    expect(dir.intro, "the old blanket claim is gone from the shard").toBeUndefined();
    expect(dir.intro2).toContain("USAJOBS");
    expect(dir.countedAgo).toContain("{{ago}}");
  });

  it("the rendered page says it too", async () => {
    invoke.mockResolvedValue({ data: { ...REPLY, refreshedAt: new Date(Date.now() - 22 * 60_000).toISOString() }, error: null });
    render(<MemoryRouter><Companies /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("Domino's"), SLOW);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/no aggregators/i);
    expect(text).toMatch(/USAJOBS is the federal government's listing site/);
  });
});

describe("the counts", () => {
  it("print under the date of the board's count", async () => {
    invoke.mockResolvedValue({ data: { ...REPLY, refreshedAt: new Date(Date.now() - 22 * 60_000).toISOString() }, error: null });
    render(<MemoryRouter><Companies /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("21,066 open roles"), SLOW);
    expect(document.querySelector("h1")?.textContent).toBe("32,060 company job boards hiring now");
    expect(document.querySelector("[data-directory-counted]")?.textContent).toBe("Counts from the board's last count, 22 min ago.");
  });

  it("are withheld when the reply carries no count time: names only", async () => {
    invoke.mockResolvedValue({ data: REPLY, error: null });
    render(<MemoryRouter><Companies /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toContain("Domino's"), SLOW);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/21,066|9,648|32,060/);
    expect(document.querySelector("h1")?.textContent).toBe("Companies hiring now");
    expect(document.querySelector("[data-directory-counted]")).toBeNull();
  });
});
