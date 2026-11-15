// @vitest-environment node
/**
 * A POSTING ITS EMPLOYER CLOSED SAYS SO AT EVERY LATER BAKE (SEO/GEO audit
 * 2026-11-07, B01; the fix round of 2026-11-08).
 *
 * The bake that finds a posting closed at the employer writes its noindex
 * page with basis "employer" and records that basis in the ledger. The next
 * bake keeps the page without a board read (postingCarryBase's stubs) and
 * rewrote it from the ledger entry with no basis at all: from the second bake
 * on, the page said the posting was gone from "this board, not ... the
 * employer", which is the opposite of what the employer's own system had
 * answered, and the ledger entry lost the basis section 98-r2 G3 selects on,
 * so G3 printed INFO and could no longer fail.
 *
 * The bake runs each kept entry through keptPostingStub, postingStubEntry and
 * postingStubPageBasis; this runs the same three over three bakes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { employerClosedStub } from "../../scripts/prerender-seo.mjs";
import { keptPostingStub, postingCarryBase, postingStubEntry, postingStubPage, postingStubPageBasis } from "../../scripts/prerender-pages.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import { codeOf } from "./helpers/strip-comments";

const D = { ...companyDisplay, ...postingPage };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ROW = {
  id: "workday:sanford~wd5~SanfordHealth:R-0278723",
  applyUrl: "https://sanford.wd5.myworkdayjobs.com/en-US/SanfordHealth/job/SD-Watertown/Nurse_R-0278723",
  title: "Nurse",
  company: "Sanford Health",
  token: "sanford~wd5~SanfordHealth",
};
const tokenOf = () => ROW.token;
const EMPLOYER_WORDS = /the employer's own hiring system answered that it no longer serves this posting/;
const BOARD_WORDS = /That is a statement about this board, not about the employer/;

type Entry = Record<string, unknown>;
type Stub = { id: string; path: string; state: string; seed?: boolean; basis?: string; title?: string | null; company?: string | null; duplicateOf?: string | null };

/** One bake's writeStub: the ledger entry over the prior one, and the page written from both. */
function writeStub(s: Stub, prior: Entry, today: string) {
  const e = postingStubEntry({ stub: s, prior, today, employerName: D.employerName, tokenOf });
  const page = postingStubPage({
    path: s.path, id: s.id, state: s.state, since: s.state === "gone" ? (e.since as string) : null,
    title: e.title as string, company: e.company as string, windowDays: 30, duplicateOf: s.duplicateOf ?? null,
    basis: postingStubPageBasis(s, e), esc, companyLink: "",
  });
  return { e, page };
}

/** A later bake: every entry the carry keeps is rewritten from the ledger alone. */
function laterBake(ledger: Record<string, Entry>, today: string) {
  const base = postingCarryBase({ ledger: { postings: ledger }, sitemaps: [], idFromPath: D.postingIdFromPath, today });
  const out: Record<string, { e: Entry; page: ReturnType<typeof postingStubPage> }> = {};
  for (const [path, e] of base.stubs) out[path] = writeStub(keptPostingStub(path, e, D.postingIdFromPath), ledger[path], today);
  return out;
}

describe("a posting closed at the employer keeps its employer wording and its ledger basis", () => {
  const first = employerClosedStub(ROW, D) as Stub;
  const path = first.path;
  const bake1 = writeStub(first, { state: "live", since: "2026-11-01", first: "2026-10-17" }, "2026-11-08");

  it("the first bake writes the employer's answer and records basis employer", () => {
    expect(bake1.e).toMatchObject({ state: "gone", basis: "employer", since: "2026-11-08" });
    expect(bake1.page.content).toMatch(EMPLOYER_WORDS);
  });

  it("the second and the third bake keep the employer's answer, the basis and the first date", () => {
    const bake2 = laterBake({ [path]: bake1.e }, "2026-11-09")[path];
    expect(bake2, "the carry kept no page for the closed posting").toBeTruthy();
    expect(bake2.e).toMatchObject({ state: "gone", basis: "employer", since: "2026-11-08", first: "2026-10-17" });
    expect(bake2.page.content).toMatch(EMPLOYER_WORDS);
    expect(bake2.page.content).not.toMatch(BOARD_WORDS);
    expect(bake2.page.description).toMatch(/no longer listed by its employer/);
    const bake3 = laterBake({ [path]: bake2.e }, "2026-11-10")[path];
    expect(bake3.e).toMatchObject({ state: "gone", basis: "employer", since: "2026-11-08" });
    expect(bake3.page.content).toMatch(EMPLOYER_WORDS);
  });

  it("a page the board took down keeps the board's wording, and a seeded page stays a seeded one", () => {
    const boardGone = laterBake({ [path]: { state: "gone", since: "2026-11-08", first: "2026-10-17", title: "Nurse", company: "Sanford Health" } }, "2026-11-09")[path];
    expect(boardGone.e.basis).toBeUndefined();
    expect(boardGone.page.content).toMatch(BOARD_WORDS);
    const seeded = laterBake({ [path]: { state: "seeded", seed: true, since: "2026-11-08", first: "2026-11-08", title: null, company: null } }, "2026-11-09")[path];
    expect(seeded.page.content).toMatch(/whether it is still open was not checked/);
  });

  it("a retired page's reason is never carried over from an earlier bake's", () => {
    const e = postingStubEntry({ stub: { id: ROW.id, path, state: "retired" }, prior: { state: "retired", basis: "ceiling", since: "2026-11-01" }, today: "2026-11-09", employerName: D.employerName, tokenOf });
    expect(e.basis).toBeUndefined();
  });
});

describe("the bake rewrites its kept pages through the same functions", () => {
  const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
  it("writeKeptPostingPages builds each kept stub with keptPostingStub", () => {
    const at = bake.indexOf("const writeKeptPostingPages = ");
    expect(at).toBeGreaterThan(-1);
    expect(bake.slice(at, at + 700)).toMatch(/writeStub\(keptPostingStub\(path, e, D\.postingIdFromPath\)\)/);
  });
  it("writeStub asks postingStubPageBasis for the page's basis", () => {
    const at = bake.indexOf("const writeStub = ");
    expect(at).toBeGreaterThan(-1);
    expect(bake.slice(at, at + 2000)).toMatch(/basis: postingStubPageBasis\(s, e\)/);
  });
});
