/**
 * THE COMPANY FILTER BAR CANNOT FILTER THE COMPANY OFF ITS OWN PAGE.
 *
 * Audit 2026-10-11: the lander for "clear" carried the board's generic
 * company box reading "CLEAR - Corporat" under an H1 that said "Clear", and
 * /blackstone offered "Remove Blackstone — 990,031 openings" on a page whose
 * only reason to exist is Blackstone. On /jobs/company/<token> the token is
 * the page's scope: no Company control, no company chip, and "Clear all
 * filters" leaves the scope alone. The board variant is the positive
 * control: there a company IS a filter and can be removed.
 *
 * Also held: every active filter is a chip whose remove button says what it
 * removes; work mode is trinary (no fourth "not stated" option); the keyword
 * box is labelled, never named by its placeholder; a count prints beside an
 * option only when the caller passes a measured one.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FilterBar, activeChips, clearAllPatch, type FilterBarValue } from "@/components/jobs/FilterBar";

const BASE: FilterBarValue = {
  q: "",
  location: "",
  workMode: "",
  employmentType: "",
  freshness: "",
  category: "",
  experience: "",
  statedPayOnly: false,
  vendor: "",
  country: "",
  hideAgencies: false,
  companyTokens: [],
};
const OPTIONS = {
  fields: [{ value: "healthcare", label: "Healthcare & Clinical", count: 1653 }, { value: "engineering", label: "Engineering & IT" }],
  seniority: [{ value: "entry", label: "Entry (0–2 yrs)" }],
  systems: [{ value: "greenhouse", label: "Greenhouse" }, { value: "bamboohr", label: "BambooHR" }],
  countries: [{ value: "US", label: "United States" }],
};

function mount(variant: "board" | "company", value: Partial<FilterBarValue>, onChange = vi.fn()) {
  render(
    <FilterBar
      variant={variant}
      value={{ ...BASE, ...value }}
      onChange={onChange}
      options={OPTIONS}
      companyLabels={{ blackstone: "Blackstone" }}
      company={variant === "company" ? { name: "Blackstone", openRoles: { value: 23, floor: false, asOf: null } } : undefined}
    />,
  );
  return onChange;
}

describe("on a company page", () => {
  const scoped: Partial<FilterBarValue> = { companyTokens: ["blackstone"], workMode: "remote", freshness: "7" };

  it("there is no company chip and no control that names the company as a filter", () => {
    mount("company", scoped);
    expect(screen.queryByRole("button", { name: /Remove filter: Blackstone/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /company/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /company/i })).toBeNull();
    // The visitor's own filters are still removable.
    expect(screen.getByRole("button", { name: "Remove filter: Remote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter: This week" })).toBeTruthy();
  });

  it("'Clear all filters' clears the visitor's filters and leaves the scope", () => {
    const onChange = mount("company", scoped);
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    const patch = onChange.mock.calls.at(-1)![0] as Partial<FilterBarValue>;
    expect(patch).not.toHaveProperty("companyTokens");
    expect(patch.workMode).toBe("");
    expect(patch.freshness).toBe("");
    expect(clearAllPatch("company")).not.toHaveProperty("companyTokens");
  });

  it("the chip list never yields the company, whatever the value holds", () => {
    const chips = activeChips({ ...BASE, ...scoped, companyTokens: ["blackstone", "another"] }, "company", {
      freshness: String, workMode: String, employment: String, option: (_g, v) => v,
      payStated: "States pay", hideAgencies: "No agencies", company: (t) => t,
    });
    expect(chips.some((c) => c.key.startsWith("company:") || "companyTokens" in c.remove)).toBe(false);
  });

  it("the keyword box searches this employer's roles, with a real label", () => {
    mount("company", scoped);
    const box = screen.getByRole("searchbox", { name: "Search jobs by title or keyword" });
    expect(box.getAttribute("placeholder")).toBe("Search 23 roles at Blackstone");
  });

  it("a generic board label never enters the placeholder sentence", () => {
    render(
      <FilterBar variant="company" value={{ ...BASE, companyTokens: ["MIC1003MEI"] }} onChange={vi.fn()} options={OPTIONS}
        company={{ name: "Corporate", generic: true, openRoles: { value: 40, floor: false, asOf: null } }} />,
    );
    expect(screen.getByRole("searchbox", { name: "Search jobs by title or keyword" }).getAttribute("placeholder")).toBe("Title or keyword");
  });
});

describe("positive control: on the board a company is a filter", () => {
  it("shows a removable company chip, and Clear all removes it", () => {
    const onChange = mount("board", { companyTokens: ["blackstone"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Blackstone" }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ companyTokens: [] });
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onChange.mock.calls.at(-1)![0]).toHaveProperty("companyTokens", []);
  });
});

describe("the filter sheet", () => {
  it("work mode is trinary, options are toggle buttons, and counts print only when measured", () => {
    const onChange = mount("board", {});
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    const workMode = within(dialog).getByRole("group", { name: "Work mode" });
    const modes = within(workMode).getAllByRole("button").map((b) => b.textContent);
    expect(modes).toEqual(["Remote", "Hybrid", "On-site"]);
    for (const b of within(workMode).getAllByRole("button")) expect(b.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(within(workMode).getByRole("button", { name: "Hybrid" }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ workMode: "hybrid" });

    const field = within(dialog).getByRole("group", { name: "Field" });
    // The measured count prints, formatted; the unmeasured option shows none.
    expect(within(field).getByRole("button", { name: /Healthcare & Clinical\s*1,653/ })).toBeTruthy();
    expect(within(field).getByRole("button", { name: "Engineering & IT" }).textContent).toBe("Engineering & IT");
  });

  it("the Filters button counts the active filters", () => {
    mount("board", { workMode: "remote,hybrid", statedPayOnly: true });
    expect(screen.getByRole("button", { name: "Filters (3)" })).toBeTruthy();
  });

  it("a pressed option says so with aria-pressed and a check, not colour alone", () => {
    mount("board", { workMode: "remote" });
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
    const pressed = within(screen.getByRole("group", { name: "Work mode" })).getByRole("button", { name: "Remote" });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.querySelector("svg")).toBeTruthy();
  });
});
