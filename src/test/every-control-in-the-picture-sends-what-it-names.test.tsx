// EVERY CONTROL IN THE PICTURE SENDS WHAT IT NAMES.
//
// Owner's ask, 2026-09-15, over a screenshot of /jobs: "make sure all of
// these buttons work and are accurate". The live click-through memo settles
// how that is judged — by the request body a control produces, never by
// pixels — and state-and-request-cannot-disagree.test.tsx already holds the
// eight controls whose defects were found that way. This file is the sibling
// for the rest of the picture: one behavioural case per control that had no
// jsdom guard (the sweep on 2026-09-15 found the pay band, the years cap, the
// basis, the vendor and field menus, the agency opt-out, the mode and type
// toggles, the date row, the industry chips, the typeahead, the local views
// and the résumé button all guarded only at the source or not at all).
//
// The hook is installed BEFORE the mount — mount() sets the invoke mock and
// only then renders — so the mount-time list is in the record and a later
// body is a change, not the first thing seen (the 2026-09-10 misread).
//
// Two cases were written RED on 2026-09-15 — findings recorded as guards —
// and fixed the same day in Jobs.tsx. Each was proven to fail on the pre-fix
// copy in exactly the way it had been observed, and each now pins the repair:
//
//   F1  The count beside an industry chip was the board-wide exact facet until
//       the chip was clicked, and the per-query CAPPED count after — so the
//       number a reader clicked on (138,308) became "10,000+" on the click
//       that selected it, with no filter but the chip itself on the board.
//       Now: with only a field bound the page reads the kept unfiltered facet,
//       every chip keeps its number and its place, and no counted probe is
//       sent — the request record is the proof, not the pixels.
//   F2  The "+ unsorted (N)" count read the list reply's facet, and the server
//       withholds every entry but the active category once one is chosen —
//       which is the only time the control renders. The number never printed.
//       Now: the exact board-wide bucket in the field-only state, the capped
//       per-query bucket under another filter, and nothing (never "0") when
//       the probe dropped it.
//
// Everything else is a plain pass/fail on the body.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
    category: "engineering", department: "Platform", agency: false,
    postedAt: ago(3), lastSeen: ago(3), recheckedAt: ago(0), applyUrl: "https://x/1", remote: true,
  },
  {
    id: "lever:beta:2", source: "lever", token: "beta", company: "Beta",
    title: "Warehouse Associate", location: "Austin, TX, USA", country: "US",
    salary: "USD 32.00 per hour", salaryMinAnnual: 66560, salaryMaxAnnual: null,
    salaryPeriod: "hour", salaryCurrency: "USD",
    workMode: "onsite", employmentType: "part_time", experienceBand: null, minYears: null,
    category: "operations", department: null, agency: false,
    postedAt: ago(1), lastSeen: ago(1), recheckedAt: null, applyUrl: "https://x/2", remote: false,
  },
  {
    id: "smartrecruiters:mascmedical:4", source: "smartrecruiters", token: "MASCMedicalRecruitmentFirm", company: "MASC Medical",
    title: "Travel Nurse", location: "Miami, FL, USA", country: "US",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null,
    salaryPeriod: null, salaryCurrency: null,
    workMode: null, employmentType: null, experienceBand: null, minYears: null,
    category: "healthcare", department: null, agency: true,
    postedAt: ago(2), lastSeen: ago(2), recheckedAt: null, applyUrl: "https://x/4", remote: false,
  },
];

// The live figures from the owner's screenshot, so the chip case is about a
// number that genuinely stood on the board.
const BOARD_CATS: Record<string, number> = {
  operations: 138_308, healthcare: 107_662, hospitality_retail: 77_687, engineering: 61_204, other: 162_800,
};
const COUNTRY_FACET = [{ country: "US", n: 253_609 }, { country: "GB", n: 20_625 }];

type Body = Record<string, unknown>;
type MountOpts = {
  path?: string;
  /** What action:"list" facetCounts:true answers with (the per-query rail).
   *  A list answers each probe in turn and holds on its last entry. */
  facetCounts?: Record<string, number> | Array<Record<string, number>>;
  /** Role terms job-fit's fit-terms answers with. */
  fitTerms?: string[];
};

function mount(o: MountOpts = {}) {
  const path = o.path ?? "/jobs";
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_country_facet") return { data: COUNTRY_FACET, error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Body } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: o.fitTerms ?? [] }, error: null };
    if (fn === "job-fit") return { data: {}, error: null };
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "facets") {
      return { data: { categories: BOARD_CATS, refreshedAt: ago(0), sources: { workday: 231_957, greenhouse: 9_000 }, sourcesAt: ago(0) }, error: null };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) {
        const fc = Array.isArray(o.facetCounts)
          ? (o.facetCounts.length > 1 ? o.facetCounts.shift() : o.facetCounts[0])
          : o.facetCounts;
        return { data: { categories: fc ?? {} } };
      }
      if (b.countOnly) return { data: { total: ROWS.length } };
      const active = typeof b.category === "string" ? b.category.split(",")[0] : "";
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length,
          companies: [{ token: "acme", name: "Acme", open: 12 }, { token: "beta", name: "Beta", open: 3 }],
          companiesCount: 2,
          // MIRRORS visibleCategories (clusters.ts): the whole facet on an
          // unfiltered board, ONLY the active category's entry once one is
          // bound — which is what the "+ unsorted (N)" count reads from —
          // and NO facet at all on a described-only page (hasDescription is
          // an applied filter server-side, so isUnfiltered is false there).
          categories: b.hasDescription ? undefined : active ? { [active]: BOARD_CATS[active] ?? 1 } : BOARD_CATS,
          failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
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
// THE LIST REQUEST, and only the list request (the offset is what marks it).
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list"
    && !(o as { body: Body }).body.countOnly && !(o as { body: Body }).body.facetCounts
    && "offset" in (o as { body: Body }).body)
  .map(([, o]) => (o as { body: Body }).body);
const lastBody = () => listBodies().at(-1) as Body;
const fitCalls = () => invoke.mock.calls.filter(([fn]) => fn === "job-fit");
const settled = async () => waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);

/** Open a MultiSelectFilter by its aria-label (it stays open after a row
 *  click, so a second call must not toggle it shut) and click the row
 *  matching `row`. */
async function pickFromMenu(menu: string, row: RegExp) {
  const trigger = screen.getAllByRole("button", { name: menu })[0];
  if (trigger.getAttribute("data-state") !== "open") fireEvent.click(trigger);
  const group = await waitFor(() => screen.getByRole("group", { name: menu }), SLOW);
  fireEvent.click(within(group).getByRole("checkbox", { name: row }));
}
/** The freshness chips carry aria-pressed; nothing else with that text does. */
const dateChip = (label: string) => screen.getAllByRole("button", { name: label })
  .find((b) => b.hasAttribute("aria-pressed"))!;
// THE RAIL PILL ONLY. After a click the active-filter chip row carries a
// button with the same words and a trailing ×, and the fields menu a row with
// role=checkbox; neither is the control in the picture.
const industryChip = (prefix: string) => Array.from(document.querySelectorAll("button"))
  .find((b) => (b.textContent ?? "").startsWith(prefix) && !(b.textContent ?? "").trimEnd().endsWith("×")
    && b.getAttribute("role") !== "checkbox" && b.className.includes("whitespace-nowrap"));
// THE WHOLE RAIL, IN DOM ORDER. Rail pills are the only buttons that carry the
// field's colour dot (an aria-hidden span with an inline background); the
// active-filter chip row and the fields menu carry none. Text per pill is the
// name plus its printed count, so equality of two readings is "every chip
// kept its number AND its place".
const railChipTexts = () => Array.from(document.querySelectorAll("button"))
  .filter((b) => b.querySelector('span[aria-hidden="true"][style]') && b.getAttribute("role") !== "checkbox")
  .map((b) => (b.textContent ?? "").trim());
// Every counted-probe request the page sent (action:list with facetCounts).
const facetCountCalls = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.facetCounts === true);
// A quick chip by its label — the active-filter chip that appears once it is
// on shares the accessible name (its × is aria-hidden).
const quickChip = (label: string) => screen.getAllByRole("button", { name: label })
  .find((b) => !(b.textContent ?? "").includes("×"))!;
const desktopHiring = () => Array.from(document.querySelectorAll("button"))
  .find((b) => b.className.includes("lg:inline-flex") && (b.textContent ?? "").trim() === "Actively hiring")!;

describe("every control in the picture sends what it names", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  // ── ROW 1: search + location ────────────────────────────────────────────

  it("C1 the search box sends q, trimmed", async () => {
    mount(); await settled();
    const box = document.getElementById("board-search") as HTMLInputElement;
    expect(box, "the search box lost its id — re-anchor").toBeTruthy();
    fireEvent.change(box, { target: { value: "  nurse " } });
    await waitFor(() => expect(lastBody().q).toBe("nurse"), SLOW);
  });

  it("C2 the location box sends location, trimmed", async () => {
    mount(); await settled();
    // Two inputs share the state (desktop and the mobile drawer); either is the control.
    const box = screen.getAllByPlaceholderText("Location")[0] as HTMLInputElement;
    fireEvent.change(box, { target: { value: " Austin " } });
    await waitFor(() => expect(lastBody().location).toBe("Austin"), SLOW);
  });

  // ── ROW 2: fields, agent, experience, years, countries ──────────────────

  it("C3 'All fields' sends category as the canonical comma list, and a chip count rides only when the facet has one", async () => {
    mount(); await settled();
    await pickFromMenu("All fields", /Engineering/);
    await waitFor(() => expect(lastBody().category).toBe("engineering"), SLOW);
    await pickFromMenu("All fields", /Design/);
    // CATEGORY_IDS order, not click order — one selection, one string.
    await waitFor(() => expect(lastBody().category).toBe("engineering,design"), SLOW);
    expect("includeUncategorised" in lastBody(), "the unsorted opt-in is off by default").toBe(false);
  });

  it("C4 'Agent can apply' sends sendableOnly as the literal true, and nothing when off", async () => {
    mount(); await settled();
    expect("sendableOnly" in lastBody()).toBe(false);
    const box = screen.getByLabelText("Agent can apply") as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() => expect(lastBody().sendableOnly).toBe(true), SLOW);
    fireEvent.click(box);
    await waitFor(() => expect("sendableOnly" in lastBody()).toBe(false), SLOW);
  });

  it("C5 'Any experience' sends experience as a comma list of bands", async () => {
    mount(); await settled();
    await pickFromMenu("Seniority bands", /Senior/);
    await waitFor(() => expect(lastBody().experience).toBe("senior"), SLOW);
    await pickFromMenu("Seniority bands", /Entry level/);
    await waitFor(() => expect(lastBody().experience).toBe("entry,senior"), SLOW);
    // Two controls, two columns: the bands do not set maxYears and vice versa.
    expect("maxYears" in lastBody()).toBe(false);
  });

  it("C6 'Any years required' sends maxYears as a whole number, and the empty option clears it", async () => {
    mount(); await settled();
    const sel = screen.getByLabelText("Maximum years of experience required") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "3" } });
    await waitFor(() => expect(lastBody().maxYears).toBe(3), SLOW);
    expect("experience" in lastBody(), "years is its own column; it must not turn into a band").toBe(false);
    fireEvent.change(sel, { target: { value: "" } });
    await waitFor(() => expect("maxYears" in lastBody()).toBe(false), SLOW);
  });

  it("C7 'All countries' sends country as ISO codes, comma-joined, from the facet's own rows", async () => {
    mount(); await settled();
    await pickFromMenu("All countries", /United States/);
    await waitFor(() => expect(lastBody().country).toBe("US"), SLOW);
    await pickFromMenu("All countries", /United Kingdom/);
    await waitFor(() => expect(lastBody().country).toBe("US,GB"), SLOW);
  });

  // ── ROW 3: company, pay band, basis, states pay ─────────────────────────

  it("C8 the Company typeahead sends companies as an array of tokens, accumulating", async () => {
    mount(); await settled();
    const box = screen.getByLabelText("Employer") as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Ac" } });
    const opt = await waitFor(() => screen.getByRole("option", { name: /Acme/ }), SLOW);
    fireEvent.mouseDown(opt);
    await waitFor(() => expect(lastBody().companies).toEqual(["acme"]), SLOW);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Be" } });
    fireEvent.mouseDown(await waitFor(() => screen.getByRole("option", { name: /Beta/ }), SLOW));
    await waitFor(() => expect(lastBody().companies).toEqual(["acme", "beta"]), SLOW);
  });

  it("C9 'Any salary' sends salaryFloor as a number and implies nothing else", async () => {
    mount(); await settled();
    fireEvent.change(screen.getByLabelText("Minimum stated pay"), { target: { value: "100000" } });
    await waitFor(() => expect(lastBody().salaryFloor).toBe(100000), SLOW);
    // The floor already confines the board to stated pay at the database; the
    // page must not ALSO send the states-pay key the reader never ticked.
    expect("hasStatedPay" in lastBody()).toBe(false);
    expect("payBasis" in lastBody()).toBe(false);
    // The widening opt-in appears only now that there is a floor to relax.
    expect(screen.getByLabelText("Incl. unstated pay")).toBeTruthy();
  });

  it("C10 'No maximum' sends salaryCeiling as a number, even under the floor (the server names it)", async () => {
    mount(); await settled();
    fireEvent.change(screen.getByLabelText("Maximum stated pay"), { target: { value: "150000" } });
    await waitFor(() => expect(lastBody().salaryCeiling).toBe(150000), SLOW);
    fireEvent.change(screen.getByLabelText("Minimum stated pay"), { target: { value: "200000" } });
    await waitFor(() => expect(lastBody().salaryFloor).toBe(200000), SLOW);
    expect(lastBody().salaryCeiling, "a contradiction is sent so ignoredFilters can say so").toBe(150000);
  });

  it("C11 'Any pay basis' sends payBasis as hourly|salaried", async () => {
    mount(); await settled();
    const sel = screen.getByLabelText("Pay basis") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "hourly" } });
    await waitFor(() => expect(lastBody().payBasis).toBe("hourly"), SLOW);
    fireEvent.change(sel, { target: { value: "salaried" } });
    await waitFor(() => expect(lastBody().payBasis).toBe("salaried"), SLOW);
    fireEvent.change(sel, { target: { value: "" } });
    await waitFor(() => expect("payBasis" in lastBody()).toBe(false), SLOW);
  });

  it("C12 the three pay controls compose by AND in one body — and the widening opt-in is sent beside States pay for the server to name", async () => {
    mount(); await settled();
    fireEvent.change(screen.getByLabelText("Minimum stated pay"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Pay basis"), { target: { value: "hourly" } });
    fireEvent.click(screen.getByLabelText("States pay"));
    await waitFor(() => expect(lastBody()).toMatchObject({ salaryFloor: 100000, payBasis: "hourly", hasStatedPay: true }), SLOW);
    // The page lets "States pay" and "Incl. unstated pay" be lit together and
    // sends both — and that is the right shape, the same one the pay ceiling
    // uses under the floor: the server decides, and names what it refused.
    // The server ANDs salary_min_annual IS NOT NULL with the floor's OR-arm,
    // which cancels the widening for every unpriced row while still admitting
    // stated pay in a currency it cannot convert (salary_rank_usd NULL); as of
    // build .72 normalizeFilters binds the widening false in that pairing and
    // reports it, and the page's disclosure prints the widening sentence for
    // it. That contract is pinned in
    // states-pay-and-the-unstated-widening-cannot-both-bind.test.tsx; this
    // case pins the body the page produces.
    fireEvent.click(screen.getByLabelText("Incl. unstated pay"));
    await waitFor(() => expect(lastBody().includeUnstatedPay).toBe(true), SLOW);
    expect(lastBody().hasStatedPay).toBe(true);
  });

  // ── ROW 4: source, agencies, work mode ──────────────────────────────────

  it("C13 'Any source' sends vendor as the source key, comma-joined, and the row printed the board-wide count", async () => {
    mount(); await settled();
    fireEvent.click(screen.getAllByRole("button", { name: "Job board source" })[0]);
    const group = await waitFor(() => screen.getByRole("group", { name: "Job board source" }), SLOW);
    const wd = await waitFor(() => {
      const r = within(group).getByRole("checkbox", { name: /Workday/ });
      expect(r.textContent).toContain("231,957");
      return r;
    }, SLOW);
    fireEvent.click(wd);
    await waitFor(() => expect(lastBody().vendor).toBe("workday"), SLOW);
    expect("sendableOnly" in lastBody()).toBe(false);
  });

  it("C14 'Hide staffing agencies' sends excludeAgencies as the literal true, and the tagged card is on the page until then", async () => {
    mount(); await settled();
    expect(cardFor("Travel Nurse"), "agencies serve by default").toBeTruthy();
    expect("excludeAgencies" in lastBody()).toBe(false);
    const box = screen.getByLabelText("Hide staffing agencies") as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() => expect(lastBody().excludeAgencies).toBe(true), SLOW);
    fireEvent.click(box);
    await waitFor(() => expect("excludeAgencies" in lastBody()).toBe(false), SLOW);
  });

  it("C15 Remote | Hybrid | On-site send workMode as a canonical list and never the legacy remote key", async () => {
    mount(); await settled();
    const group = screen.getByRole("group", { name: "Work mode" });
    fireEvent.click(within(group).getByRole("button", { name: "Hybrid" }));
    await waitFor(() => expect(lastBody().workMode).toBe("hybrid"), SLOW);
    fireEvent.click(within(group).getByRole("button", { name: "Remote" }));
    // Canonical order, not click order.
    await waitFor(() => expect(lastBody().workMode).toBe("remote,hybrid"), SLOW);
    expect("remote" in lastBody(), "remote:true is a strict subset of the mode and must not AND with it").toBe(false);
    expect(within(group).getByRole("button", { name: "Remote" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Remote" }));
    await waitFor(() => expect(lastBody().workMode).toBe("hybrid"), SLOW);
  });

  // ── ROW 5: employment type ──────────────────────────────────────────────

  it("C16 Full-time | Part-time | Contract | Temp | Internship send employmentType as a canonical list", async () => {
    mount(); await settled();
    const group = screen.getByRole("group", { name: "Employment type" });
    fireEvent.click(within(group).getByRole("button", { name: "Contract" }));
    await waitFor(() => expect(lastBody().employmentType).toBe("contract"), SLOW);
    fireEvent.click(within(group).getByRole("button", { name: "Full-time" }));
    await waitFor(() => expect(lastBody().employmentType).toBe("full_time,contract"), SLOW);
    fireEvent.click(within(group).getByRole("button", { name: "Temp" }));
    await waitFor(() => expect(lastBody().employmentType).toBe("full_time,contract,temporary"), SLOW);
  });

  // ── ROW 6: date window ──────────────────────────────────────────────────

  it("C17 the date chips send maxAgeDays as 1 | 3 | 7 | 14 | 30, and 'Any date' sends nothing", async () => {
    mount(); await settled();
    const want: Array<[string, number]> = [["Today", 1], ["Last 3 days", 3], ["This week", 7], ["Last 2 weeks", 14], ["Last 30 days", 30]];
    for (const [label, days] of want) {
      fireEvent.click(dateChip(label));
      await waitFor(() => expect(lastBody().maxAgeDays).toBe(days), SLOW);
      expect(dateChip(label).getAttribute("aria-pressed")).toBe("true");
    }
    fireEvent.click(dateChip("Any date"));
    await waitFor(() => expect("maxAgeDays" in lastBody()).toBe(false), SLOW);
  });

  // ── ROW 7: industry chips + All industries ──────────────────────────────

  it("C18 an industry chip prints the board-wide facet's exact count and sends category = that one field (replacing, not adding)", async () => {
    mount(); await settled();
    const chip = await waitFor(() => {
      const c = industryChip("Operations & Logistics");
      expect(c?.textContent).toContain("138,308");
      return c!;
    }, SLOW);
    expect(chip.textContent, "an exact facet entry never wears the list cap's plus").not.toContain("+");
    fireEvent.click(chip);
    await waitFor(() => expect(lastBody().category).toBe("operations"), SLOW);
    // With two fields chosen in the menu, a chip REPLACES them with itself.
    await pickFromMenu("All fields", /Engineering/);
    await waitFor(() => expect(lastBody().category).toBe("engineering,operations"), SLOW);
    fireEvent.click(industryChip("Healthcare & Clinical")!);
    await waitFor(() => expect(lastBody().category).toBe("healthcare"), SLOW);
  });

  it("F1 the click that selects a chip changes no chip's number or place, and sends no counted probe", async () => {
    // What the server really returns for facetCounts on an otherwise-empty
    // body: buildQuery counts capped at COUNT_CAP (index.ts ~15046), so the
    // big fields come back as exactly 10,000. If the page asks, this is what
    // it would print — so the mock is armed and the proof is that it is
    // never consulted.
    mount({ facetCounts: { operations: 10_000, healthcare: 10_000, hospitality_retail: 10_000, engineering: 9_800, other: 10_000 } });
    await settled();
    await waitFor(() => expect(industryChip("Operations & Logistics")?.textContent).toContain("138,308"), SLOW);
    const before = railChipTexts();
    expect(before.length, "the rail rendered its counted chips").toBeGreaterThan(3);
    expect(before.every((s) => !s.includes("+")), "an exact facet entry never wears the list cap's plus").toBe(true);
    fireEvent.click(industryChip("Operations & Logistics")!);
    await waitFor(() => expect(lastBody().category).toBe("operations"), SLOW);
    // Past the 400ms debounce in which the probe would have fired, and past
    // the mock's reply had it been sent.
    await new Promise((r) => setTimeout(r, 800));
    const after = industryChip("Operations & Logistics")?.textContent ?? "";
    expect(after, "the only filter on the board is this chip; the exact facet still answers, and 10,000+ is a different number for the same fact").toContain("138,308");
    expect(after).not.toContain("10,000+");
    // EVERY OTHER CHIP TOO: same numbers, same order, nothing lost its count.
    expect(railChipTexts(), "the chip is the only filter, so no other chip's number or place may move").toEqual(before);
    // AND THE PAGE DID NOT ASK. The exact facet was on hand; eighteen counted
    // queries under a four-second deadline would only have replaced it.
    expect(facetCountCalls().length, "no facetCounts request in the field-only state").toBe(0);
  });

  it("F2 '+ unsorted' prints the exact bucket in the field-only state, the capped probe under another filter, and nothing when the probe dropped it", async () => {
    // Two probe replies, in order: the first (under a second filter) counts
    // the bucket at the cap; the second reports it as 0 — which is what a
    // probe that reached the bucket with nothing left returns, and must print
    // as nothing rather than as "(0)".
    mount({ facetCounts: [{ operations: 10_000, other: 10_000 }, { operations: 9_800, other: 0 }] });
    await settled();
    fireEvent.click(industryChip("Operations & Logistics")!);
    await waitFor(() => expect(lastBody().category).toBe("operations"), SLOW);
    const label = () => (screen.getByLabelText(/unsorted/).closest("label")?.textContent ?? "");
    // The field is the only filter: the board-wide bucket is exact, and the
    // page did not ask the probe for a capped copy of it.
    await waitFor(() => expect(label(), "the bucket's size must print when the control that names it is on screen").toContain("162,800"), SLOW);
    expect(label()).not.toContain("10,000");
    expect(facetCountCalls().length).toBe(0);
    // A second filter: now the per-query probe is the only honest source, and
    // its capped count wears the cap's plus like every other chip.
    const modes = screen.getByRole("group", { name: "Work mode" });
    fireEvent.click(within(modes).getByRole("button", { name: "Remote" }));
    await waitFor(() => expect(lastBody().workMode).toBe("remote"), SLOW);
    await waitFor(() => expect(label()).toContain("10,000+"), SLOW);
    expect(label()).not.toContain("162,800");
    // The probe answered 0 for the bucket: no number at all, never "(0)".
    fireEvent.click(within(modes).getByRole("button", { name: "Hybrid" }));
    await waitFor(() => expect(lastBody().workMode).toBe("remote,hybrid"), SLOW);
    await waitFor(() => expect(facetCountCalls().length).toBe(2), SLOW);
    await waitFor(() => expect(label()).not.toMatch(/\(\d/), SLOW);
    expect(label()).toContain("unsorted");
  });

  it("F3 a résumé-ranked browse with no filter keeps the board-wide rail: the list narrows to scoreable rows, the board does not", async () => {
    // Fit mode sends hasDescription outside boardFilterBody, the server
    // withholds the reply's facet on that page, and the counted probe (armed
    // here) has never carried the narrowing either. The decision pinned: the
    // rail's figures are BOARD-wide in fit mode as everywhere, read from the
    // kept unfiltered facet — not blank, and not a probe.
    mount({ fitTerms: [], facetCounts: { operations: 10_000, healthcare: 10_000, other: 10_000 } });
    await settled();
    await waitFor(() => expect(industryChip("Operations & Logistics")?.textContent).toContain("138,308"), SLOW);
    const before = railChipTexts();
    sessionStorage.setItem("rb_board_resume", "x".repeat(400));
    fireEvent.click(screen.getByRole("button", { name: "For you" }));
    await waitFor(() => expect(lastBody().hasDescription, "no role to search: the page asks for scoreable rows").toBe(true), SLOW);
    expect("category" in lastBody(), "fit mode bound no field").toBe(false);
    await new Promise((r) => setTimeout(r, 800));
    expect(railChipTexts(), "every chip keeps its board-wide number and place under a described-only browse").toEqual(before);
    expect(facetCountCalls().length, "no counted probe: nothing on the board is filtered").toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "All jobs" }));
    await waitFor(() => expect(lastBody().hasDescription).toBeUndefined(), SLOW);
  });

  it("C19 'All industries' is an expander: it opens the rail and sends nothing", async () => {
    mount(); await settled();
    const before = listBodies().length;
    const btn = await waitFor(() => screen.getByRole("button", { name: /All industries/ }), SLOW);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /Fewer/ }).getAttribute("aria-expanded")).toBe("true");
    await new Promise((r) => setTimeout(r, 600));
    expect(listBodies().length, "a disclosure toggle is not a filter").toBe(before);
  });

  // ── ROW 8: For you | All jobs, Hide viewed, sort ────────────────────────

  it("C20 'For you' with no résumé asks nothing of the board and nothing of the scorer", async () => {
    mount(); await settled();
    const before = listBodies().length;
    fireEvent.click(screen.getByRole("button", { name: "For you" }));
    await new Promise((r) => setTimeout(r, 600));
    expect(fitCalls().length, "no résumé, no retrieval, no scoring").toBe(0);
    expect(listBodies().length).toBe(before);
  });

  it("C21 'For you' with a résumé retrieves through fit-terms and the list is searched for the role, not re-sorted", async () => {
    mount({ fitTerms: ["registered nurse", "nurse"] }); await settled();
    // Arrive with nothing, so the mount-time auto-enable stays unlocked and
    // the CLICK is what starts retrieval.
    sessionStorage.setItem("rb_board_resume", "x".repeat(400));
    fireEvent.click(screen.getByRole("button", { name: "For you" }));
    await waitFor(() => expect(fitCalls().some(([, o]) => (o as { body?: Body })?.body?.action === "fit-terms")).toBe(true), SLOW);
    await waitFor(() => expect(lastBody().q).toBe("registered nurse"), SLOW);
    // fetchJobs writes the key with an undefined value (dropped by JSON on the
    // wire), so the VALUE is the claim, not the key's presence.
    expect(lastBody().hasDescription, "a role query already retrieves scoreable rows").toBeUndefined();
    // And the way back.
    fireEvent.click(screen.getByRole("button", { name: "All jobs" }));
    await waitFor(() => expect(text()).not.toContain("ordered by fit"), SLOW);
  });

  it("C22 'Hide viewed' narrows the loaded page in the browser and sends no request", async () => {
    localStorage.setItem("rb_viewed_jobs", JSON.stringify(["lever:beta:2"]));
    mount(); await settled();
    expect(cardFor("Warehouse Associate")).toBeTruthy();
    const before = listBodies().length;
    const btn = screen.getByRole("button", { name: "Hide viewed" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(cardFor("Warehouse Associate")).toBeUndefined(), SLOW);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(cardFor("Staff Engineer")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    expect(listBodies().length, "a local view must not re-search the board").toBe(before);
  });

  it("C23 the sort select sends sort:salary, and the default caption names the weave", async () => {
    mount(); await settled();
    // Same undefined-valued-key shape as hasDescription: judge the value.
    expect(lastBody().sort).toBeUndefined();
    expect(text()).toContain("spread across employers");
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "salary" } });
    await waitFor(() => expect(lastBody().sort).toBe("salary"), SLOW);
    expect(text()).toContain("ordered by stated salary floor");
    expect(text()).not.toContain("spread across employers");
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "newest" } });
    await waitFor(() => expect(lastBody().sort).toBeUndefined(), SLOW);
  });

  // ── Jump back in ────────────────────────────────────────────────────────

  it("C24 'Jump back in' opens the remembered posting by id through action:detail, and sends no list request", async () => {
    localStorage.setItem("rb_recent_jobs", JSON.stringify([{ id: "workday:zeta:9", title: "Old Role", company: "Zeta" }]));
    mount(); await settled();
    const before = listBodies().length;
    fireEvent.click(screen.getByRole("button", { name: "Old Role · Zeta" }));
    await waitFor(() => expect(invoke.mock.calls.some(([fn, o]) => fn === "job-board"
      && (o as { body?: Body })?.body?.action === "detail" && (o as { body?: Body })?.body?.id === "workday:zeta:9")).toBe(true), SLOW);
    await new Promise((r) => setTimeout(r, 600));
    expect(listBodies().length).toBe(before);
  });

  // ── Bottom quick chips ──────────────────────────────────────────────────

  it("C25 '$100k+' sends salaryFloor 100000 alone, and toggles off to nothing", async () => {
    mount(); await settled();
    fireEvent.click(quickChip("$100k+"));
    await waitFor(() => expect(lastBody().salaryFloor).toBe(100000), SLOW);
    expect("hasStatedPay" in lastBody()).toBe(false);
    expect("payBasis" in lastBody()).toBe(false);
    fireEvent.click(quickChip("$100k+"));
    await waitFor(() => expect("salaryFloor" in lastBody()).toBe(false), SLOW);
  });

  it("C26 'Posted this week' sends maxAgeDays 7 and agrees with the 'This week' date chip", async () => {
    mount(); await settled();
    fireEvent.click(quickChip("Posted this week"));
    await waitFor(() => expect(lastBody().maxAgeDays).toBe(7), SLOW);
    expect(dateChip("This week").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(quickChip("Posted this week"));
    await waitFor(() => expect("maxAgeDays" in lastBody()).toBe(false), SLOW);
  });

  it("C27 the mobile 'Actively hiring' chip is the desktop toggle's twin: same state, no request", async () => {
    mount(); await settled();
    const before = listBodies().length;
    const chips = screen.getAllByRole("button", { name: "Actively hiring" });
    const mobile = chips.find((b) => !b.className.includes("lg:inline-flex"))!;
    fireEvent.click(mobile);
    await waitFor(() => expect(desktopHiring().getAttribute("aria-pressed")).toBe("true"), SLOW);
    await new Promise((r) => setTimeout(r, 600));
    expect(listBodies().length, "it narrows the rows already loaded, not the board").toBe(before);
    expect("activelyHiring" in lastBody()).toBe(false);
  });

  it("C28 'Compact view' is a density preference: remembered locally, sends nothing", async () => {
    mount(); await settled();
    const before = listBodies().length;
    const btn = screen.getAllByRole("button", { name: "Compact view" })[0];
    fireEvent.click(btn);
    expect(screen.getAllByRole("button", { name: "Comfortable view" }).length).toBeGreaterThan(0);
    expect(localStorage.getItem("rb_density")).toBe("compact");
    await new Promise((r) => setTimeout(r, 600));
    expect(listBodies().length).toBe(before);
  });
});
