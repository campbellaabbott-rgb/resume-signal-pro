/**
 * THE GAP REPORT'S HAND-OFF NAMES THE RÉSUMÉ IT WAS MADE FOR (S14X-285, the
 * account half).
 *
 * WHAT WAS WRONG. "Fix these in the builder" wrote the missing keywords to
 * the session (rb_scan_fixes) with nothing binding them to a text, so the
 * builder applied them to whatever résumé the session held, including one
 * pasted later in another tab.
 *
 * WHAT HOLDS NOW: the hand-off carries builder-import's textFingerprint of
 * the résumé it put in the session, so the builder can drop a hand-off made
 * for a different text. (Reading it is the builder's half.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GapReport } from "@/components/account/GapReport";
import { textFingerprint } from "@/lib/builder-import";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importActual) => ({
  ...(await importActual<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

afterEach(() => { cleanup(); sessionStorage.clear(); navigate.mockReset(); });

const RESUME = "Jane Doe\nData engineer, eight years of Python and dbt.";

describe("opening the builder from the gap report", () => {
  it("hands over the keywords with the fingerprint of the résumé it put in the session", () => {
    render(<MemoryRouter><GapReport gaps={[["kubernetes", 4], ["terraform", 3]]} withFit={6} resumeText={RESUME} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button"));
    expect(navigate).toHaveBeenCalledWith("/builder");
    expect(sessionStorage.getItem("rb_resume_text")).toBe(RESUME);
    const handOff = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "{}");
    expect(handOff.keywords).toEqual(["kubernetes", "terraform"]);
    expect(handOff.fingerprint).toBe(textFingerprint(RESUME));
  });
});
