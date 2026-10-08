// "NEWEST FIRST" MUST ORDER BY DATE, AND THE SENTENCE UNDER IT MUST BE TRUE.
//
// The board ordered by `posted_at` nulls-last ONLY when the request body carried
// sort:"newest", and Jobs.tsx sent that only when there was a query. An ordinary
// no-query browse sent no sort at all, so the server fell back to
// effective_posted = coalesce(posted_at, first_seen) — and every posting whose
// employer never dated it took OUR OWN CRAWL STAMP and sorted to the top of a
// page whose control read "Newest first".
//
// MEASURED live with the anon key against production, 2026-09-26, on the exact
// body the UI sends:
//
//   {"action":"list","limit":60}                      59 of 60 rows undated
//   {"action":"list","limit":60,"sort":"newest"}        0 of 60 rows undated
//
// same board, same minute, one key apart. And in the company-filtered state the
// page printed jobsPage.orderNewest — "newest first, company-stated dates before
// undated" — over the exact inverse of that order:
//
//   {"action":"list","limit":30,"groupSimilar":false,"companies":["classicfls"]}
//     -> undated first, then 2026-09-25, 2026-09-25, 2026-09-22, ... 2026-09-01
//   the same body with sort:"newest"
//     -> 2026-09-25, 2026-09-25, 2026-09-22, ... 2026-09-01, then the undated row
//
// A wrong order is a ranking nuisance; a sentence asserting the inverse of what
// it is printed over is a false displayed fact, in nine languages.
//
// WHY THE OBVIOUS FIX WAS NOT ENOUGH, and what this file therefore guards. Just
// sending sort:"newest" relocates every undated posting behind ~741,000 dated
// ones: measured the same day, the first undated row under that order sits
// between offset 740,000 and 742,000 of 746,300 — about 12,350 "Load more"
// presses at PAGE 60, which is exile rather than ordering. index.ts:~14268 made
// undated rows participate in recency deliberately, and the same file concludes
// that "an undated posting should still be served, it just should not claim to
// be the newest thing on the board." Both sentences hold here: the dated order
// is the default and undated rows sort last under it, the placement is
// DISCLOSED, and the discovery order that reaches those rows at page ONE (59 of
// 60 undated, measured) is offered beside the claim under the name of whose date
// it is — ours, not the employer's.
//
// THE PROPERTY, stated once: a UI state may print an order claim only if the
// request body that state produces asks the server for the order the claim
// describes. That is the pairing this file walks state by state, behaviourally,
// judged by the request body — the same rule as state-and-request-cannot-disagree
// (which covered only the q-present path) applied to ORDER rather than filters.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { codeOf } from "./helpers/strip-comments";

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

// Several cases here chain waits (mount, then a click, then a second body), and
// vitest's per-case default is 5s for the whole case — the reason this budget is
// set per file in the other click-through suites.
vi.setConfig({ testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
/** The server's own source, comments stripped: a docblock that quotes a column
 *  name would otherwise satisfy a guard about the column the code orders by,
 *  which is this repository's most-repeated guard failure. */
const FN = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const SLOW = { timeout: 4000 } as const;

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

/** Two dated rows and one UNDATED row — the population this whole file is about.
 *  postedAt null is what a posting whose employer states no date looks like on
 *  the wire (rowToJob emits null, and the card renders no age for it). */
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
    id: "bamboohr:classicfls:502", source: "bamboohr", token: "classicfls", company: "Classic FLS",
    title: "Undated Role", location: "Reno, NV, USA", country: "US",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null,
    salaryPeriod: null, salaryCurrency: null,
    workMode: null, employmentType: null, experienceBand: null, minYears: null,
    category: "operations", department: null,
    postedAt: null, lastSeen: ago(0), recheckedAt: null, applyUrl: "https://x/3", remote: false,
  },
];

type Body = Record<string, unknown>;

function hookClipboard() {
  vi.stubEnv("DEV", false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
}
const clipboard = () => (navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

/**
 * A LIST REPLY THAT ANSWERS THE BODY IT WAS SENT, not one fixed shape.
 *
 * `ranked: true` WHENEVER THE BODY CARRIES A QUERY, because that is what the
 * ranked path sends and a query page never sees a reply without it unless the RPC
 * errored. A flat fixture that omitted it put every q-state of this file on the
 * recency FALL-THROUGH arms — the ones whose sentences end "(relevance ranking
 * briefly unavailable)" — so two cases here were measuring the outage state and
 * calling it the search state, and both then disagreed with each other about
 * whether a query page may print the discovery claim. Read the response key
 * before asserting on the sentence it selects (feedback_measure_like_with_like).
 *
 * `extra` lets one case state the exit that answered it (sortScope, sortMatcher,
 * bucketedOrder), which is the only way to walk the search-path order claims: the
 * page prints them from the SERVER's fields now, not from the sort it asked for.
 */
function mount(path = "/jobs", extra: Record<string, unknown> = {}) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length,
          companies: [{ token: "acme", name: "Acme", count: 12 }],
          companiesCount: 1, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
          ...(b.q ? { ranked: true } : {}),
          ...extra,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
/** The LIST request and only the list request — the panel's similar-roles lookup
 *  and the rescue counts are action:"list" too; the page request carries offset. */
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list"
    && !(o as { body: Body }).body.countOnly && !(o as { body: Body }).body.facetCounts
    && "offset" in (o as { body: Body }).body)
  .map(([, o]) => (o as { body: Body }).body);
const lastBody = () => listBodies().at(-1) as Body;
const search = () => new URLSearchParams(window.location.search);
const sortSelect = () => screen.getByLabelText("Sort") as HTMLSelectElement;

/**
 * THE CLAIM VOCABULARY, declared rather than matched loosely.
 *
 * Each entry is a phrase the page can print about the ORDER, and the sort value
 * the server needs to be asked for in order to make it true. This is what makes
 * the pairing case a property rather than a spelling check: add an order claim
 * to the page without adding it here and the "every claim on screen is in this
 * table" case fails; pair it with the wrong sort and the pairing case fails.
 */
/**
 * EVERY ORDER CLAIM THE PAGE CAN PRINT, AND THE BODIES THAT PRODUCE IT.
 *
 * `sorts` is a SET, not one value, because a claim names an ORDERING KEY and more
 * than one body can ask for that key. The discovery phrase is the case that
 * forced it: `sort:"discovered"` and NO sort key at all are served by the same
 * `effective_posted` fall-through, so the sentence is true of both — pinning it
 * to the single string "discovered" failed a relevance page that was telling the
 * truth. A set keeps the property ("this sentence is only reachable from a body
 * that produces this order") while admitting the bodies that do.
 *
 * `scope` is the server field the claim ALSO requires, for the two search-path
 * sentences. Those were missing from this table entirely, which is why the
 * reverse-direction check below never ran over the q+newest states — the ones the
 * audit graded blocker, where three cards printed under a total of 10,000+. The
 * page now selects them from the reply's own `sortScope`, so the claim is a pair:
 * a body that asked for a date order AND an exit that said which set it ordered.
 */
const CLAIMS: ReadonlyArray<{ phrase: string; sorts: ReadonlyArray<string | undefined>; scope?: string; why: string }> = [
  {
    phrase: "newest by the date each employer states",
    sorts: ["newest"],
    why: "the default browse's woven claim — only posted_at DESC NULLS LAST produces it",
  },
  {
    phrase: "company-stated dates before undated",
    sorts: ["newest"],
    why: "the company/lander claim — the arm that shipped asserting the inverse of what it served",
  },
  {
    phrase: "ordered by each employer's stated date",
    sorts: ["discovered", undefined],
    why: "the discovery order — our crawl stamp, effective_posted, which is also what a body with NO sort key gets",
  },
  {
    phrase: "newest first across every posting whose title matches",
    sorts: ["newest"],
    scope: "matchSet",
    why: "the whole-match-set claim — only the SQL date order over the title match set earns it",
  },
  {
    phrase: "newest of the closest matches only",
    sorts: ["newest"],
    scope: "relevanceWindow",
    why: "the window claim — the ranked seam date-sorted in memory, which is not the match set",
  },
];

describe("newest first must order by date, and the sentence under it must be true", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the ordinary browse asks the server for the order it claims", async () => {
    // THE DEFECT ITSELF. This body is the one measured at 59 of 60 undated rows
    // on production. It has to carry the sort, because the server's no-sort
    // fallback is the crawl order and the caption above the rows says it is not.
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(lastBody().sort, "a no-query browse that sends no sort is served in crawl order").toBe("newest");
    expect(text()).toContain("newest by the date each employer states");
    // The weave is still disclosed in the same breath — it genuinely relaxes
    // strict date order, and that disclosure is what makes the claim true.
    expect(text()).toContain("spread across employers");
  });

  it("the company-filtered page asks for the order its sentence promises", async () => {
    // The measured violation was in this state: undated rows FIRST under
    // "company-stated dates before undated". The weave stands down here (the
    // reader asked for one employer), which is why this arm exists at all.
    mount("/jobs?company=acme");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(text()).toContain("company-stated dates before undated");
    expect(text(), "the weave must not be claimed where it does not run").not.toContain("spread across employers");
    expect(lastBody().sort).toBe("newest");
  });

  it("no order claim is reachable from a body that does not produce that order", async () => {
    // THE GENERAL PROPERTY, walked over every state that can print one. A claim
    // on screen whose state sends a different sort is the defect class; so is a
    // claim nobody declared in CLAIMS.
    const states: Array<{ name: string; go: () => Promise<void> }> = [
      { name: "default browse", go: async () => { mount(); await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW); } },
      { name: "company filter", go: async () => { mount("/jobs?company=acme"); await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW); } },
      {
        name: "discovery order",
        go: async () => {
          mount();
          await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
          fireEvent.click(screen.getByRole("button", { name: "Mix them in by when we first saw them" }));
          await waitFor(() => expect(lastBody().sort).toBe("discovered"), SLOW);
        },
      },
      {
        name: "shared discovery link",
        go: async () => { mount("/jobs?sort=discovered"); await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW); },
      },
      {
        name: "salary sort",
        go: async () => {
          mount();
          await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
          fireEvent.change(sortSelect(), { target: { value: "salary" } });
          await waitFor(() => expect(lastBody().sort).toBe("salary"), SLOW);
        },
      },
      {
        name: "relevance search",
        go: async () => { mount("/jobs?q=engineer"); await waitFor(() => expect(lastBody().q).toBe("engineer"), SLOW); },
      },
      // THE THREE STATES THE TABLE COULD NOT SEE, added because the
      // reverse-direction check below never ran over a q+newest body — and that
      // body is the one the audit graded blocker (3 cards under "10,000+").
      {
        name: "newest search, whole match set",
        go: async () => {
          mount("/jobs?q=engineer&sort=newest", { sortScope: "matchSet", sortMatcher: "title" });
          await waitFor(() => expect(lastBody().sort).toBe("newest"), SLOW);
        },
      },
      {
        name: "newest search, relevance window",
        go: async () => {
          mount("/jobs?q=engineer&sort=newest", { sortScope: "relevanceWindow", sortScopeRows: 200 });
          await waitFor(() => expect(lastBody().sort).toBe("newest"), SLOW);
        },
      },
      {
        // A whitespace query is served by the SQL path (boardFilterBody drops it),
        // so it is an ordinary browse and every reader of "is there a query" must
        // agree with that — the raw-string readers are what split this state.
        name: "whitespace query",
        go: async () => { mount("/jobs?q=%20%20"); await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW); },
      },
      {
        // The two-bucket page: the chosen field's rows, then "other", each half
        // ordered. The date claim is true inside a group and false across the
        // seam, so the page has to disclose the grouping rather than restate the
        // order — asserted by name below the walk.
        name: "category + uncategorised",
        go: async () => {
          mount("/jobs?cat=engineering&inclUncat=1", { bucketedOrder: true });
          await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
        },
      },
    ];
    for (const st of states) {
      invoke.mockReset(); rpc.mockReset();
      document.body.innerHTML = "";
      await st.go();
      const shown = text();
      // `Body` is Record<string, unknown>, so the sort arrives untyped; narrow it
      // once here rather than casting at each use, and keep `undefined` as a real
      // member of the set (no sort key IS one of the orders).
      const raw = lastBody().sort;
      const sent: string | undefined = typeof raw === "string" ? raw : undefined;
      for (const c of CLAIMS) {
        if (shown.includes(c.phrase)) {
          expect(
            c.sorts.includes(sent),
            `${st.name} prints "${c.phrase}" (${c.why}) but its body asks for sort=${String(sent)}`,
          ).toBe(true);
        }
      }
      // …and the reverse direction: a body asking for a date order must be under
      // a sentence that names one, or the page is ordering silently. A search is
      // held to the claim its EXIT earns, which is why `scope` is part of the
      // pairing: the reply names the set it ordered and the sentence may not
      // outrun it.
      if (sent === "newest" || sent === "discovered") {
        expect(
          CLAIMS.some((c) => c.sorts.includes(sent) && shown.includes(c.phrase)),
          `${st.name} asks for sort=${String(sent)} and prints no claim that describes it`,
        ).toBe(true);
      }
    }
  });

  it("the two-bucket page discloses the grouping instead of restating the date order", async () => {
    /* WHAT THIS GUARDS. `category` + `includeUncategorised` is served as
     * `[...chosen field's rows, ..."other" rows]` — each half ordered, the seam
     * between them not. A single "newest by the date each employer states" over
     * that concatenation is false across the seam, and this state was invisible to
     * the CLAIMS walk because nothing on screen named the grouping.
     *
     * The server says `bucketedOrder` and the page prints the grouping, so the
     * date sentence describes what it is true of (inside a group) rather than the
     * page (across two). */
    mount("/jobs?cat=engineering&inclUncat=1", { bucketedOrder: true });
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(lastBody().sort, "the two-bucket page still asks for the date order").toBe("newest");
    expect(
      text(),
      "the two-bucket seam is undisclosed — the date claim then covers a concatenation it is not true of",
    ).toContain("the date order runs inside each group, not across both");
    expect(text(), "the disclosure must name WHICH two groups, or it explains nothing")
      .toContain("those whose employer named no field");
  });

  it("wherever the page claims newest, it says where the undated postings went and offers a way to them", async () => {
    // REACHABILITY IS PART OF THE CLAIM. Ordering by the employer's date with
    // nulls last is honest and it puts ~5,000 undated postings past offset
    // 740,000 of 746,300 — ~12,350 "Load more" presses. Saying so, and offering
    // the order where those rows are on page one, is the difference between
    // ordering them last and exiling them.
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(text()).toContain("Postings whose employer states no date sort after every dated one.");
    const link = screen.getByRole("button", { name: "Mix them in by when we first saw them" });
    fireEvent.click(link);
    await waitFor(() => expect(lastBody().sort).toBe("discovered"), SLOW);
    // The claim changes with the order, and it names WHOSE date this one is.
    expect(text()).toContain("ordered by each employer's stated date");
    // Both halves of the order are named: the undated rows are placed by ours.
    expect(text()).toContain("for a posting with no date, by when we first saw it");
    // The weave runs in this order too (it is a no-query browse), so this arm
    // discloses it as well — an order claim that omits a permutation the page
    // performs is the same defect in a smaller font.
    expect(text()).toContain("spread across employers");
    // …and it stops promising a placement that is no longer true: in this order
    // the undated rows are at the FRONT.
    expect(text(), "the undated-tail disclosure must not survive into the order that leads with them")
      .not.toContain("Postings whose employer states no date sort after every dated one.");
    expect(text()).not.toContain("newest by the date each employer states");
  });

  it("the discovery order is in the address bar, so a shared link shows the order the sender saw", async () => {
    // D3's lesson (a sort that lived only in component state served relevance on
    // reload) applied to the third order.
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Mix them in by when we first saw them" }));
    await waitFor(() => expect(search().get("sort")).toBe("discovered"), SLOW);
    expect(sortSelect().value, "the select must show the order being served").toBe("discovered");
  });

  it("the discovery order is not offered where the server cannot serve it", async () => {
    // With a query the ranked path selects rows by relevance and applies no date
    // order at all, so a page asking for this one would print a claim about an
    // ordering that did not happen. The option is absent, and a URL that asks
    // for it anyway does not produce the claim or the key.
    mount("/jobs?q=engineer&sort=discovered");
    await waitFor(() => expect(lastBody().q).toBe("engineer"), SLOW);
    expect(Array.from(sortSelect().options).map((o) => o.value)).not.toContain("discovered");
    expect(lastBody().sort, "a query page must not ask for an order the ranked path ignores").not.toBe("discovered");
    expect(text()).not.toContain("ordered by each employer's stated date");
  });

  it("a query of nothing but spaces cannot split the order claim from the body", async () => {
    // ONE DEFINITION OF "IS THERE A QUERY", or this state has two orders. The
    // claim chain and the request body both branch on `q` being TRUTHY, so a
    // view keyed on `q.trim()` would have gone active here (trim empty) while the
    // page printed the relevance claim (q truthy) — a sentence and a body
    // disagreeing inside one state, which is the defect class itself rather than
    // an edge case.
    mount("/jobs?q=%20%20");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    // The board drops a blank query, so nothing is ranked and the page is an
    // ordinary date-ordered browse…
    expect(lastBody().q, "boardFilterBody sends no query for whitespace").toBeUndefined();
    expect(lastBody().sort).toBe("newest");
    // …so the sentence must be a date sentence. Branching the claim on the raw
    // string printed "ordered by relevance to your search" here.
    expect(text(), "a page with nothing to rank must not claim a relevance order")
      .not.toContain("ordered by relevance to your search");
    /* THE WOVEN ARM, because the weave RUNS here. `interleaveEmployers` used to
     * branch on the raw `q` string while the body, the select's options, the
     * undated-tail disclosure and the rest of the claim chain had all moved to
     * `q.trim()` — so this state printed the non-woven sentence
     * ("company-stated dates before undated") over a page the server had woven
     * across employers (`if (!sortSalary) grouped.jobs = interleaveByCompany(...)`
     * is unconditional on the SQL path, and boardFilterBody drops a blank q). One
     * state, two answers. Both readers now share the one trimmed test, so this
     * case asserts the woven claim and its disclosure. */
    expect(text()).toContain("newest by the date each employer states");
    expect(text(), "the weave runs on this page and the sentence must say so").toContain("spread across employers");
    expect(text(), "the non-woven claim belongs to the states where the weave stands down")
      .not.toContain("company-stated dates before undated");
    // The same state asking for the discovery order gets the discovery claim,
    // both derived from the one trimmed test.
    invoke.mockReset(); rpc.mockReset(); document.body.innerHTML = "";
    mount("/jobs?q=%20%20&sort=discovered");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(lastBody().sort).toBe("discovered");
    expect(text()).toContain("ordered by each employer's stated date");
  });

  it("an order search_jobs cannot express is not handed to an agent as one it can", async () => {
    // The handoff is a CLAIM too: the prompt carries the order on screen as a
    // search_jobs argument. SearchSort is relevance | newest | salary, so the
    // discovery order cannot ride along — and silently re-labelling it "newest"
    // would hand over a search in a different order than the one being looked
    // at. It is omitted and the omission is stated, the same rule the
    // client-side "Actively hiring" filter already follows.
    hookClipboard();
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Mix them in by when we first saw them" }));
    await waitFor(() => expect(lastBody().sort).toBe("discovered"), SLOW);
    fireEvent.click(screen.getByRole("button", { name: "Send this search to my agent" }));
    await waitFor(() => expect(clipboard().length).toBe(1), SLOW);
    const copied = clipboard()[0];
    const args = /search_jobs with (\{.*?\}) and show me/.exec(copied)?.[1] ?? "";
    expect(args, "the handoff arguments were not found in the prompt").not.toBe("");
    expect(JSON.parse(args).sort, "the discovery order must not be handed over as a search_jobs sort").toBeUndefined();
    expect(copied).toContain("the order is not included here");
  });

  // ── THE OTHER RUNTIME ────────────────────────────────────────────────────
  //
  // The claims above are printed in a browser and the ordering happens in a Deno
  // function; nothing the compiler or vitest runs can see across that boundary,
  // which is exactly how copy on this platform goes false (project_claim_drift).
  // So these read the server's source and fail on drift.

  it("the server orders a newest request by the employer's date, with undated last", () => {
    expect(FN).toMatch(/newestFirst\s*\n\s*\? q\.order\("posted_at", \{ ascending: false, nullsFirst: false \}\)/);
    // The WINDOW stays on the coalesce, deliberately: an undated posting is still
    // served, it just does not claim to be the newest thing on the board.
    expect(FN).toMatch(/\.gte\(dateCol, freshCutoffIso\)/);
  });

  it("the order the page calls 'discovered' is the server's effective_posted walk", () => {
    // The order is effective_posted = coalesce(posted_at, last_seen), and
    // last_seen is written at insert only, so it is the EMPLOYER'S date where
    // they state one and our first-seen stamp where they do not. The claim
    // used to say "our date, not the employer's" -- false for every dated
    // posting -- and now names both halves (2026-10-08). The value
    // "discovered" reaches it by being neither of the two sorts the ordering
    // branches on. Both halves are pinned: the fall-through orders by dateCol,
    // and dateCol at the page call site is effective_posted.
    expect(FN).toMatch(/: q\.order\(dateCol, \{ ascending: false, nullsFirst: false \}\)/);
    expect(FN).toMatch(/pageWith\("effective_posted", "salary_rank_usd", false\)/);
    // If a future change DOES branch on the value, this fails — on purpose: the
    // claim then describes that branch and has to be re-pinned against it rather
    // than against a fall-through that no longer serves it.
    expect(
      /body\.sort === "discovered"/.test(FN),
      "index.ts now branches on sort=\"discovered\" — re-pin this case against what that branch orders by",
    ).toBe(false);
  });

  it("the dated walk's cursor is written in the column the dated walk orders by", () => {
    // MOVING THE ORDINARY BROWSE ONTO sort=newest MOVED IT OFF THE KEYSET. The
    // cursor was refused for that sort (rightly: a coordinate in
    // effective_posted cannot describe a posted_at ordering) so the board's most
    // common request would have gone back to offset paging over a table taking
    // ~70k inserts a day — 4 of 8 page transitions overlapped when it last did,
    // the worst pair repeating 9 of 60 rows and hiding 9 others. A wrong order
    // must not be traded for a lossy one.
    expect(FN).toMatch(/\.or\(`posted_at\.lt\."\$\{cursor\.ep\}",and\(posted_at\.eq\."\$\{cursor\.ep\}",id\.gt\."\$\{cursor\.id\}"\)`\)/);
    expect(FN).toMatch(/return rp\?\.posted_at && rp\?\.id \? \{ ep: rp\.posted_at, id: rp\.id, k: "pa" \} : null;/);
    // The discovery order keeps its own untouched coordinate.
    expect(FN).toMatch(/\.or\(`\$\{dateCol\}\.lt\."\$\{cursor\.ep\}",and\(\$\{dateCol\}\.eq\."\$\{cursor\.ep\}",id\.gt\."\$\{cursor\.id\}"\)`\)/);
    expect(FN).toMatch(/return r\?\.effective_posted && r\?\.id \? \{ ep: r\.effective_posted, id: r\.id \} : null;/);
  });

  it("the client sends the cursor's kind back, so the server does not refuse its own coordinate", async () => {
    /* WHAT THIS GUARDS, AND WHY THE SOURCE REGEXES ABOVE CANNOT.
     *
     * The server now REQUIRES the `k` discriminator on every cursor it accepts and
     * refuses — silently, by falling through to offset paging — any coordinate
     * whose kind does not match the order being paged. The client's declared type
     * and the ref that carries it both omitted `k`, and the round trip survived
     * only because JavaScript copies the whole object: `nextCursorRef.current =
     * br.nextCursor ?? null` happens to carry a field nothing on this side names.
     * Any future normalisation of that object (a pick, a zod parse, a spread of
     * named fields) drops `k` and the ordinary browse goes back to offset paging
     * with nothing red — the shape this repo measured on 2026-08-18, where 4 of 8
     * page-one-to-page-two transitions overlapped, the worst pair repeating 9 of
     * 60 rows and silently hiding 9 others.
     *
     * The two guards above read the edge function's SOURCE. They cannot see the
     * client at all, and no fixture in this file made a page-2 request before this
     * case: `k: "pa"` appeared nowhere in a request-body assertion. This is the
     * cross-runtime round trip project_claim_drift asks for — judged by the
     * request body, per project_live_click_through.
     */
    mount("/jobs", {
      hasMore: true,
      nextOffset: 60,
      nextCursor: { ep: "2026-09-20T10:00:00+00:00", id: "greenhouse:acme:1", k: "pa" },
    });
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(lastBody().sort, "the dated order is what this cursor belongs to").toBe("newest");
    const before = listBodies().length;
    fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(before), SLOW);
    const page2 = listBodies().at(-1) as Body & { cursor?: { ep?: string; id?: string; k?: string } };
    expect(page2.offset, "page two must actually be a second page").toBeGreaterThan(0);
    expect(page2.cursor, "the keyset coordinate was dropped — this walk is back on offset paging").toBeTruthy();
    expect(
      page2.cursor?.k,
      'the cursor lost its kind, so the server treats a posted_at coordinate as effective_posted, ' +
        "fails its own kind check, and silently falls back to the overlapping offset walk",
    ).toBe("pa");
    expect(page2.cursor?.ep).toBe("2026-09-20T10:00:00+00:00");
    expect(page2.cursor?.id).toBe("greenhouse:acme:1");
  });

  it("the discovery walk sends its own untagged coordinate, not the dated one's", async () => {
    // THE MIRROR. The effective_posted cursor is unchanged and carries NO kind —
    // the server reads an absent `k` as "ep". Sending "pa" here would be refused
    // just as silently, so the client must forward whatever the server minted and
    // invent nothing.
    mount("/jobs?sort=discovered", {
      hasMore: true,
      nextOffset: 60,
      nextCursor: { ep: "2026-09-20T10:00:00+00:00", id: "greenhouse:acme:1" },
    });
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    expect(lastBody().sort).toBe("discovered");
    const before = listBodies().length;
    fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
    await waitFor(() => expect(listBodies().length).toBeGreaterThan(before), SLOW);
    const page2 = listBodies().at(-1) as Body & { cursor?: { ep?: string; id?: string; k?: string } };
    expect(page2.cursor, "the discovery walk lost its keyset too").toBeTruthy();
    expect(page2.cursor?.k, "a kind the server never minted was added to the discovery cursor").toBeUndefined();
    expect(page2.cursor?.ep).toBe("2026-09-20T10:00:00+00:00");
  });

  it("a cursor written in one order is refused by the other rather than applied", () => {
    // The two orders share one pair of coordinate names, so the kind has to be
    // carried and checked. Applied instead of refused, it pages through one
    // ordering using another's coordinates — the defect that made sorted page two
    // repeat page one, and it is silent. Refusal falls back to offset paging.
    const parser = FN.slice(FN.indexOf("const cursor = (() => {"), FN.indexOf("})();", FN.indexOf("const cursor = (() => {")));
    expect(parser, "cursor parser not found").not.toBe("");
    expect(parser).toMatch(/const wantK = body\.sort === "newest" \? "pa" : "ep";/);
    expect(parser).toMatch(/if \(k !== wantK\) return null;/);
    // The kind predicate is a SECOND spelling of `newestFirst` (which is declared
    // far below the parser, and reading a const above its declaration is this
    // repo's own live outage). The two must say the same thing.
    expect(FN).toContain('const newestFirst = body.sort === "newest";');
  });

  it("the dated keyset treats a short read as a seam, not as the end of the set", () => {
    /* WHAT THIS GUARDS. Both arms of the `k:"pa"` seek compare `posted_at`, and a
     * NULL comparison is UNKNOWN in SQL — so neither arm can ever return a row
     * whose posted_at is null, and the walk ran out exactly where the dated rows
     * did. `hasMore` then went false with the undated tail unserved while the
     * header went on printing the full total.
     *
     * On the unfiltered board that costs ~12,350 Load-more presses and the tail is
     * one click away in the discovery order, which is why it read as acceptable.
     * On a FILTERED newest page it is a quarter of the answer — MEASURED live
     * 2026-09-26: vendor=pinpoint + country=GB is 860 matches, 616 dated, 244
     * undated (28.4%), and the wall arrives after ~10 presses; vendor=pinpoint is
     * 959 of 3,554 (27.0%). The "12,350 presses" figure is the UNFILTERED board and
     * is off by three orders of magnitude for a filtered page, which is why the
     * cost note beside this code now carries both.
     *
     * The fix is that a SHORT seek falls through to the `.range()` read at the
     * accumulated offset — which has always included the tail, since
     * `posted_at DESC NULLS LAST` puts it last and that is why page one served
     * those rows. So the property is: the seek's short result must not be returned
     * as the answer.
     */
    const i = FN.indexOf('if (cursor && cursor.k === "pa"');
    expect(i, "the dated keyset branch is gone — re-point this guard at what replaced it").toBeGreaterThan(0);
    const branch = FN.slice(i, FN.indexOf("\n      }", i));
    // The short read is detected by comparing against the ask, not by a truthiness
    // check — a partly-filled page is short too.
    expect(
      branch,
      "the seek's result is returned without testing whether it filled: the undated tail is then the end of the walk",
    ).toMatch(/length >= fetchLimit\) return seek;/);
    // …and the crossing read is the offset one, which includes the tail.
    expect(branch, "nothing crosses the seam — there must be a .range() continuation after a short seek")
      .toMatch(/\.range\(offset, offset \+ fetchLimit - 1\)/);
    // An error must not be mistaken for a short page and re-queried.
    expect(branch, "a failed seek would be retried as if it had simply run out").toMatch(/seek\.error \|\|/);
  });

  it("the grouping top-up anchors in the column the page is ordered by", () => {
    /* WHAT THIS GUARDS. The single top-up that rescues a page clustering has eaten
     * was gated `!newestFirst` on the stated ground that "a thin newest page stays
     * thin". That rationale was about the ANCHOR, not the order — it is a keyset
     * continuation, and continuing an effective_posted coordinate through a
     * posted_at ordering moves rows across a boundary the cursor knows nothing
     * about. But the ordinary browse now sends sort:"newest" on every request, so
     * the gate retired the mechanism on the board's most common page — and the
     * starvation it exists for was MEASURED there ("retail sales" 39 cards under a
     * total of 3,437, nextOffset === fetchLimit).
     *
     * So the anchor follows the order, and the property is that the two agree.
     */
    const i = FN.indexOf("groupSimilar && !twoSubset && !sortSalary && !countOnly &&");
    expect(i, "the top-up gate is gone — re-point this guard").toBeGreaterThan(0);
    const block = FN.slice(i, i + 2500);
    expect(
      /!newestFirst/.test(FN.slice(i, FN.indexOf("mappedRows.length >= fetchLimit", i))),
      "the top-up is gated off the newest order again — that is now every browse page",
    ).toBe(false);
    // The anchor column and the value read off the last raw row must both follow
    // the order, or the continuation pages one ordering by another's coordinate.
    expect(block).toMatch(/const anchorCol = newestFirst \? "posted_at" : "effective_posted";/);
    expect(block).toMatch(/const anchorVal = newestFirst \? lastRaw\?\.posted_at : lastRaw\?\.effective_posted;/);
    // And it is SKIPPED rather than faked when the last row carries no date: a
    // posted_at comparison cannot describe the undated tail.
    expect(block, "the top-up runs without an anchor — an undated last row would fake a coordinate")
      .toMatch(/if \(anchorVal && lastRaw\?\.id\)/);
  });

  it("every locale states both order claims, and the unqualified one is gone from all nine", () => {
    // A locale VALUE overrides an inline English default, so editing the English
    // sentence alone leaves nine translated copies of the old claim rendering —
    // the agentPitchScope lesson. `orderNewestWoven` said "newest first" without
    // saying whose date that was, which is the distinction this whole defect
    // turns on, so it is DELETED rather than edited.
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length, "nine locales").toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as { jobsPage?: Record<string, string> };
      const page = j.jobsPage ?? {};
      for (const k of ["orderNewestWovenDated", "orderDiscovered2", "orderDiscoveredWoven2", "orderUndatedTail", "orderUndatedShow2", "sortDiscovered2"]) {
        expect(typeof page[k], `${f} is missing jobsPage.${k}`).toBe("string");
        expect(page[k]!.length, `${f}: jobsPage.${k} is empty`).toBeGreaterThan(0);
      }
      expect("orderNewestWoven" in page, `${f} still carries the retired unqualified claim`).toBe(false);
      // The "our date, not the employer's" family was false for every dated
      // posting (the order is coalesce(posted_at, first-seen)); retired the
      // same way, 2026-10-08.
      for (const k of ["orderDiscovered", "orderDiscoveredWoven", "orderUndatedShow", "sortDiscovered"]) {
        expect(k in page, `${f} still carries the retired jobsPage.${k}`).toBe(false);
      }
    }
  });
});
