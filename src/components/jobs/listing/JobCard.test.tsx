// @vitest-environment jsdom
/**
 * The shared card, mounted from fixtures (never through Jobs.tsx): what each
 * row prints, what it refuses to print, and the controls a seeker meets.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { JobCard, type CardContext } from "./JobCard";
import type { ListingJob } from "@/lib/listing/types";

const NOW = new Date("2026-10-12T12:00:00Z");
const BOARD: CardContext = { surface: "board", density: "comfortable", hideEmployer: false, selected: false };
const COMPANY: CardContext = { surface: "company", density: "comfortable", hideEmployer: true, selected: false };

const job = (over: Partial<ListingJob> = {}): ListingJob => ({
  id: "greenhouse:acme:4012345",
  title: "Staff Accountant",
  company: "Acme",
  token: "acme",
  source: "greenhouse",
  location: "Austin, TX",
  country: "US",
  workMode: "hybrid",
  employmentType: "full_time",
  department: "Finance &amp; Accounting",
  postedAt: "2026-10-09T10:00:00Z",
  recheckedAt: "2026-10-12T11:14:00Z",
  missingSince: null,
  applyUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
  salary: "$29.92 - $38.07 per hour",
  salaryPeriod: "hour",
  salaryMinAnnual: 62_234,
  salaryMaxAnnual: 79_186,
  salaryCurrency: "USD",
  agency: false,
  ...over,
});

const mount = (ui: React.ReactElement) => render(<MemoryRouter><ul>{ui}</ul></MemoryRouter>);

beforeAll(() => {
  i18n.addResourceBundle("en", "translation", enListing, true, true);
  // Radix menus measure their trigger; jsdom has no ResizeObserver.
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

describe("the four rows", () => {
  it("prints title, employer link, place, department decoded, pay in neutral type, work mode, type, and the trust line", () => {
    mount(<JobCard job={job()} ctx={BOARD} href="/jobs?job=x" now={NOW} />);
    expect(screen.getByRole("heading", { level: 3, name: "Staff Accountant" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Acme" }).getAttribute("href")).toBe("/jobs/company/acme");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Austin, TX");
    expect(text).toContain("Finance & Accounting");
    expect(text).not.toContain("&amp;");
    const pay = screen.getByText("$29.92–$38.07 per hour");
    expect(pay.className).not.toMatch(/text-success/);
    expect(pay.getAttribute("title")).toBe("$29.92 - $38.07 per hour");
    expect(text).toContain("≈ $62K–$79K/yr");
    expect(text).toContain("Hybrid");
    expect(text).toContain("Full-time");
    expect(text).toContain("Greenhouse · feed read 46 min ago");
    expect(text).toContain("posted 3 days ago");
  });

  it("an undated posting prints no age and no first-seen date of any kind", () => {
    mount(<JobCard job={job({ postedAt: null, ...({ lastSeen: "2026-10-01T00:00:00Z" } as object) })} ctx={BOARD} href="/x" now={NOW} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/posted|first seen|days? ago/i);
    expect(text).toContain("feed read 46 min ago");
  });

  it("a mode the employer did not state prints nothing — silence is never on-site", () => {
    mount(<JobCard job={job({ workMode: null, remote: false, employmentType: null })} ctx={BOARD} href="/x" now={NOW} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/On-site|Remote|Hybrid|Full-time/);
  });

  it("our annual figure appears only beside a known period", () => {
    mount(<JobCard job={job({ salary: "$4,000 - $5,000", salaryPeriod: null })} ctx={BOARD} href="/x" now={NOW} />);
    expect(document.body.textContent).not.toContain("≈");
  });
});

describe("the company page variant", () => {
  it("prints no employer line, no monogram and no employer chips (the header prints the record once)", () => {
    const { container } = mount(
      <JobCard
        job={job()}
        ctx={COMPANY}
        href="/x"
        now={NOW}
        slots={{ employerChip: <span>Actively hiring</span>, layoffChip: <span>WARN notice</span> }}
      />,
    );
    expect(screen.queryByRole("link", { name: "Acme" })).toBeNull();
    expect(container.querySelector("[aria-hidden='true'].rounded-md.bg-muted")).toBeNull();
    expect(screen.queryByText("Actively hiring")).toBeNull();
    expect(screen.queryByText("WARN notice")).toBeNull();
  });
});

describe("chips", () => {
  it("discloses an agency BOARD, and shows at most two chips", () => {
    mount(
      <JobCard
        job={job({ agency: true })}
        ctx={BOARD}
        href="/x"
        now={NOW}
        slots={{ employerChip: <span>Record chip</span>, layoffChip: <span>Layoff chip</span>, fieldChip: <span>Field chip</span> }}
      />,
    );
    expect(screen.getByText("Staffing agency board")).toBeTruthy();
    expect(screen.queryByText("Staffing agency")).toBeNull();
    const shown = ["Layoff chip", "Record chip", "Field chip"].filter((c) => screen.queryByText(c));
    expect(shown).toEqual(["Layoff chip"]);
  });
});

describe("controls", () => {
  it("opens on a plain click of the title, and leaves a modified click to the browser", () => {
    const onOpen = vi.fn();
    mount(<JobCard job={job()} ctx={BOARD} href="/jobs?job=greenhouse%3Aacme%3A4012345" onOpen={onOpen} now={NOW} />);
    const link = screen.getByRole("link", { name: "Staff Accountant" });
    expect(link.getAttribute("href")).toBe("/jobs?job=greenhouse%3Aacme%3A4012345");
    fireEvent.click(link, { metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(link, { detail: 1 });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "greenhouse:acme:4012345" }), "click");
    fireEvent.click(link, { detail: 0 });
    expect(onOpen).toHaveBeenLastCalledWith(expect.anything(), "keyboard");
  });

  it("marks the selected card with aria-current", () => {
    const { container } = mount(<JobCard job={job()} ctx={{ ...BOARD, selected: true }} href="/x" now={NOW} />);
    expect(container.querySelector("li")?.getAttribute("aria-current")).toBe("true");
  });

  it("Save is a named, pressed-state icon; Check fit is a quiet link; there is no Apply on the card", () => {
    const onToggleSave = vi.fn();
    const onCheckFit = vi.fn();
    mount(<JobCard job={job()} ctx={BOARD} href="/x" saved onToggleSave={onToggleSave} onCheckFit={onCheckFit} now={NOW} />);
    const save = screen.getByRole("button", { name: "Save Staff Accountant" });
    expect(save.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(save);
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check your fit for Staff Accountant" }));
    expect(onCheckFit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /apply/i })).toBeNull();
  });

  it("the ⋯ menu holds report reasons, Hide (not a second ✕), Compare, Open in Claude or ChatGPT and Copy link", async () => {
    const user = userEvent.setup();
    const menu = { onReport: vi.fn(), onHide: vi.fn(), onCompare: vi.fn(), onCopyLink: vi.fn(), aiHandoff: vi.fn(), compared: true };
    mount(<JobCard job={job()} ctx={BOARD} href="/x" menu={menu} now={NOW} />);
    expect(screen.queryByText("✕")).toBeNull();
    await user.click(screen.getByRole("button", { name: "More actions for Staff Accountant" }));
    const list = await screen.findByRole("menu");
    const names = [...list.querySelectorAll("[role=menuitem], [role=menuitemcheckbox]")].map((n) => n.textContent?.trim());
    expect(names).toEqual(["Posting is gone", "Looks misleading", "Something else", "Hide this posting", "Compare", "Open in Claude or ChatGPT", "Copy link"]);
    expect(within(list).getByRole("menuitemcheckbox", { name: /Compare/ }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(list).getByRole("menuitem", { name: "Looks misleading" }));
    expect(menu.onReport).toHaveBeenCalledWith(expect.objectContaining({ id: "greenhouse:acme:4012345" }), "misleading");
  });

  it("a menu the surface cannot fill renders no trigger", () => {
    mount(<JobCard job={job()} ctx={BOARD} href="/x" menu={{}} now={NOW} />);
    expect(screen.queryByRole("button", { name: /More actions/ })).toBeNull();
  });
});
