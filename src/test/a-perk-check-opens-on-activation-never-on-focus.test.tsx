/**
 * A PERK CHECK OPENS ON ACTIVATION, NEVER ON FOCUS (design spec 5.5a, audit CP20).
 *
 * The perks list opened a check's panel on keyboard focus, so a keyboard user
 * tabbing through it pushed every later check down under them; and a green
 * check appeared at 2 of 20 postings, which reads as "offered". Held here:
 *   - focus opens nothing; click, tap, Enter and Space each flip the panel;
 *   - a mouse hover shows a preview laid over the list (it never moves the
 *     list), without a link, aria-hidden, dismissed by Escape;
 *   - a check marks a perk stated in at least half the readable postings;
 *     under half (but over the threshold) sits in "In some of their postings"
 *     with a hollow dot;
 *   - each row is a button at least 32px tall.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null })) } }));

import { CompanyPerksView } from "@/components/jobs/CompanyPerks";
import { PERK_CHECK_MIN_SHARE, perkMark, readEmployerPerks } from "@/lib/employer-perks";

const AS_OF = "2026-10-12T12:00:00Z";
const row = (o: Record<string, unknown>) => ({
  source: "greenhouse", country: "US", perk: "health", k: 212, n: 240, qualified_share: 0, standard_text: false, as_of: AS_OF,
  quote: "Comprehensive medical, dental and vision insurance", quote_posting_id: "greenhouse:acme:4012345", baseline: null, ...o,
});
const ANSWER = {
  token: "acme", collision: false, published_keys: ["health", "dental", "pto", "retire"], withheld: [],
  perks: [
    row({}),
    row({ perk: "dental", k: 12, n: 24, quote: "Dental from day one" }),
    row({ perk: "pto", k: 9, n: 30, quote: "Generous paid time off" }),
    row({ perk: "retire", k: 3, n: 30, quote: "401(k) with match" }),
  ],
};
const show = () => render(<MemoryRouter><CompanyPerksView answer={readEmployerPerks(ANSWER)} /></MemoryRouter>);
const panelOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-controls")!)!;

describe("the mark says how many postings state it", () => {
  it("a check at half or more, a hollow dot under half, in whole numbers", () => {
    expect(PERK_CHECK_MIN_SHARE).toBe(0.5);
    expect(perkMark({ k: 12, n: 24 })).toBe("check");
    expect(perkMark({ k: 212, n: 240 })).toBe("check");
    expect(perkMark({ k: 11, n: 24 })).toBe("some");
    expect(perkMark({ k: 2, n: 20 })).toBe("some");
    expect(perkMark({ k: 0, n: 0 })).toBe("some");
  });

  it("checks sit first; the rest sit under 'In some of their postings' with a dot, not a check", () => {
    const { container } = show();
    const marks = Array.from(container.querySelectorAll<HTMLElement>("[data-perk]")).map((li) => [li.getAttribute("data-perk"), li.getAttribute("data-perk-mark")]);
    // In the list's own key order (health, dental, ..., retire, pto), checks first.
    expect(marks).toEqual([["health", "check"], ["dental", "check"], ["retire", "some"], ["pto", "some"]]);
    const some = container.querySelector<HTMLElement>("[data-perks-some]")!;
    expect(within(some).getByRole("heading", { level: 3 }).textContent).toBe("In some of their postings");
    expect(some.querySelectorAll(".lucide-check")).toHaveLength(0);
    expect(some.querySelectorAll(".lucide-circle")).toHaveLength(2);
    expect(container.querySelectorAll(".lucide-check")).toHaveLength(2);
    expect(screen.getByText("Not listed doesn't mean not offered. Tap a perk to see how many postings state it.")).toBeInTheDocument();
  });

  it("every row is a button at least 32px tall", () => {
    show();
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/\bmin-h-8\b/);
  });
});

describe("activation opens it; focus never does", () => {
  it("Tab focuses a check and opens nothing; Enter opens it, Space closes it, a click opens it again", async () => {
    const user = userEvent.setup();
    show();
    const health = screen.getByRole("button", { name: /Health insurance/ });
    await user.tab();
    expect(health).toHaveFocus();
    expect(health).toHaveAttribute("aria-expanded", "false");
    expect(panelOf(health)).not.toBeVisible();
    await user.tab();
    expect(screen.getByRole("button", { name: /Dental coverage/ })).toHaveFocus();
    expect(document.querySelectorAll("[id$='-basis']:not([hidden])")).toHaveLength(0);
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");
    expect(health).toHaveAttribute("aria-expanded", "true");
    expect(panelOf(health)).toBeVisible();
    expect(within(panelOf(health)).getByRole("link", { name: "See the posting this line comes from" })).toBeInTheDocument();
    await user.keyboard(" ");
    expect(health).toHaveAttribute("aria-expanded", "false");
    await user.click(health);
    expect(health).toHaveAttribute("aria-expanded", "true");
  });

  it("an open panel stays open when focus moves on; opening another closes it", async () => {
    const user = userEvent.setup();
    show();
    const health = screen.getByRole("button", { name: /Health insurance/ });
    const dental = screen.getByRole("button", { name: /Dental coverage/ });
    await user.click(health);
    await user.tab();
    await user.tab();
    expect(health, "a disclosure does not close because focus left it").toHaveAttribute("aria-expanded", "true");
    await user.click(dental);
    expect(dental).toHaveAttribute("aria-expanded", "true");
    expect(health).toHaveAttribute("aria-expanded", "false");
  });

  it("a hover previews the count and the quote over the list, opens no panel, and Escape dismisses it", async () => {
    const user = userEvent.setup();
    show();
    const health = screen.getByRole("button", { name: /Health insurance/ });
    await user.hover(health);
    const preview = health.closest("li")!.querySelector<HTMLElement>("[data-perk-preview]")!;
    expect(preview).toBeTruthy();
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview.className).toMatch(/\babsolute\b/);
    expect(preview.textContent).toContain("Stated in at least 212 of 240 open United States postings we could read, read Oct 12, 2026.");
    expect(preview.textContent).toContain("Comprehensive medical, dental and vision insurance");
    expect(preview.querySelector("a")).toBeNull();
    expect(health).toHaveAttribute("aria-expanded", "false");
    expect(panelOf(health)).not.toBeVisible();
    await user.keyboard("{Escape}");
    expect(health.closest("li")!.querySelector("[data-perk-preview]")).toBeNull();
    await user.hover(health);
    await user.unhover(health);
    expect(health.closest("li")!.querySelector("[data-perk-preview]")).toBeNull();
  });

  it("a touch tap opens the panel in the flow and shows no preview", async () => {
    const user = userEvent.setup();
    show();
    const health = screen.getByRole("button", { name: /Health insurance/ });
    await user.pointer({ keys: "[TouchA]", target: health });
    expect(health).toHaveAttribute("aria-expanded", "true");
    expect(health.closest("li")!.querySelector("[data-perk-preview]")).toBeNull();
    expect(panelOf(health).className).not.toMatch(/\b(absolute|fixed)\b/);
  });
});
