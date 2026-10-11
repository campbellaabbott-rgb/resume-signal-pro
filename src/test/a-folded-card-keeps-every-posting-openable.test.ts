// @vitest-environment node
/**
 * S11-005: the board folds one employer's same-title postings into one card.
 * The fold kept only the lead row: every folded posting bumped a count and
 * left a place name, its id and apply link dropped, so Pilot's 22 "Cashier"
 * postings sat behind one Bellemont, AZ link and the place list included
 * Nanton, AB, Canada. q='theatre team member' printed "Showing 21 of 234".
 *
 * S11-025: clusterKey stripped every bracketed segment, so "Teacher
 * (Mathematics)" and "Teacher (Elementary)", "(Night Shift)" and
 * "(Day Shift)" folded into one card claiming N openings of the first.
 *
 * The fold is run three ways: the pure key, collapseClusters, and the shipped
 * job-board handler's list action (bundled, only its database faked).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clusterKey } from "../../supabase/functions/job-board/descriptions";
import { collapseClusters, GROUP_SIBLINGS_MAX } from "../../supabase/functions/job-board/clusters";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

/** A card row as rowToJob emits it. */
const job = (id: string, title: string, location: string, country: string | null, company = "Pilot") => ({
  id, token: "pilot", company, title, location, country, applyUrl: `https://x/${id}`, postedAt: "2026-10-10T00:00:00Z",
});

describe("a bracketed segment folds only when it is noise (S11-025)", () => {
  it("different subjects, levels and shifts stay apart", () => {
    const at = "Pine Ridge, SD";
    expect(clusterKey("Pine Ridge School", "Teacher (Mathematics)", at)).not.toBe(clusterKey("Pine Ridge School", "Teacher (Elementary)", at));
    expect(clusterKey("Acme", "Software Engineer (SWE-3)", "Austin, TX")).not.toBe(clusterKey("Acme", "Software Engineer (SWE-4)", "Austin, TX"));
    expect(clusterKey("Acme", "Packer (Night Shift)", "Reno, NV")).not.toBe(clusterKey("Acme", "Packer (Day Shift)", "Reno, NV"));
  });

  it("the row's own place, a work mode and a requisition number still fold", () => {
    const base = clusterKey("Acme", "Registered Nurse", "Boston, MA");
    expect(clusterKey("Acme", "Registered Nurse (Boston)", "Boston, MA")).toBe(base);
    expect(clusterKey("Acme", "Registered Nurse (Pueblo, CO)", "Pueblo, CO, US")).toBe(clusterKey("Acme", "Registered Nurse", "Pueblo, CO, US"));
    expect(clusterKey("Acme", "Registered Nurse [Remote]", "Boston, MA")).toBe(base);
    expect(clusterKey("Acme", "Registered Nurse (R12345)", "Boston, MA")).toBe(base);
    expect(clusterKey("Acme", "Registered Nurse (Montréal)", "Montreal, QC")).toBe(clusterKey("Acme", "Registered Nurse", "Montreal, QC"));
  });
});

describe("collapseClusters keeps every folded posting openable and never crosses a border (S11-005)", () => {
  it("the folded postings ride the card with their own ids, places and apply links", () => {
    const { jobs } = collapseClusters([
      job("workday:pilot:1", "Cashier", "Bellemont, AZ", "US"),
      job("workday:pilot:2", "Cashier", "Flagstaff, AZ", "US"),
      job("workday:pilot:3", "Cashier", "Bellemont, AZ", "US"),
    ], 60);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].postingCount).toBe(3);
    expect(jobs[0].siblings, "the folded postings' ids and links were dropped").toEqual([
      { id: "workday:pilot:2", location: "Flagstaff, AZ", applyUrl: "https://x/workday:pilot:2", postedAt: "2026-10-10T00:00:00Z" },
      { id: "workday:pilot:3", location: "Bellemont, AZ", applyUrl: "https://x/workday:pilot:3", postedAt: "2026-10-10T00:00:00Z" },
    ]);
  });

  it("a posting in another country gets its own card", () => {
    const { jobs } = collapseClusters([
      job("workday:pilot:1", "Cashier", "Bellemont, AZ", "US"),
      job("workday:pilot:2", "Cashier", "Nanton, AB, Canada", "CA"),
    ], 60);
    expect(jobs.map((j) => j.location), "Nanton, AB was folded under Bellemont, AZ").toEqual(["Bellemont, AZ", "Nanton, AB, Canada"]);
    expect(jobs.every((j) => j.siblings === undefined && j.postingCount === undefined)).toBe(true);
  });

  it("carries at most GROUP_SIBLINGS_MAX, and still counts them all", () => {
    const rows = Array.from({ length: GROUP_SIBLINGS_MAX + 10 }, (_, i) => job(`workday:cinemark:${i}`, "Theatre Team Member", `Town ${i}, TX`, "US", "Cinemark"));
    const { jobs } = collapseClusters(rows, 60);
    expect(jobs[0].postingCount).toBe(GROUP_SIBLINGS_MAX + 10);
    expect((jobs[0].siblings as unknown[]).length).toBe(GROUP_SIBLINGS_MAX);
  });
});

describe("the shipped list action serves them (S11-005)", () => {
  let board: BoardList;
  beforeAll(async () => { board = await bootBoardList(); });
  beforeEach(() => board.reset());

  it("a folded card's response carries each posting's link, and the Canadian posting is its own card", async () => {
    const rows = [
      row("workday:pilot:1", "Cashier", { company_token: "pilot", company: "Pilot", location: "Bellemont, AZ", country: "US" }),
      row("workday:pilot:2", "Cashier", { company_token: "pilot", company: "Pilot", location: "Flagstaff, AZ", country: "US" }),
      row("workday:pilot:3", "Cashier", { company_token: "pilot", company: "Pilot", location: "Nanton, AB, Canada", country: "CA" }),
    ];
    board.answer((q) => (q.table === "job_board_postings" && calls(q, "select") && !calls(q, "in") ? { data: rows, error: null, count: 3 } : undefined));
    const r = await board.post({ action: "list", limit: 60 });
    const cards = (r.jobs ?? []) as Array<Record<string, unknown>>;
    const pilot = cards.filter((c) => c.company === "Pilot");
    expect(pilot.map((c) => c.location), JSON.stringify(cards).slice(0, 400)).toEqual(["Bellemont, AZ", "Nanton, AB, Canada"]);
    expect(pilot[0].postingCount).toBe(2);
    expect((pilot[0].siblings as Array<{ id: string; applyUrl: string }>).map((s) => [s.id, s.applyUrl]))
      .toEqual([["workday:pilot:2", "https://x/workday:pilot:2"]]);
  });
});
