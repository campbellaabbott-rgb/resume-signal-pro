/**
 * REMOVING A FILTER CHIP KEEPS KEYBOARD FOCUS IN THE FILTER ROW.
 *
 * Accessibility review of 3ebdcbb2 (2026-10-12), on G1's FilterBar (board and
 * company variants, 1280 and 375):
 *   - focusing "Remove filter: Last 3 days" and pressing Enter, or pressing
 *     "Clear all filters", unmounted the focused button and focus fell to
 *     <body>: a keyboard user was thrown to the top of the document on the
 *     search path (WCAG 2.4.3);
 *   - the visually hidden submit button was a Tab stop on a 1x1px box, so
 *     focus vanished between the sort and the first chip (WCAG 2.4.7);
 *   - in the company variant inside the lander's left column the single row
 *     left the location box 50px wide, placeholder gone, label sr-only.
 *
 * The parent here applies each patch the way Jobs.tsx does (state in, patch
 * out), so the chips really unmount.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { FilterBar, type FilterBarValue } from "@/components/jobs/FilterBar";

const BASE: FilterBarValue = {
  q: "", location: "", workMode: "remote,hybrid", employmentType: "", freshness: "3", category: "",
  experience: "", statedPayOnly: false, vendor: "", country: "", hideAgencies: false, companyTokens: [],
};
const OPTIONS = { fields: [], seniority: [], systems: [], countries: [] };

function Harness({ variant = "board" as "board" | "company" }) {
  const [value, setValue] = useState(BASE);
  return (
    <>
      <FilterBar
        variant={variant}
        value={value}
        onChange={(p) => setValue((v) => ({ ...v, ...p }))}
        options={OPTIONS}
        company={variant === "company" ? { name: "Blackstone", openRoles: { value: 1653, floor: false, asOf: null } } : undefined}
        sort={{ value: "newest", options: [{ value: "newest", label: "Newest" }], onChange: () => {} }}
      />
      <button type="button">after the row</button>
    </>
  );
}

const removers = () => screen.getAllByRole("button", { name: /^Remove filter: / });

describe.each(["board", "company"] as const)("the %s variant", (variant) => {
  it("Enter on a chip's remove button moves focus to the chip that took its place", async () => {
    const user = userEvent.setup();
    render(<Harness variant={variant} />);
    const names = removers().map((b) => b.getAttribute("aria-label"));
    expect(names.length).toBe(3);
    removers()[0].focus();
    await user.keyboard("{Enter}");
    expect(removers()).toHaveLength(2);
    expect(document.activeElement, "focus fell to <body>").not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(names[1]);
  });

  it("removing the last chip in the row moves focus to the one before it, then the last of all to Filters", async () => {
    const user = userEvent.setup();
    render(<Harness variant={variant} />);
    const names = removers().map((b) => b.getAttribute("aria-label"));
    removers()[2].focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(names[1]);
    await user.keyboard("{Enter}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(names[0]);
    await user.keyboard("{Enter}");
    expect(screen.queryAllByRole("button", { name: /^Remove filter: / })).toHaveLength(0);
    expect(document.activeElement?.textContent).toMatch(/^Filters$/);
  });

  it("'Clear all filters' moves focus to the Filters button", async () => {
    const user = userEvent.setup();
    render(<Harness variant={variant} />);
    screen.getByRole("button", { name: "Clear all filters" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toMatch(/^Filters$/);
  });

  it("the hidden submit button is not a Tab stop, and Enter in the keyword box still submits", async () => {
    const user = userEvent.setup();
    render(<Harness variant={variant} />);
    const submit = screen.getByRole("button", { name: "Search" });
    expect(submit.getAttribute("tabindex")).toBe("-1");
    const stops: string[] = [];
    screen.getByRole("searchbox", { name: "Search jobs by title or keyword" }).focus();
    for (let i = 0; i < 8; i++) {
      stops.push(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "");
      await user.tab();
    }
    expect(stops).not.toContain("Search");
  });
});

it("the company variant wraps: keyword on its own row, location with a floor width beside Filters and the sort", () => {
  render(<Harness variant="company" />);
  const form = screen.getByRole("search");
  expect(form.className).toMatch(/\bsm:flex-wrap\b/);
  const keyword = screen.getByRole("searchbox", { name: "Search jobs by title or keyword" });
  expect(keyword.closest("div.min-w-0")?.className).toMatch(/\bsm:basis-full\b/);
  const location = screen.getByRole("searchbox", { name: "Location" });
  expect(location.closest("div.flex")?.className).toMatch(/sm:min-w-\[12rem\]/);
});

it("positive control: the board variant keeps its one row", () => {
  render(<Harness variant="board" />);
  expect(screen.getByRole("search").className).not.toMatch(/\bsm:flex-wrap\b/);
});
