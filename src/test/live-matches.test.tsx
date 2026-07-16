// The report's live-matches card: fit-ranked top 5 from mocked board
// responses; when the board fails or returns nothing it degrades to a plain
// board CTA (no per-posting claims) instead of vanishing — the handoff to
// the jobs board is the report's strongest next step and must survive.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { LiveMatches } from "../components/LiveMatches";

// Five jobs so the component's "<5 results -> category fallback" second
// list call never fires and the mock sequence stays [list, fit-batch].
const JOBS = [
  { id: "a", company: "Oscar Health", title: "Nurse Practitioner", location: "NY", salary: null, applyUrl: "https://x/1" },
  { id: "b", company: "One Medical", title: "RN, Primary Care", location: "SF", salary: "$90k–120k", applyUrl: "https://x/2" },
  { id: "c", company: "Talkspace", title: "Therapist", location: "Remote", salary: null, applyUrl: "https://x/3" },
  { id: "d", company: "Privia", title: "Care Coordinator", location: "TX", salary: null, applyUrl: "https://x/4" },
  { id: "e", company: "ChenMed", title: "Medical Assistant", location: "FL", salary: null, applyUrl: "https://x/5" },
];

beforeEach(() => invoke.mockReset());

describe("LiveMatches", () => {
  it("ranks by fit and renders salary + apply links", async () => {
    invoke
      .mockResolvedValueOnce({ data: { jobs: JOBS } })
      .mockResolvedValueOnce({ data: { fits: { a: 12, b: 24, c: 3, d: 8, e: 5 } } });
    render(<MemoryRouter><LiveMatches resumeText={"nurse ".repeat(30)} industry="healthcare" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("RN, Primary Care")).toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("One Medical"); // fit 24 first
    expect(items[0].textContent).toContain("$90k–120k");
    expect(screen.getAllByRole("link", { name: /Apply/i })[0]).toHaveAttribute("href", "https://x/2");
  });

  it("falls back to a plain board CTA when the board returns no jobs", async () => {
    invoke.mockResolvedValue({ data: { jobs: [] } }); // both list calls return empty
    render(<MemoryRouter><LiveMatches resumeText="r" industry="healthcare" /></MemoryRouter>);
    const cta = await screen.findByRole("link", { name: /Open the live job board/i });
    expect(cta).toHaveAttribute("href", "/jobs");
    // No per-posting claims in the degraded state: no match list, no fit badges.
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText(/fit \d+%/)).toBeNull();
  });

  it("falls back to a plain board CTA when the board errors — the report never looks broken", async () => {
    // supabase-js resolves with an error field rather than throwing.
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<MemoryRouter><LiveMatches resumeText="r" industry="technology" /></MemoryRouter>);
    const cta = await screen.findByRole("link", { name: /Open the live job board/i });
    expect(cta).toHaveAttribute("href", "/jobs");
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
