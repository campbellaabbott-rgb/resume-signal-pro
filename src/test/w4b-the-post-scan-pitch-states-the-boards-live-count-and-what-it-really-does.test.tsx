/**
 * THE POST-SCAN PITCH STATES THE BOARD'S LIVE COUNT, AND WHAT IT REALLY DOES (S12-136).
 *
 * Under every signed-out report, the account pitch said the job board "ranks
 * all ~40,000 live openings" against the résumé, every visit. The board
 * serves about a million openings, and it scores the openings a person is
 * looking at, not all of them. The figure was frozen and the verb was wrong.
 *
 * Now the pitch says the board scores each opening you look at, and names the
 * board's own live count (rounded down) only when the board stated one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
const board = vi.hoisted(() => ({ totals: null as null | { jobs: number; feeds: number | null; tracked: number | null } }));
vi.mock("@/hooks/use-board-totals", async (orig) => {
  const real = await orig<typeof import("@/hooks/use-board-totals")>();
  return { ...real, useBoardTotals: () => board.totals };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: async () => ({ error: null }) }) } }));

import { SaveResumeVersion } from "@/components/SaveResumeVersion";

afterEach(() => { cleanup(); auth.user = null; board.totals = null; });

const mount = () => render(<MemoryRouter><SaveResumeVersion resumeText="Jane Doe, engineer." score={71} /></MemoryRouter>);

describe("the signed-out pitch", () => {
  it("names the board's live count, rounded down, and says it scores the openings you look at", () => {
    board.totals = { jobs: 1_023_456, feeds: null, tracked: null };
    const text = mount().container.textContent ?? "";
    expect(text).toContain("scores each opening you look at");
    expect(text).toContain((1_020_000).toLocaleString());
    expect(text).not.toMatch(/40,000|ranks all/);
  });

  it("states no number at all when the board stated none", () => {
    const text = mount().container.textContent ?? "";
    expect(text).toContain("scores each opening you look at");
    expect(text).not.toMatch(/\d{2},\d{3}/);
    expect(text).not.toMatch(/ranks all/);
  });
});

describe("the signed-in explainer", () => {
  it("no longer claims fit-ranking across ~40,000 openings", () => {
    auth.user = { id: "u1" };
    const text = mount().container.textContent ?? "";
    expect(text).toContain("fit scores on the openings you browse");
    expect(text).not.toMatch(/40,000/);
  });
});
