// A PHARMACIST'S REPORT LISTED REGISTERED NURSE OPENINGS AS "MATCHING THIS RESUME".
//
// The free scan report is the highest-traffic conversion surface on the site,
// and the last thing on it is a card headed "Live openings matching this
// resume", subtitled with a promise that they are ranked by the same
// deterministic fit score as the report's own numbers. Both halves were true
// of the RANKING and neither was true of the RETRIEVAL: the query was
// `rolesForIndustry(industry)[0]?.title` — the first canonical title of a
// broad industry bucket. Healthcare's first title is not "pharmacist". So a
// pharmacist got five nursing jobs, honestly scored as poor matches, under a
// heading claiming they were hers. The reader's first impression of the
// product was a list of jobs that are not theirs.
//
// The rest of the board had already solved this (ranking-is-not-finding,
// a-founders-resume-searched-for-go-to-market, the-third-door-into-fit-
// ranking-never-retrieved-either): job-fit's `fit-terms` reads the occupation
// out of the résumé and every surface that switches fit ranking on retrieves
// first. This card was the surface nobody counted.
//
// WHAT THIS FILE PINS, and the second half is the one that keeps the fix
// honest when it cannot work:
//   (1) the résumé is asked FIRST and its occupation is what the board is
//       searched for — the industry title is reachable only as a fallback;
//   (2) when the rows ARE industry-derived — no occupation resolved, or
//       fit-terms itself failed — the copy stops claiming they match this
//       résumé and says what they actually are.
// Behavioural, with the functions mocked, because a source-text pin on this
// path has shipped broken before; the derived assertions read the industry
// title out of the same table the component uses rather than naming it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { LiveMatches } from "../components/LiveMatches";
import { rolesForIndustry } from "../data/roles";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const LIVE = strip(readFileSync(resolve(ROOT, "src/components/LiveMatches.tsx"), "utf8"));
const LOCALES = resolve(ROOT, "src/i18n/locales");
const EN = JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")) as {
  freeResults: { matches: Record<string, string> };
};

// The bucket the reported case sat in, and the title it wrongly retrieved. Read
// from the table the component reads, so renaming or reordering the industry's
// role pages cannot leave this test asserting a title nobody would ever get.
const INDUSTRY = "healthcare";
const INDUSTRY_TITLE = rolesForIndustry(INDUSTRY)[0]?.title ?? "";

// Long enough to clear job-fit's 100-character floor; the occupation itself is
// decided by the mocked fit-terms answer, not by these words.
const PHARMACIST = "Priya Shah, PharmD — Pharmacist. ".repeat(8);

type Call = { fn: string; body: Record<string, unknown> };
const calls = (): Call[] => invoke.mock.calls.map((c) => ({ fn: c[0] as string, body: (c[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {} }));
const listCalls = () => calls().filter((c) => c.fn === "job-board" && c.body.action === "list");

const JOBS = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`, company: `Pharmacy ${i + 1}`, title: `Pharmacist ${i + 1}`, location: "Remote", salary: null, applyUrl: `https://x/${i + 1}`,
}));

/**
 * @param terms what fit-terms answers with; `null` makes the call fail in
 *              transport, the way a 546 does.
 */
function mockBoard(terms: string[] | null, jobs = JOBS) {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const action = opts?.body?.action;
    if (fn === "job-fit" && action === "fit-terms") {
      return terms === null ? { data: null, error: { message: "546 WORKER_RESOURCE_LIMIT" } } : { data: { terms } };
    }
    if (fn === "job-board" && action === "list") return { data: { jobs, total: 4_242 } };
    if (fn === "job-board" && action === "verify") return { data: { live: {} } };
    if (fn === "job-fit" && action === "fit-batch") {
      const ids = opts!.body!.ids as string[];
      return { data: { fits: Object.fromEntries(ids.map((id, i) => [id, 30 - i])) } };
    }
    throw new Error(`unexpected invoke ${fn} ${String(action)}`);
  });
}
const mount = (resumeText = PHARMACIST) =>
  render(<MemoryRouter><LiveMatches resumeText={resumeText} industry={INDUSTRY} /></MemoryRouter>);

describe("a pharmacist's report listed nursing jobs", () => {
  beforeEach(() => { invoke.mockReset(); });

  it("the industry bucket really does start with somebody else's occupation — the premise", () => {
    // If this ever goes red the reported symptom has changed shape, and the
    // assertions below that say "not the industry title" mean less than they
    // read. Healthcare's first canonical title is not a pharmacist's.
    expect(INDUSTRY_TITLE, "healthcare must carry role pages at all").not.toBe("");
    expect(INDUSTRY_TITLE.toLowerCase()).not.toContain("pharmacist");
  });

  it("THE BUG: the board is searched for the résumé's occupation, not the industry's first title", async () => {
    mockBoard(["pharmacist", "pharmacy technician"]);
    mount();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
    // Retrieval precedes ranking: the very first thing the card does is ask the
    // résumé what it does for a living.
    expect(calls()[0].fn).toBe("job-fit");
    expect(calls()[0].body.action).toBe("fit-terms");
    expect(calls()[0].body.resumeText).toBe(PHARMACIST);
    // COUNTED, NOT NAMED. Every list call the card made must carry the
    // résumé's own term — the industry title may not reach the query at all
    // when an occupation resolved.
    expect(listCalls().length).toBeGreaterThan(0);
    for (const c of listCalls()) {
      expect(c.body.q, "the query is the résumé's occupation").toBe("pharmacist");
      expect(c.body.q, "the industry's first title is a FALLBACK, not the query").not.toBe(INDUSTRY_TITLE);
    }
  });

  it("and only then may the card say the openings match this résumé", async () => {
    mockBoard(["pharmacist"]);
    mount();
    await screen.findByText(/Live openings matching this resume/i);
    // The reader is shown the query, so they can see it and disagree with it.
    expect(screen.getByText(/Searched live company job boards for pharmacist/i)).toBeInTheDocument();
    expect(screen.queryByText(/Live openings in your field/i)).toBeNull();
  });

  it("the résumé claim is made IF AND ONLY IF the résumé's own term is what the board was searched for", async () => {
    // DERIVED, NOT NAMED, and it is the assertion that survives a refactor.
    // Writing the claim as "did an occupation resolve?" instead of "is the
    // query that occupation?" leaves the heading free to say "matching this
    // resume" over rows retrieved for something else — the exact sentence this
    // whole file exists to stop. Both branches are run and the expectation is
    // computed from the calls that were actually made.
    for (const terms of [["pharmacist"], []]) {
      invoke.mockReset();
      mockBoard(terms);
      const view = mount();
      await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
      const q = listCalls().map((c) => c.body.q);
      const searchedForResume = terms.length > 0 && q.length > 0 && q.every((x) => x === terms[0]);
      const claimsTheResume = screen.queryByText(/Live openings matching this resume/i) !== null;
      expect(claimsTheResume, `searched ${JSON.stringify(q)} for terms ${JSON.stringify(terms)}`).toBe(searchedForResume);
      // And the alternative heading is shown in exactly the other case — the
      // card is never left claiming nothing at all once it has rows.
      expect(screen.queryByText(/Live openings in your field/i) !== null).toBe(!searchedForResume);
      view.unmount();
    }
  });

  it("a résumé that names no occupation falls back to the industry title — and the copy stops claiming a match", async () => {
    // The recorded refusals live server-side (a founder's \"go-to-market\" is a
    // strategy phrase, \"veteran\" is a status): fit-terms answers with an empty
    // list rather than guessing, and the client must treat that as \"not this
    // résumé's jobs\" rather than as a licence to search something else and
    // keep the claim.
    mockBoard([]);
    mount();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
    for (const c of listCalls()) expect(c.body.q).toBe(INDUSTRY_TITLE);
    expect(screen.getByText(/Live openings in your field/i)).toBeInTheDocument();
    expect(screen.queryByText(/matching this resume/i), "industry rows may not be claimed as this résumé's").toBeNull();
    // And it says what they actually are, in the same breath.
    expect(screen.getByText(/scored against your resume, not found by it/i)).toBeInTheDocument();
  });

  it("a fit-terms failure is the same honest state — never a silent industry list under the résumé claim", async () => {
    mockBoard(null);
    mount();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
    for (const c of listCalls()) expect(c.body.q).toBe(INDUSTRY_TITLE);
    expect(screen.getByText(/Live openings in your field/i)).toBeInTheDocument();
    expect(screen.queryByText(/matching this resume/i)).toBeNull();
  });

  it("a résumé too short for the scorer is not sent to it, and is not claimed as a match either", async () => {
    // job-fit refuses under 100 characters, so calling is a round trip that can
    // only 400. The card must reach the same honest fallback WITHOUT the call.
    mockBoard(["pharmacist"]);
    mount("too short");
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
    expect(calls().some((c) => c.body.action === "fit-terms"), "no doomed round trip").toBe(false);
    expect(screen.getByText(/Live openings in your field/i)).toBeInTheDocument();
    expect(screen.queryByText(/matching this resume/i)).toBeNull();
  });

  it("nothing is claimed while the retrieval is still running", async () => {
    // The heading is a claim about where the rows came from, so it cannot be
    // made before that is known — and a row may never appear under a heading
    // describing a retrieval that did not produce it.
    let release!: (v: unknown) => void;
    const held = new Promise((r) => { release = r; });
    mockBoard(["pharmacist"]);
    const inner = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
      if (opts?.body?.action === "fit-terms") { await held; }
      return inner(fn, opts);
    });
    mount();
    await screen.findByText(/Finding live openings for this resume/i);
    expect(screen.queryByText(/Live openings matching this resume/i)).toBeNull();
    expect(screen.queryByText(/Live openings in your field/i)).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    release(null);
    await screen.findByText(/Live openings matching this resume/i);
  });

  it("a widening to the category is a demotion, and it is declared", async () => {
    // The category set is ANOTHER occupation's jobs: taking it means the rows
    // are no longer this résumé's. Off a résumé query it only happens when that
    // query found nothing at all — three of the reader's own rows beat five of
    // somebody else's, which is this card's entire defect.
    mockBoard(["pharmacist"], []);
    mount();
    await waitFor(() => expect(listCalls().length).toBe(2));
    expect(listCalls()[0].body.q).toBe("pharmacist");
    expect(listCalls()[1].body.q, "the widening drops the query for the category").toBeUndefined();
    expect(listCalls()[1].body.category).toBeTruthy();
    expect(screen.queryByText(/matching this resume/i)).toBeNull();
  });

  it("a résumé query that found SOMETHING is never replaced by the industry's jobs", async () => {
    // The old rule widened at "fewer than the five we show", which for a thin
    // occupation swapped three real matches for thirty of the bucket's.
    mockBoard(["pharmacist"], JOBS.slice(0, 3));
    mount();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(3));
    expect(listCalls().length, "no second, wider list call").toBe(1);
    expect(screen.getByText(/Live openings matching this resume/i)).toBeInTheDocument();
  });

  it("a posting with no stored description is shown unscored, never dressed as scored", async () => {
    // PRESERVED, NOT INTRODUCED. `null` is the scorer saying it looked and the
    // posting has no description to score — an honest null, kept and sorted
    // last, and it carries no fit badge. (A row no scorer call ANSWERED for is
    // the different case, counted and reported: a-546-rendered-as-a-fit-ranked-list.)
    invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
      const action = opts?.body?.action;
      if (fn === "job-fit" && action === "fit-terms") return { data: { terms: ["pharmacist"] } };
      if (fn === "job-board" && action === "list") return { data: { jobs: JOBS.slice(0, 2), total: 9 } };
      if (fn === "job-board" && action === "verify") return { data: { live: {} } };
      if (fn === "job-fit" && action === "fit-batch") return { data: { fits: { p1: null, p2: 17 } } };
      throw new Error(`unexpected invoke ${fn} ${String(action)}`);
    });
    mount();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(2));
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent, "the scored row ranks first").toContain("Pharmacy 2");
    expect(items[0].textContent).toContain("fit 17%");
    expect(items[1].textContent).toContain("Pharmacy 1");
    expect(items[1].textContent, "an unscored row states no fit").not.toMatch(/fit \d+%/);
  });

  it("the retrieval is not a source-text trick: fit-terms is a real job-fit call in live code", () => {
    // Comment-stripped, because a guard's literal written in a COMMENT has
    // passed while the code was dead six times in this repo.
    expect(LIVE).toMatch(/action:\s*"fit-terms",\s*resumeText/);
    const i = LIVE.indexOf('action: "fit-terms"');
    expect(LIVE.slice(Math.max(0, i - 200), i), "fit-terms must go to the scorer's own isolate").toMatch(/invoke\("job-fit"/);
    // And the industry title is downstream of it, never the other way round.
    expect(LIVE.indexOf("resumeRoleQuery(resumeText)")).toBeLessThan(LIVE.indexOf("rolesForIndustry(industry)"));
  });

  it("every new string is in all nine locales, and the inline English fallback says the same thing", () => {
    const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const KEYS = ["title", "titleSearching", "titleIndustry", "subtitle", "subtitleSearched", "subtitleIndustry"] as const;
    for (const f of files) {
      const m = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")) as { freeResults?: { matches?: Record<string, string> } })
        .freeResults?.matches ?? {};
      for (const k of KEYS) {
        expect(typeof m[k], `${f}: freeResults.matches.${k}`).toBe("string");
        expect(m[k].trim().length, `${f}: freeResults.matches.${k} is empty`).toBeGreaterThan(0);
      }
      // The role is interpolated, never concatenated: word order differs by
      // language and a fixed position reads as machine translation.
      expect(m.subtitleSearched, `${f}: subtitleSearched drops the {{role}} placeholder`).toContain("{{role}}");
      // A locale value overrides the inline default, so an untranslated copy of
      // the old claim would render the lie this fix removed.
      expect(m.titleIndustry, `${f}: the industry heading must not claim a résumé match`).not.toBe(m.title);
    }
    // The inline fallback renders whenever i18n has not loaded — for exactly
    // the readers on the slowest connections — so a stale one is a stale claim.
    for (const k of ["titleSearching", "titleIndustry", "subtitleSearched", "subtitleIndustry"] as const) {
      const inline = new RegExp(`t\\("freeResults\\.matches\\.${k}",\\s*"([^"]+)"`).exec(LIVE)?.[1];
      expect(inline, `inline fallback for ${k} not found`).toBeTruthy();
      expect(inline, `inline fallback for ${k} has drifted from en.json`).toBe(EN.freeResults.matches[k]);
    }
  });
});
