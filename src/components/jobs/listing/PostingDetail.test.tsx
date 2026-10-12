// @vitest-environment jsdom
/**
 * The pane, mounted from fixtures: where the posting stands, the decision
 * row's order, the facts' bases, the open-roles link and the slots.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { PostingDetail } from "./PostingDetail";
import type { ListingJob } from "@/lib/listing/types";

const NOW = new Date("2026-10-12T12:00:00Z");
const JOB: ListingJob = {
  id: "greenhouse:acme:1", title: "Staff Accountant", company: "Acme", token: "acme", source: "greenhouse",
  location: "Austin, TX", country: "US", workMode: "remote", employmentType: "contract", department: "Finance",
  postedAt: "2026-10-09", recheckedAt: "2026-10-12T11:14:00Z", missingSince: null,
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1", salary: "$4,000 - $5,000 /per-month-salary",
  salaryPeriod: "month", salaryMinAnnual: 48_000, salaryMaxAnnual: 60_000, salaryCurrency: "USD",
};
const DESC = { text: "We are hiring a staff accountant.", state: "loaded" as const };
const mount = (props: Partial<React.ComponentProps<typeof PostingDetail>> = {}) => render(
  <MemoryRouter><PostingDetail job={JOB} surface="board" description={DESC} now={NOW} {...props} /></MemoryRouter>,
);

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
afterEach(cleanup);

describe("where the posting stands at its source", () => {
  it("live, with the read time beside the claim", () => {
    mount();
    expect(document.querySelector("[data-live-status='live']")?.textContent).toBe("Live at source · feed read 46 min ago");
  });
  it("partial read is a caution, with an icon and words", () => {
    mount({ served: { recheckedAt: JOB.recheckedAt, partialRead: true } });
    const chip = document.querySelector("[data-live-status='partial']")!;
    expect(chip.textContent).toContain("We could read only part of this board");
    expect(chip.querySelector("svg")).not.toBeNull();
  });
  it("gone, with the day the employer's feed stopped listing it", () => {
    mount({ served: { missingSince: "2026-10-10T08:00:00Z" } });
    expect(document.querySelector("[data-live-status='gone']")?.textContent).toBe("No longer listed by the employer · taken down Oct 10, 2026");
    expect(document.body.textContent).not.toMatch(/feed read/);
  });
  it("no read time, no live claim", () => {
    mount({ served: { recheckedAt: null } });
    expect(document.querySelector("[data-live-status]")).toBeNull();
  });
});

describe("the decision row", () => {
  it("leads with one filled Apply on the employer's site, then the free fit check, then Save; each caption under its button", () => {
    const onApply = vi.fn();
    const onCheckFit = vi.fn();
    mount({ onApply, onCheckFit, onToggleSave: () => {}, saved: false });
    const row = document.querySelector("[data-posting-actions='full']")!;
    const controls = [...row.querySelectorAll("a, button")].map((n) => n.textContent?.replace(/\s+/g, " ").trim());
    expect(controls[0]).toBe("Apply on Acme's site (opens in a new tab)");
    expect(controls[1]).toBe("Check my fit, free");
    expect(row.querySelector("[aria-pressed]")?.getAttribute("aria-label")).toBe("Save Staff Accountant");
    expect(row.textContent).toContain("Opens on Greenhouse, in a new tab.");
    expect(row.textContent).toContain("Scores your résumé against this posting's own description.");
    fireEvent.click(screen.getByRole("link", { name: /Apply on Acme's site/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
  it("one close control, named, and no second ✕ that hides the posting", () => {
    mount({ onClose: () => {}, menu: { onHide: () => {} } });
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(document.body.textContent).not.toContain("✕");
  });
});

describe("the facts", () => {
  it("pay from the employer's feed, never a raw slug, with our estimate marked and its period named", () => {
    mount();
    const facts = document.querySelector("[data-posting-facts]")!.textContent ?? "";
    expect(facts).toContain("$4,000–$5,000/month");
    expect(facts).not.toMatch(/per-month-salary/);
    expect(facts).toContain("from the employer's feed");
    expect(facts).not.toMatch(/own words|not converted/);
    expect(facts).toContain("≈ $48K–$60K/yr");
    expect(facts).toContain("Remote");
    expect(facts).toContain("Contract");
    expect(facts).toContain("Oct 9, 2026, as the employer's system states it");
    expect(document.querySelector("[data-fact='system']")?.textContent).toBe("Apply link opens on Greenhouse");
  });
  it("names the host when the apply link leaves the system we read the posting from", () => {
    mount({ job: { ...JOB, applyUrl: "https://careers.acme.example/jobs/1" } });
    expect(document.querySelector("[data-fact='system']")?.textContent).toBe("Apply link opens on careers.acme.example");
  });
  it("prints every place a folded posting names", () => {
    mount({ job: { ...JOB, otherLocations: ["Denver, CO", "Austin, TX"] } });
    const facts = document.querySelector("[data-posting-facts]")!;
    expect(facts.textContent).toContain("Locations");
    expect([...facts.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Austin, TX", "Denver, CO"]);
  });
});

describe("the open-roles link and the way back", () => {
  it("prints the page's one open-roles value, formatted, with + for a floor", () => {
    mount({ openRolesLink: { count: { value: 1653, floor: false, asOf: null }, href: "/jobs/company/acme", name: "Acme" } });
    expect(screen.getByRole("link", { name: "See all 1,653 open roles at Acme" }).getAttribute("href")).toBe("/jobs/company/acme");
    cleanup();
    mount({ openRolesLink: { count: { value: 10_000, floor: true, asOf: null }, href: "/jobs/company/acme", name: "Acme" } });
    expect(screen.getByRole("link", { name: "See all 10,000+ open roles at Acme" })).toBeTruthy();
  });
  it("on a company page: no employer line, and a Back control to the employer", () => {
    const onBack = vi.fn();
    mount({ surface: "company", back: { label: "Back to Acme", onBack } });
    expect(document.querySelector("[data-posting-header]")?.querySelector("a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to Acme" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("slots", () => {
  it("renders the board's slots in their places, and the public-records group apart from the facts", () => {
    mount({
      slots: {
        howApplying: <p>HOW APPLYING WORKS</p>,
        layoffLine: <p>WARN notice line</p>,
        ontario: <p>Ontario panel</p>,
        employerContext: <p>About this employer</p>,
        applicationAnswers: <button type="button">Prep answers</button>,
      },
    });
    const order = ["Prep answers", "Staff Accountant", "WARN notice line", "Ontario panel", "HOW APPLYING WORKS", "About this employer"]
      .map((s) => (document.body.textContent ?? "").indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    const records = document.querySelector("[data-posting-records]")!;
    expect(records.textContent).toBe("WARN notice lineOntario panel");
  });
});
