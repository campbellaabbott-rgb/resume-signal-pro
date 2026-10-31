/**
 * A JOB PAGE WRITES ITS JOB MARKUP ONLY WHEN THE BAKE WOULD (the trusted-pages
 * round, 2026-10-25).
 *
 * WHAT WAS WRONG. The bake withheld the JobPosting of a posting whose employer
 * name its gate refuses (owner decision D7): the UKG board stored as "Axia
 * Logo Horizontal", a logo's alt text, kept its page with no markup and "the
 * employer" in its head. Then the React page hydrated over that file and
 * wrote postingJsonLd(shown) with no name gate, so a crawler that renders
 * read a JobPosting whose hiringOrganization was the logo text. The board's
 * detail pane (/jobs?job=) wrote its own JobPosting with no gate at all.
 *
 * WHAT IS TRUE NOW. postingJsonLd applies the bake's per-row rules before it
 * writes anything (postingMarkupGate: rule 1 from
 * scripts/prerender-posting-rule.mjs, the description length, the name gate
 * from scripts/prerender-names.mjs), and the bake decides each row through
 * bakePostingPage, which calls the same functions. So this file renders the
 * page for a row and compares what it wrote with what the bake writes for the
 * same row, both read from the app's own modules, whatever the row: a refused
 * name, a place in another country, a closed posting, a good one, a repaired
 * name, a staffing agency, USAJOBS, and a board that names no hirer for its
 * postings.
 *
 * WHERE THE TWO SIDES READ A ROW DIFFERENTLY (the review, 2026-10-26). The
 * page prints the row through shownPosting, which drops half a bracket from a
 * location cut off mid-field, and the board can answer with no description at
 * all (a failed re-read of the employer's system). Clearing the head whenever
 * the page's own markup came out empty deleted the bake's JobPosting in both
 * cases. Each is seeded here with the bake's own block, which must survive.
 *
 * AN ADDRESS THE BAKE RETIRED. A duplicate of a requisition another page
 * carries, and a page retired at the ceiling, are stubs with no markup in the
 * bake; the rows on them pass every per-row rule. The page reads the head the
 * document was loaded with and writes no JobPosting there, and a duplicate
 * keeps its twin as the canonical.
 *
 * THE DETAIL PANE writes the bake's own markup for the row, at its ?job=
 * address: a repaired name or an override is its hiring organisation, never
 * the stored label or tenant code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// THE PUBLISHER-ONLY SET, WHATEVER IT HOLDS. The set of boards that name no
// hirer for their postings (PUBLISHER_ONLY_BOARDS) lives in
// src/lib/employer-names.ts (trust/pages moved the module there from
// supabase/functions/_shared; company-display re-exports its
// boardNamesItsHirer, which postingEmployer asks). Each test below fills it as
// it needs; the module's own members are kept for the case that reads them.
// A mock of a path that no longer resolves never runs, and this file then
// proved nothing about the real set while every case passed (land/all
// recheck, 2026-10-27): the first publisher-only case asserts the factory ran
// and found a non-empty set, so a later move fails here instead.
const hoisted = vi.hoisted(() => ({ publisherOnly: new Set<string>(), realPublisherOnly: null as ReadonlySet<string> | null }));
vi.mock("../lib/employer-names", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const realSet = real.PUBLISHER_ONLY_BOARDS;
  hoisted.realPublisherOnly = realSet instanceof Set ? (realSet as ReadonlySet<string>) : null;
  return {
    ...real,
    PUBLISHER_ONLY_BOARDS: hoisted.publisherOnly,
    boardNamesItsHirer: (token: string | null | undefined) => !hoisted.publisherOnly.has(String(token ?? "").trim()),
  };
});

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import JobPosting from "@/pages/JobPosting";
import Jobs from "@/pages/Jobs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import { POSTING_LD_TAG_ID, postingEmployer, postingJsonLd, postingNameVerdict, postingPagePath, type PostingRow } from "@/components/jobs/posting-page";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { shownPosting } from "@/lib/listing/liveness";
import { resetBakedHeadForTests } from "@/components/seo/baked-head";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { bakePostingPage } from "../../scripts/prerender-seo.mjs";
import { postingRowEligible } from "../../scripts/prerender-pages.mjs";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const DESC = "We are hiring a medical assistant for our Bridgewater practice, working beside a team of physicians and nurses every day. ".repeat(5);

/** The bake's D: the app's own modules, as its esbuild entry bundles them. */
const D = { ...companyDisplay, ...postingPage };

const good = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:acme~wd3~Careers:JR1",
  title: "Medical Assistant",
  company: "Acme Health",
  token: "acme~wd3~Careers",
  source: "workday",
  location: "Bridgewater, NJ",
  country: "US",
  workMode: null,
  postedAt: ago(3),
  missingSince: null,
  applyUrl: "https://acme.example/jobs/JR1",
  salary: null,
  agency: false,
  ...over,
});

/** Synthetic tokens, so a name override added later cannot turn a case into another. */
const CASES: Array<{ what: string; row: PostingRow; markup: boolean }> = [
  { what: "a good posting", row: good(), markup: true },
  {
    what: "a name the gate refuses (logo text, the Axia shape)",
    row: good({ id: "ukg:recruiting~EXA1000EXMP~11111111-2222-3333-4444-555555555555:238cdd44", token: "recruiting~EXA1000EXMP~11111111-2222-3333-4444-555555555555", source: "ukg", company: "Example Logo Horizontal" }),
    markup: false,
  },
  { what: "a place in another country (Lagos, LA, Nigeria filed US)", row: good({ location: "Lagos, LA, Nigeria" }), markup: false },
  { what: "a posting the employer's feed stopped serving", row: good({ missingSince: ago(0) }), markup: false },
  { what: "a posting past the board's window", row: good({ postedAt: ago(400) }), markup: false },
  {
    what: "a name with a career-site label on it (Chubb External prints as Chubb)",
    row: good({ id: "oracle:chubb~ocs~CX:991", token: "chubb~ocs~CX", source: "oracle", company: "Chubb External", location: "Philadelphia, PA" }),
    markup: true,
  },
  { what: "a staffing agency's posting", row: good({ agency: true }), markup: false },
  {
    what: "a USAJOBS posting",
    row: good({ id: "usajobs:usajobs:812345", token: "usajobs", source: "usajobs", company: "Veterans Health Administration", location: "Denver, CO" }),
    markup: false,
  },
  {
    what: "a board still named by its tenant code",
    row: good({ id: "workday:shm~wd5~Summit_CityMD:JR9", token: "shm~wd5~Summit_CityMD", company: "Shm" }),
    markup: false,
  },
];

const pathOf = (row: PostingRow) => postingPagePath(row.id)!;
const jobEntities = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
    .filter((d) => d && d["@type"] === "JobPosting");
/** What the bake's markup reads as once written into a page and parsed back. */
const asWritten = (ld: Record<string, unknown> | null) => (ld ? [JSON.parse(JSON.stringify(ld))] : []);

/** The head as an older bake left it: a JobPosting under the shared id. */
function seedBakedJobPosting(row: PostingRow) {
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.id = POSTING_LD_TAG_ID;
  s.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: row.title, hiringOrganization: { "@type": "Organization", name: row.company } });
  document.head.appendChild(s);
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
        <Route path="/jobs" element={<div>THE BOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** Render the posting page for a row and wait for the board's answer to settle the head. */
async function renderedMarkup(row: PostingRow, opts: { description?: string | null; seed?: () => void } = {}) {
  const description = opts.description === undefined ? DESC : opts.description;
  invoke.mockImplementation(async (fn: string, a: { body?: { action?: string } } | undefined) =>
    fn === "job-board" && a?.body?.action === "detail" ? { data: { job: row, description }, error: null } : { data: [], error: null },
  );
  (opts.seed ?? (() => seedBakedJobPosting(row)))();
  const view = at(pathOf(row));
  const gone = !!row.missingSince || (row.postedAt ? Date.parse(row.postedAt) < Date.now() - 31 * DAY : false);
  await screen.findByRole("heading", { level: 1, name: gone ? /no longer live/i : row.title! }, SLOW);
  return view;
}

const clearHead = () => document.head.querySelectorAll('meta[name="robots"], script[type="application/ld+json"], link[rel="canonical"]').forEach((n) => n.remove());
beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); clearHead(); hoisted.publisherOnly.clear(); });
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); clearHead(); hoisted.publisherOnly.clear(); });

describe("the posting page writes the markup the bake writes for the same row", () => {
  for (const { what, row, markup } of CASES) {
    it(`${what}: ${markup ? "the same JobPosting" : "none"}, on the page and in the bake`, async () => {
      // The bake, for a page it carries and for one it would add: the markup
      // does not depend on which (D7 decides only whether a page is kept).
      const carried = bakePostingPage(row, DESC, { D, SITE, carried: true });
      const fresh = bakePostingPage(row, DESC, { D, SITE, carried: false });
      expect(!!carried.ld, "the bake's verdict on this row").toBe(markup);
      expect(fresh.ld).toEqual(carried.ld);

      await renderedMarkup(row);
      // A stale block from an older bake was seeded, so "none" means the page
      // took it OUT, and "one" means it replaced it rather than adding a second.
      await waitFor(() => expect(jobEntities()).toEqual(asWritten(carried.ld)), SLOW);
    });
  }

  it("the repaired name is the hiring organisation on both sides", async () => {
    const chubb = CASES.find((c) => c.row.company === "Chubb External")!.row;
    const baked = bakePostingPage(chubb, DESC, { D, SITE, carried: false });
    expect(baked.ld?.hiringOrganization).toEqual({ "@type": "Organization", name: "Chubb" });
    await renderedMarkup(chubb);
    await waitFor(() => expect(jobEntities()[0]?.hiringOrganization).toEqual({ "@type": "Organization", name: "Chubb" }), SLOW);
  });

  it("a refused name keeps its carried page with no markup and names no employer in the bake (D7), and is never a new page", () => {
    const axia = CASES[1].row;
    expect(postingNameVerdict(axia).reason).toBe("logo or image text");
    const carried = bakePostingPage(axia, DESC, { D, SITE, carried: true });
    expect(carried).toMatchObject({ live: true, ld: null, nameRefused: true, nameOnly: true, nm: "the employer" });
    expect(carried.job.company).toBe("");
    expect(bakePostingPage(axia, DESC, { D, SITE, carried: false })).toMatchObject({ live: false, ld: null });
    // The question the bake asks for D7 never emits markup by itself.
    expect(postingJsonLd(axia, DESC, { site: SITE })).toBeNull();
    expect(postingJsonLd(axia, DESC, { site: SITE, ignoreNameGate: true })).toBeTruthy();
  });

  it("a place in another country keeps its carried page with no markup, and is never a new page", () => {
    const lagos = CASES[2].row;
    expect(bakePostingPage(lagos, DESC, { D, SITE, carried: true })).toMatchObject({ live: true, ld: null, mismatchOnly: true });
    expect(bakePostingPage(lagos, DESC, { D, SITE, carried: false })).toMatchObject({ live: false, ld: null });
  });

  it("positive control: a good posting is a live page with markup in the bake, carried or new", () => {
    for (const carried of [true, false]) {
      const page = bakePostingPage(good(), DESC, { D, SITE, carried });
      expect(page.live).toBe(true);
      expect(page.ld?.hiringOrganization).toEqual({ "@type": "Organization", name: "Acme Health" });
      expect(page.ld?.url).toBe(`${SITE}${pathOf(good())}`);
    }
  });

  it("a description too short for a page gets no markup on either side", () => {
    const short = "We are hiring.";
    expect(bakePostingPage(good(), short, { D, SITE, carried: true }).ld).toBeNull();
    expect(postingJsonLd(good(), short, { site: SITE })).toBeNull();
  });
});

/** The head as this bake wrote it: the bake's own block for the row, under the shared id. */
function seedBakesOwnBlock(ld: Record<string, unknown> | null) {
  if (!ld) throw new Error("the bake writes no block for this row, so there is nothing to seed");
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.id = POSTING_LD_TAG_ID;
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);
}
/** Effects that run after the board's answer has rendered. */
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("where the page and the bake read a row differently, the page never takes away markup the bake wrote", () => {
  // The bake judges and marks up the row as the board returned it. The page
  // prints the row through shownPosting, which drops half a bracket from a
  // location cut off mid-field (JL13): "San Jose (Building 5" prints as
  // nothing, and with no work mode the row as shown has no place. The bake
  // still marks the raw row up (its address is the country), so the page
  // keeps that block rather than clearing it.
  const HALF_BRACKETS = ["San Jose (Building 5", "Chicago (IL", "Remote (US", "(Remote", "Main Campus (Building 4"];
  HALF_BRACKETS.forEach((location, i) => {
    it(`a location cut off inside a bracket ("${location}", no work mode): the bake's own JobPosting stays`, async () => {
      const row = good({ id: `workday:acme~wd3~Careers:HB${i}`, location, workMode: null });
      const baked = bakePostingPage(row, DESC, { D, SITE, carried: true });
      // What makes this case: the bake writes a live page with markup, and
      // the row as the page shows it would earn none on its own.
      expect(baked.live && !!baked.ld, "the bake writes a live page with markup").toBe(true);
      expect(postingJsonLd(shownPosting(row), DESC, { site: SITE }), "the row as shown earns none").toBeNull();
      await renderedMarkup(row, { seed: () => seedBakesOwnBlock(baked.ld) });
      await settle();
      expect(jobEntities()).toEqual(asWritten(baked.ld));
    });
  });

  it("the board answers with no description (its re-read of the vendor failed): the head stays as the bake wrote it", async () => {
    const row = good({ id: "workday:acme~wd3~Careers:ND1", location: "San Jose, CA" });
    const baked = bakePostingPage(row, DESC, { D, SITE, carried: true });
    expect(baked.ld).toBeTruthy();
    await renderedMarkup(row, { description: null, seed: () => seedBakesOwnBlock(baked.ld) });
    await settle();
    expect(jobEntities()).toEqual(asWritten(baked.ld));
  });

  it("an undated live posting carries none, whether or not a description came back", async () => {
    for (const description of [null, DESC]) {
      const row = good({ id: `workday:acme~wd3~Careers:UD${description ? 1 : 0}`, postedAt: null });
      const view = await renderedMarkup(row, { description });
      await waitFor(() => expect(jobEntities(), `description ${description ? "read" : "missing"}`).toEqual([]), SLOW);
      view.unmount();
      clearHead();
    }
  });

  it("a description the board did return, too short for the bake: the block goes", async () => {
    const row = good({ id: "workday:acme~wd3~Careers:SH1" });
    expect(bakePostingPage(row, "We are hiring.", { D, SITE, carried: true }).ld).toBeNull();
    await renderedMarkup(row, { description: "We are hiring." });
    await waitFor(() => expect(jobEntities()).toEqual([]), SLOW);
  });
});

describe("an address the bake retired keeps the bake's head: no JobPosting, and the canonical the bake chose", () => {
  // The bake writes a retired stub with no markup for a duplicate of a
  // requisition another page carries (canonical: the twin), for a page it
  // retired at the ceiling and for one about to leave the window (noindex).
  // The page used to write a JobPosting over each, and over a duplicate it
  // also moved the canonical back to itself, so a crawler that renders read
  // two indexable JobPostings for one requisition.
  const twin = good({ id: "workday:acme~wd3~Careers:JR1" });
  const row = good({ id: "workday:acme~wd3~Careers_Alt:JR1", token: "acme~wd3~Careers_Alt" });
  function bakeFile(path: string, robots: string, canonical: string) {
    window.history.replaceState({}, "", path);
    document.head.innerHTML = [
      `<meta name="x-prerendered" content="1">`,
      `<title>This posting no longer has a page of its own</title>`,
      `<meta name="description" content="This posting no longer has a page of its own. Browse the live openings on the board.">`,
      `<meta name="robots" content="${robots}">`,
      `<link rel="canonical" href="${SITE}${canonical}">`,
    ].join("");
    resetBakedHeadForTests();
  }
  const mount = (path: string) =>
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
  async function rendered(r: PostingRow) {
    invoke.mockImplementation(async (fn: string, a: { body?: { action?: string } } | undefined) =>
      fn === "job-board" && a?.body?.action === "detail" ? { data: { job: r, description: DESC }, error: null } : { data: [], error: null },
    );
    mount(pathOf(r));
    await screen.findByRole("heading", { level: 1, name: r.title! }, SLOW);
    await settle();
  }
  const canonicals = () => [...document.head.querySelectorAll('link[rel="canonical"]')].map((n) => n.getAttribute("href"));
  const robots = () => [...document.head.querySelectorAll('meta[name="robots"]')].map((n) => n.getAttribute("content"));
  afterEach(() => { cleanup(); document.head.innerHTML = ""; resetBakedHeadForTests(); window.history.replaceState({}, "", "/"); });

  it("a duplicate pointed at its twin: no JobPosting, and the twin stays the canonical", async () => {
    bakeFile(pathOf(row), "index, follow", pathOf(twin));
    expect(bakePostingPage(row, DESC, { D, SITE, carried: true }).ld, "the row alone passes every per-row rule").toBeTruthy();
    await rendered(row);
    await waitFor(() => expect(canonicals()).toEqual([`${SITE}${pathOf(twin)}`]), SLOW);
    expect(jobEntities()).toEqual([]);
  });

  it("a page retired at the ceiling (noindex): no JobPosting, and the noindex stands", async () => {
    bakeFile(pathOf(row), "noindex, follow", pathOf(row));
    await rendered(row);
    await waitFor(() => expect(canonicals()).toEqual([`${SITE}${pathOf(row)}`]), SLOW);
    expect(jobEntities()).toEqual([]);
    expect(robots()).toEqual(["noindex, follow"]);
  });

  it("positive control: the same row on a page the bake wrote as its own is marked up, under its own canonical", async () => {
    bakeFile(pathOf(row), "index, follow", pathOf(row));
    seedBakesOwnBlock(bakePostingPage(row, DESC, { D, SITE, carried: true }).ld);
    await rendered(row);
    await waitFor(() => expect(canonicals()).toEqual([`${SITE}${pathOf(row)}`]), SLOW);
    expect(jobEntities().length).toBe(1);
    expect(jobEntities()[0].url).toBe(`${SITE}${pathOf(row)}`);
  });
});

describe("a board that names no hirer for its postings: the page and the bake agree whatever the set holds", () => {
  // The two LCS career sites (PUBLISHER_ONLY_BOARDS on the trusted-pages
  // branch) list jobs at the communities LCS manages, and no requisition
  // states a legal employer. postingEmployer names nobody for such a board
  // once the set is read there, rule 1 then refuses the row, and so does
  // postingJsonLd, so the page reads the set through the shared module with
  // no code of its own.
  const onBoard = (token: string): PostingRow => good({ id: `oracle:${token}:41168`, token, source: "oracle", company: "Example Senior Living", location: "Kalamazoo, MI" });
  const verdicts = (row: PostingRow) => ({
    bake: bakePostingPage(row, DESC, { D, SITE, carried: true }).ld,
    app: postingJsonLd(row, DESC, { site: SITE }),
  });

  it("for every board the module's own set holds, and for one it does not", () => {
    // The mock above ran on the real module and found its set: without this,
    // a moved module leaves realPublisherOnly null and every line below
    // passes vacuously.
    expect(hoisted.realPublisherOnly, "the employer-names mock never ran: its path resolves to no module").toBeInstanceOf(Set);
    expect(hoisted.realPublisherOnly!.size, "the real publisher-only set is empty").toBeGreaterThan(0);
    const tokens = [...(hoisted.realPublisherOnly ?? []), "pubonly~us2~CX_9"];
    for (const token of tokens) {
      hoisted.publisherOnly.clear();
      const outside = verdicts(onBoard(token));
      expect(outside.app, `${token} outside the set`).toEqual(outside.bake);
      expect(outside.app, `${token} outside the set is marked up`).toBeTruthy();

      hoisted.publisherOnly.add(token);
      const inside = verdicts(onBoard(token));
      expect(inside.app, `${token} in the set: the page and the bake agree`).toEqual(inside.bake);
      // Once the set is wired into postingEmployer, neither side marks it up.
      const wired = postingEmployer(onBoard(token)) === "";
      if (wired) {
        expect(inside.bake, `${token} in the set`).toBeNull();
        expect(postingRowEligible(onBoard(token), D), `${token} in the set gets no page`).toBe(false);
      }
      // And wherever the module carries the set, it IS wired: the page reads it.
      if (hoisted.realPublisherOnly) expect(wired, `${token}: the set exists but postingEmployer does not read it`).toBe(true);
    }
  });

  it("rule 1 refuses a row whose board names no hirer, whatever names it", () => {
    const fakeD = { ...D, postingEmployer: () => "" };
    expect(postingRowEligible(good(), fakeD)).toBe(false);
    expect(postingRowEligible(good(), D)).toBe(true);
  });

  it("the rendered page, with the set holding the board and without it", async () => {
    const token = "pubonly~us2~CX_9";
    const row = onBoard(token);
    hoisted.publisherOnly.add(token);
    const view = await renderedMarkup(row);
    const expected = asWritten(bakePostingPage(row, DESC, { D, SITE, carried: true }).ld);
    await waitFor(() => expect(jobEntities()).toEqual(expected), SLOW);
    view.unmount();
    clearHead();
    hoisted.publisherOnly.clear();
    await renderedMarkup(row);
    await waitFor(() => expect(jobEntities()).toEqual(asWritten(bakePostingPage(row, DESC, { D, SITE, carried: true }).ld)), SLOW);
    expect(jobEntities().length, "positive control: outside the set the board's posting is marked up").toBe(1);
  });
});

describe("the bake decides every posting through bakePostingPage, with what its bundle exports", () => {
  const BAKE = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
  it("every function bakePostingPage and rule 1 read from D is exported by the bake's entry", () => {
    const start = BAKE.indexOf("writeFileSync(entry, entryImports(`");
    const entry = BAKE.slice(start, BAKE.indexOf("`));", start));
    expect(start).toBeGreaterThan(0);
    const exported = new Set(
      [...entry.matchAll(/export \{([^}]*)\} from/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!)),
    );
    const read = new Set([...`${bakePostingPage}\n${postingRowEligible}`.matchAll(/\bD\.(\w+)/g)].map((m) => m[1]));
    expect(read.size).toBeGreaterThan(5);
    for (const name of read) expect(exported.has(name), `the bake's bundle does not export ${name}`).toBe(true);
  });
  it("the posting loop takes each row's page, name and markup from bakePostingPage", () => {
    expect(BAKE).toMatch(/d\.page = bakePostingPage\(d\.job, d\.description, \{ D, SITE, carried: d\.carried \}\);/);
    expect(BAKE).toMatch(/const \{ path, rawJob, job, ld, nameRefused, nameOnly, mismatchOnly, live, nm \} = page;/);
    expect(BAKE).toMatch(/const postingName = \(job\) => D\.postingNameVerdict\(job\);/);
    expect(BAKE).toMatch(/const describedEnough = \(text\) => D\.postingDescribedEnough\(text\);/);
  });
});

describe("the board's detail pane writes no job markup the bake would not", () => {
  const DESC_PANE = "We are hiring a medical assistant for our Bridgewater practice, full time, on a team of physicians and nurses. ".repeat(4);
  const paneRow = (over: Record<string, unknown>) => ({
    id: "greenhouse:acme:7", source: "greenhouse", token: "acme", company: "Acme", title: "Medical Assistant", location: "Bridgewater, NJ", country: "US",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
    workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "healthcare", department: null, agency: false,
    postedAt: ago(2), lastSeen: ago(1), recheckedAt: ago(0), applyUrl: "https://acme.example/7", remote: false, missingSince: null,
    ...over,
  });
  let matchMedia: typeof window.matchMedia;
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    setLanderManifestForTests("*");
    matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: /min-width:\s*1024px/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { cleanup(); window.matchMedia = matchMedia; document.head.innerHTML = ""; window.history.replaceState({}, "", "/"); });

  const paneMarkup = async (opened: ReturnType<typeof paneRow>) => {
    const first = paneRow({ id: "greenhouse:acme:1", title: "Front Desk Coordinator" });
    const rows = [first, opened];
    invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
      const b = a?.body ?? {};
      if (fn !== "job-board") return { data: {} };
      if (b.action === "detail") return { data: { job: rows.find((j) => j.id === b.id) ?? first, description: DESC_PANE }, error: null };
      if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
      if (b.action === "list" && (b.countOnly || b.facetCounts)) return { data: { total: 2, categories: {} }, error: null };
      if (b.action === "list") return { data: { jobs: rows, total: 2, totalAllCompanies: 2, companies: [{ token: "acme", name: "Acme", open: 2 }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: ago(0), hasMore: false }, error: null };
      return { data: {} };
    });
    document.head.innerHTML = `<link rel="canonical" href="${SITE}/jobs">`;
    window.history.replaceState({}, "", "/jobs");
    render(<HelmetProvider><MemoryRouter initialEntries={["/jobs"]}><Routes><Route path="/jobs" element={<Jobs />} /></Routes></MemoryRouter></HelmetProvider>);
    // The reader opens the second card (an auto-selected one never takes over the head).
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("job")).toBe(first.id), SLOW);
    fireEvent.click((await screen.findAllByText(String(opened.title), undefined, SLOW))[0]);
    await waitFor(() => expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`${SITE}/jobs?job=${encodeURIComponent(String(opened.id))}`), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    return [...document.head.querySelectorAll('script[type="application/ld+json"]')].filter((s) => /"JobPosting"/.test(s.textContent ?? ""));
  };

  it("a name the gate refuses gets none, though the pane took over the head", async () => {
    const refused = paneRow({ id: "greenhouse:examplelogo:8", token: "examplelogo", company: "Example Logo Horizontal", title: "Medical Assistant II" });
    expect(postingJsonLd(refused as unknown as PostingRow, DESC_PANE, { site: SITE })).toBeNull();
    expect(await paneMarkup(refused)).toEqual([]);
  });

  /** The bake's markup for the row, at the pane's own address (its canonical while it is open). */
  const bakesAtPaneUrl = (opened: ReturnType<typeof paneRow>) => {
    const ld = postingJsonLd(opened as unknown as PostingRow, DESC_PANE, { site: SITE });
    return ld ? asWritten({ ...ld, url: `${SITE}/jobs?job=${encodeURIComponent(String(opened.id))}` }) : [];
  };
  const parsed = (tags: Element[]) => tags.map((s) => JSON.parse(s.textContent || "null"));

  it("positive control: a good posting the reader opens is marked up, with the bake's markup at the pane's address", async () => {
    const opened = paneRow({ id: "greenhouse:acme:9", title: "Medical Assistant III" });
    expect(postingJsonLd(opened as unknown as PostingRow, DESC_PANE, { site: SITE })).toBeTruthy();
    expect(parsed(await paneMarkup(opened))).toEqual(bakesAtPaneUrl(opened));
  });

  // The pane built its own block, naming the stored company as the hiring
  // organisation and in the identifier: a row the gate passes BECAUSE its
  // name is repaired, or overridden, was marked up under the stored label or
  // the tenant code (F1).
  it("a career-site label comes off the hiring organisation (Chubb External is Chubb)", async () => {
    const opened = paneRow({ id: "oracle:chubb~ocs~CX:991", source: "oracle", token: "chubb~ocs~CX", company: "Chubb External", title: "Underwriter", location: "Philadelphia, PA" });
    const [ld] = parsed(await paneMarkup(opened));
    expect(ld?.hiringOrganization).toEqual({ "@type": "Organization", name: "Chubb" });
    expect(ld?.identifier?.name).toBe("Chubb");
    expect([ld]).toEqual(bakesAtPaneUrl(opened));
  });

  it("a tenant code is never the hiring organisation (Ms is Morgan Stanley)", async () => {
    const opened = paneRow({ id: "workday:ms~wd5~External:JR7", source: "workday", token: "ms~wd5~External", company: "Ms", title: "Analyst", location: "New York, NY" });
    const [ld] = parsed(await paneMarkup(opened));
    expect(ld?.hiringOrganization).toEqual({ "@type": "Organization", name: "Morgan Stanley" });
    expect(ld?.identifier?.name).toBe("Morgan Stanley");
    expect([ld]).toEqual(bakesAtPaneUrl(opened));
  });

  it("a remote label with no vendor flag is not marked up as telework (SEO-003), as in the bake", async () => {
    const opened = paneRow({ id: "greenhouse:acme:11", title: "Medical Assistant IV", workMode: "remote", location: "Remote - US" });
    const tags = parsed(await paneMarkup(opened));
    expect(tags).toEqual(bakesAtPaneUrl(opened));
    for (const ld of tags) expect(ld.jobLocationType).toBeUndefined();
  });
});
