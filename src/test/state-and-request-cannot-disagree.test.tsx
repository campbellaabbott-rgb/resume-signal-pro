// STATE AND REQUEST CANNOT DISAGREE.
//
// A control on the board is judged by the request body it produces, and by
// three things that must say the same thing as that body: the chip row, the
// address bar, and the control's own rendering. Eight places where they did
// not, all confirmed from source at 0c2cbd12:
//
//   D1  "Incl. unstated pay" widened the body with no chip — the memo that
//       builds the chip row left the flag out of its dependency list — and the
//       chip then OUTLIVED the flag when it was unticked.
//   D2  The welcome panel's "Stated pay only" set a $1 pay floor: the chip
//       read "$0.001k+", the "States pay" box stayed unticked, and the body
//       sent salaryFloor:1 rather than hasStatedPay:true.
//   D3  "Newest first" under a query lived only in component state. The select
//       showed Newest; a reload or a shared link served relevance.
//   D4  Closing the detail panel after changing a filter while it was open
//       rewound the address bar to the pre-change URL, because the close
//       popped the pushed entry and the surviving one was never rewritten.
//   D5  compareIds were never pruned when the list they index changed, so the
//       tray said "Comparing 3 of 3" over a two-column sheet; the sheet had no
//       Escape.
//   D6  The desktop "Actively hiring" toggle carried no aria-pressed while the
//       toggles either side of it did.
//   D7  remote=1 was written to the URL under an active work mode, where the
//       body sends no remote key at all.
//   D8  The vendor menu autofocused its first row on open, and the focus ring
//       was clipped to two bars by the list's overflow; the unselected box was
//       drawn in the border token, which is invisible on this theme.
//
// Behavioural where the defect is behaviour, with the board mocked; source
// guards only for the one-line properties a render cannot see (a dependency
// list, a URL gate). Every guard here fails on the pre-fix code.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";
import { MultiSelectFilter } from "../components/board/MultiSelectFilter";

const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const MSF_RAW = readFileSync(resolve(ROOT, "src/components/board/MultiSelectFilter.tsx"), "utf8");
const MSF = MSF_RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const ROWS = [
  {
    id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
    title: "Staff Engineer", location: "Cambridge", country: "GB",
    salary: "$120,000 – $150,000", salaryMinAnnual: 120000, salaryMaxAnnual: 150000,
    salaryPeriod: "year", salaryCurrency: "USD",
    workMode: "remote", employmentType: "full_time", experienceBand: "senior", minYears: 6,
    category: "engineering", department: "Platform",
    postedAt: ago(3), lastSeen: ago(3), recheckedAt: ago(0), applyUrl: "https://x/1", remote: true,
  },
  {
    id: "lever:beta:2", source: "lever", token: "beta", company: "Beta",
    title: "Warehouse Associate", location: "Austin, TX, USA", country: "US",
    salary: "USD 32.00 per hour", salaryMinAnnual: 66560, salaryMaxAnnual: null,
    salaryPeriod: "hour", salaryCurrency: "USD",
    workMode: "onsite", employmentType: "part_time", experienceBand: null, minYears: null,
    category: "operations", department: null,
    postedAt: ago(1), lastSeen: ago(1), recheckedAt: null, applyUrl: "https://x/2", remote: false,
  },
  {
    id: "workday:gamma:3", source: "workday", token: "gamma", company: "Gamma",
    title: "Quiet Role", location: "Berlin, Germany", country: "DE",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null,
    salaryPeriod: null, salaryCurrency: null,
    workMode: null, employmentType: null, experienceBand: null, minYears: null,
    category: "engineering", department: null,
    postedAt: ago(40), lastSeen: ago(40), recheckedAt: null, applyUrl: "https://x/3", remote: false,
  },
];

type Body = Record<string, unknown>;

function mount(path = "/jobs") {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "list") {
      // The mock honours the ONE predicate the compare-pruning case needs: a
      // body asking for stated pay gets only the rows that state it.
      const rows = b.hasStatedPay === true ? ROWS.filter((r) => r.salaryMinAnnual != null) : ROWS;
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: rows.length } };
      return {
        data: {
          jobs: rows, total: rows.length, totalAllCompanies: rows.length,
          companies: [{ token: "acme", name: "Acme", count: 12 }],
          companiesCount: 1, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]"));
const cardFor = (needle: string) => cards().find((c) => (c.textContent ?? "").includes(needle));
// THE LIST REQUEST, and only the list request. The panel's "similar roles"
// lookup and the rescue counts are `action: "list"` too; the page request is
// the one that carries an offset.
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list"
    && !(o as { body: Body }).body.countOnly && !(o as { body: Body }).body.facetCounts
    && "offset" in (o as { body: Body }).body)
  .map(([, o]) => (o as { body: Body }).body);
const lastBody = () => listBodies().at(-1) as Body;
// The chip row: primary-tinted pills ending in the × that clears them. The
// compare button on a card shares the tint but not the shape.
const chips = () => Array.from(document.querySelectorAll("button"))
  .filter((b) => b.className.includes("bg-primary/10") && b.className.includes("rounded-full") && (b.textContent ?? "").trimEnd().endsWith("×"))
  .map((b) => (b.textContent ?? "").replace(/×\s*$/, "").trim());
const search = () => new URLSearchParams(window.location.search);
const desktopHiring = () => Array.from(document.querySelectorAll("button"))
  .find((b) => b.className.includes("lg:inline-flex") && (b.textContent ?? "").trim() === "Actively hiring");
const compareOn = (card: HTMLElement) => card.querySelector<HTMLElement>('[aria-label="Add to compare (up to 3)"]');

describe("state and request cannot disagree", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("D1 behaviour: the unstated-pay opt-in has a chip exactly while the body carries the key", async () => {
    mount("/jobs?salaryFloor=50000");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    const box = screen.getByLabelText("Incl. unstated pay") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(chips()).not.toContain("Incl. unstated pay");
    fireEvent.click(box);
    // IN THE SAME RENDER AS THE STATE, not after the refetch lands. The memo
    // that builds the chip row recomputes whenever any of its dependencies
    // move, and the refetch moves one of them — so an assertion made after
    // the body arrives passes on the pre-fix code, where the flag was simply
    // not a dependency and the chip lagged the box by one round trip.
    expect(box.checked).toBe(true);
    expect(chips(), "a widening filter with no chip is the silent-narrowing bug in reverse").toContain("Incl. unstated pay");
    await waitFor(() => expect(lastBody().includeUnstatedPay).toBe(true), SLOW);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(chips(), "the chip outlived the flag").not.toContain("Incl. unstated pay");
    await waitFor(() => expect("includeUnstatedPay" in lastBody()).toBe(false), SLOW);
  });

  it("D1 source: the chip memo depends on the flag it renders a chip for", () => {
    const anchor = JOBS.indexOf('key: "inclUnstatedPay"');
    expect(anchor, "the inclUnstatedPay chip is gone — re-anchor").toBeGreaterThan(-1);
    const depsStart = JOBS.indexOf("}, [", anchor);
    const deps = JOBS.slice(depsStart, JOBS.indexOf("]", depsStart));
    expect(deps).toContain("statedPayOnly");
    expect(deps, "includeUnstatedPay is read inside the memo and must be a dependency").toContain("includeUnstatedPay");
  });

  it("D2 behaviour: 'Stated pay only' is the States-pay filter, not a one-dollar floor", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Stated pay only" }));
    await waitFor(() => expect(lastBody().hasStatedPay).toBe(true), SLOW);
    expect(lastBody().salaryFloor, "a floor of $1 is not 'states pay'").toBeUndefined();
    expect((screen.getByLabelText("States pay") as HTMLInputElement).checked).toBe(true);
    expect(chips()).toContain("States pay");
    expect(text(), "the $0.001k+ chip").not.toContain("0.001k");
    // The panel's employer button now names the filter it sets, in the words
    // the filter itself uses.
    expect(screen.queryByRole("button", { name: "Companies that fill roles" })).toBeNull();
  });

  it("D3 behaviour: Newest-first under a query is written to the URL and read back on mount", async () => {
    const { unmount } = mount("/jobs?q=nurse");
    await waitFor(() => expect(lastBody().q).toBe("nurse"), SLOW);
    const select = screen.getByLabelText("Sort") as HTMLSelectElement;
    expect(select.value).toBe("relevance");
    fireEvent.change(select, { target: { value: "newest" } });
    await waitFor(() => expect(lastBody().sort).toBe("newest"), SLOW);
    expect(select.value).toBe("newest");
    await waitFor(() => expect(search().get("sort"), "the order the select shows must be in the address bar").toBe("newest"), SLOW);
    unmount();
    invoke.mockReset(); rpc.mockReset();
    mount("/jobs?q=nurse&sort=newest");
    await waitFor(() => expect(lastBody().q).toBe("nurse"), SLOW);
    expect(lastBody().sort, "a shared link that says newest must ask for newest").toBe("newest");
    expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("newest");
    expect(search().get("sort")).toBe("newest");
  });

  it("D3 source: the sort the URL writes is the sort the body sends, gated on the lander exactly like salary", () => {
    // The URL effect's own dependency list names the toggle.
    const eff = JOBS.indexOf('if (q) p.set("q", q);');
    expect(eff, "the URL writer moved — re-anchor").toBeGreaterThan(-1);
    const depsStart = JOBS.indexOf("}, [q, location, remoteOnly", eff);
    expect(depsStart).toBeGreaterThan(-1);
    const deps = JOBS.slice(depsStart, JOBS.indexOf("]", depsStart));
    expect(deps).toContain("searchNewestFirst");
    // One predicate for the write and both lander gates.
    const effect = JOBS.slice(eff, depsStart);
    expect(effect).toMatch(/const sortParam = sortMode === "salary" \? "salary" : q && searchNewestFirst \? "newest" : ""/);
    expect(effect).toMatch(/if \(sortParam\) p\.set\("sort", sortParam\)/);
    expect((effect.match(/&& !sortParam\) \{/g) ?? []).length, "both lander gates refuse any sort, not only salary").toBe(2);
    // And the read side exists.
    expect(JOBS).toMatch(/useState\(\(\) => initial\.get\("sort"\) === "newest" && !!initial\.get\("q"\)\)/);
  });

  it("D4 behaviour: a filter changed while the panel is open survives closing it", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    fireEvent.click(cardFor("Staff Engineer")!);
    await waitFor(() => expect(search().get("job")).toBe("greenhouse:acme:1"), SLOW);
    fireEvent.click(screen.getByLabelText("States pay"));
    await waitFor(() => expect(lastBody().hasStatedPay).toBe(true), SLOW);
    await waitFor(() => expect(search().get("statedPay")).toBe("1"), SLOW);
    expect(search().get("job")).toBe("greenhouse:acme:1");
    // Close with Escape: the pushed entry is popped, popstate lands on the
    // entry that was current BEFORE the filter changed.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(search().has("job")).toBe(false), SLOW);
    await waitFor(() => expect(search().get("statedPay"), "closing the panel rewound the address bar").toBe("1"), SLOW);
    // The state never moved: the body still carries the filter the bar lost.
    expect(lastBody().hasStatedPay).toBe(true);
    expect(chips()).toContain("States pay");
  });

  it("D4 source: the history pop re-runs the URL writer from state", () => {
    const pop = JOBS.indexOf("const onPop = () => {");
    expect(pop).toBeGreaterThan(-1);
    const handler = JOBS.slice(pop, JOBS.indexOf("};", pop));
    expect(handler).toMatch(/closeDetail\(true\)/);
    expect(handler, "the survivor entry must be rewritten after a pushed panel is popped").toMatch(/setUrlSyncTick\(\(n\) => n \+ 1\)/);
    const eff = JOBS.indexOf('if (q) p.set("q", q);');
    const depsStart = JOBS.indexOf("}, [q, location, remoteOnly", eff);
    expect(JOBS.slice(depsStart, JOBS.indexOf("]", depsStart))).toContain("urlSyncTick");
  });

  it("D5 behaviour: the compare tray counts rows that are on the page, and Escape closes the sheet first", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Quiet Role"), SLOW);
    fireEvent.click(compareOn(cardFor("Quiet Role")!)!);
    fireEvent.click(compareOn(cardFor("Staff Engineer")!)!);
    await waitFor(() => expect(text()).toContain("Comparing 2 of 3"), SLOW);
    // Narrow to stated pay: Gamma leaves the list.
    fireEvent.click(screen.getByLabelText("States pay"));
    await waitFor(() => expect(cardFor("Quiet Role")).toBeUndefined(), SLOW);
    await waitFor(() => expect(text(), "the tray counts a row that is no longer on the page").toContain("Comparing 1 of 3"), SLOW);
    expect(text()).not.toContain("Comparing 2 of 3");
    fireEvent.click(compareOn(cardFor("Warehouse Associate")!)!);
    await waitFor(() => expect(text()).toContain("Comparing 2 of 3"), SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(text()).toContain("Side by side"), SLOW);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(text(), "Escape must close the sheet").not.toContain("Side by side"), SLOW);
    // And the tray is back, still counting the two that survived.
    expect(text()).toContain("Comparing 2 of 3");
  });

  it("D6 behaviour: the desktop Actively-hiring toggle states its pressed state", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    const btn = desktopHiring();
    expect(btn, "the desktop toggle is gone — re-anchor").toBeTruthy();
    expect(btn!.getAttribute("aria-pressed"), "a toggle whose state lives only in colour").toBe("false");
    fireEvent.click(btn!);
    await waitFor(() => expect(btn!.getAttribute("aria-pressed")).toBe("true"), SLOW);
    expect(chips()).toContain("Actively hiring");
  });

  it("D7 behaviour: remote=1 is written only when the body sends remote", async () => {
    const { unmount } = mount("/jobs?remote=1&mode=hybrid");
    await waitFor(() => expect(lastBody().workMode).toBe("hybrid"), SLOW);
    expect("remote" in lastBody()).toBe(false);
    await waitFor(() => expect(search().get("mode")).toBe("hybrid"), SLOW);
    expect(search().get("remote"), "the URL claims a filter the body does not send").toBeNull();
    unmount();
    invoke.mockReset(); rpc.mockReset();
    // The control: alone, the toggle is still written.
    mount("/jobs?remote=1");
    await waitFor(() => expect(lastBody().remote).toBe(true), SLOW);
    await waitFor(() => expect(search().get("remote")).toBe("1"), SLOW);
  });

  it("D7 source: the write is gated exactly as the body is", () => {
    expect(JOBS).toMatch(/if \(remoteOnly && !workMode\) p\.set\("remote", "1"\);/);
    expect(JOBS).not.toMatch(/if \(remoteOnly\) p\.set\("remote", "1"\);/);
  });

  it("D8 behaviour: the vendor menu opens with no row focused, keeps rows reachable, and draws a box that can be seen", async () => {
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        value=""
        onChange={onChange}
        options={[{ value: "workday", label: "Workday" }, { value: "greenhouse", label: "Greenhouse" }]}
        allLabel="Any vendor"
        ariaLabel="Vendor"
        max={3}
        atMaxNote="At the cap"
        clearLabel="Clear"
        selectedLabel={(n) => `${n} vendors`}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Vendor" }));
    const rows = await waitFor(() => {
      const r = screen.getAllByRole("checkbox");
      expect(r.length).toBe(2);
      return r;
    }, SLOW);
    const active = document.activeElement as HTMLElement | null;
    expect(active?.getAttribute("role"), "the first row is autofocused on open, which is the two blue bars").not.toBe("checkbox");
    // Focus is INSIDE the menu, so Tab reaches the rows and Escape closes it.
    const group = screen.getByRole("group", { name: "Vendor" });
    expect(group === active || group.contains(active), "focus must land in the menu, or the rows are unreachable by keyboard").toBe(true);
    // The ring, when a row does take focus, is drawn inside the clip.
    for (const r of rows) expect(r.className).toContain("focus-visible:outline-offset-[-2px]");
    // The unselected box is not drawn in the border token (14% lightness on a
    // 9% surface). The selected rendering is untouched.
    const box = rows[0].querySelector("span")!;
    expect(box.className).not.toContain("border-border");
    expect(box.className).toContain("border-muted-foreground");
    fireEvent.click(rows[0]);
    expect(onChange).toHaveBeenCalledWith("workday");
  });

  it("D8 source: the selected box still renders as before", () => {
    expect(MSF).toMatch(/on \? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground\/70"/);
    expect(MSF).toMatch(/onOpenAutoFocus=\{/);
  });
});
