// A CAP OF OURS IS NOT A CLOSURE OF THEIRS.
//
// The detail action distinguishes three dead ends and answers each differently:
// a watched closure (`closed`), a posting past this board's own 30-day
// freshness cap (`agedOut`, carrying title, company, postedAt and capDays), and
// nothing at all. The client destructured `job` and `closed`, ignored `agedOut`
// entirely, and fell through to:
//
//     setDeadLink({ title: null, company: null });
//
// which renders "The posting in that link is no longer live — it was filled or
// taken down."
//
// Two things wrong with that, and the second is the serious one:
//   * It throws away four fields the server already computed and sent, so a
//     deep link from Google or a two-month-old bookmark gets a shrug instead of
//     the role, the employer, and the date.
//   * "It was filled or taken down" is a claim about the EMPLOYER, and for an
//     aged-out posting we have no evidence for it. The posting may be sitting
//     on their careers page right now. The rule that hid it is OURS. Saying
//     otherwise is the fence this project trades on, pointed the wrong way.
//
// Every number in the new banner names its basis: the cap comes from the
// server's own capDays rather than a client constant that could drift from it,
// and the age is the COMPANY'S stated date — absent, with the window's real
// basis named instead, when the company stated none.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [] }),
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

const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;

// The board holds one live row; the deep link points at a DIFFERENT id, which
// is what sends the resolver to the detail action.
const LIVE = [{
  id: "live-1", company: "Beta", title: "A Live Role", location: "Remote", salary: null,
  applyUrl: "https://x/1", source: "greenhouse", token: "beta", postedAt: null,
}];
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function mount(detail: Record<string, unknown>, id = "gone-1") {
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [], fits: {}, missing: {}, matched: {} } };
    if (fn === "job-board" && b.action === "detail") return { data: detail };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: LIVE.length } };
      return {
        data: {
          jobs: LIVE, total: LIVE.length, totalAllCompanies: LIVE.length, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  window.history.replaceState({}, "", `/jobs?job=${id}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const AGED = {
  job: null,
  agedOut: { title: "Senior Platform Engineer", company: "Acme Corp", postedAt: daysAgoIso(47), capDays: 30 },
};
const body = () => document.body.textContent ?? "";

describe("a cap of ours is not a closure of theirs", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset();
  });

  it("behaviour: the aged-out payload is rendered — role, employer, date and cap", async () => {
    mount(AGED);
    await waitFor(() => expect(body()).toContain("Senior Platform Engineer"), SLOW);
    const text = body();
    expect(text).toContain("Acme Corp");
    expect(text, "the company-stated age").toContain("47 days ago");
    expect(text, "the cap, from the server's own capDays").toContain("30 days");
    expect(text).toContain("aged out of this board's freshness window");
  });

  it("behaviour: it makes NO claim that the employer filled or withdrew it", async () => {
    // The whole point. We know our own rule fired; we know nothing about theirs.
    mount(AGED);
    await waitFor(() => expect(body()).toContain("Senior Platform Engineer"), SLOW);
    expect(body(), "an aged-out posting is not evidence of a closure")
      .not.toContain("it was filled or taken down");
    expect(body()).toContain("Aging out is our rule, not the employer's");
  });

  it("behaviour: an undated aged-out posting names the window's real basis instead of inventing an age", async () => {
    mount({ job: null, agedOut: { title: "Undated Role", company: "Acme Corp", postedAt: null, capDays: 30 } });
    await waitFor(() => expect(body()).toContain("Undated Role"), SLOW);
    expect(body()).toContain("our discovery date, not theirs");
    expect(body(), "an age was printed for a posting the employer never dated")
      .not.toMatch(/dated it \d+ days ago/);
  });

  it("behaviour: a server that sends no capDays states no cap, rather than guessing one", async () => {
    mount({ job: null, agedOut: { title: "Capless Role", company: "Acme Corp", postedAt: daysAgoIso(47) } });
    await waitFor(() => expect(body()).toContain("Capless Role"), SLOW);
    expect(body()).toContain("47 days ago");
    expect(body(), "a cap was invented client-side").not.toMatch(/We only carry postings for/);
  });

  it("behaviour: a watched closure still reads as a closure — the two answers stay different", async () => {
    mount({ job: null, closed: { title: "Closed Role", company: "Gamma", closedAt: daysAgoIso(2) } });
    await waitFor(() => expect(body()).toContain("Closed Role"), SLOW);
    expect(body()).toContain("it was filled or taken down");
    expect(body()).not.toContain("aged out of this board's freshness window");
  });

  it("behaviour: an unresolvable link is still answered, and still not called aged out", async () => {
    mount({ job: null });
    await waitFor(() => expect(body()).toContain("The posting in that link is no longer live"), SLOW);
    expect(body()).not.toContain("aged out of this board's freshness window");
  });

  it("behaviour: a live deep link renders the posting, not a banner", async () => {
    mount({ job: LIVE[0], description: "Still hiring." }, "live-1");
    await waitFor(() => expect(body()).toContain("Still hiring."), SLOW);
    expect(body()).not.toContain("no longer listed here");
    expect(body()).not.toContain("The posting in that link is no longer live");
  });

  it("the client reads the field the server has been sending all along", () => {
    expect(JOBS).toMatch(/agedOut\?: \{ title: string \| null; company: string \| null; postedAt: string \| null; capDays: number \}/);
    expect(JOBS).toMatch(/\} else if \(res\?\.agedOut\) \{/);
    // Every dead-link write carries a kind, so the branch can never be reached
    // with an unlabelled object — counted rather than named.
    const writes = [...JOBS.matchAll(/setDeadLink\(\{/g)];
    expect(writes.length).toBeGreaterThan(2);
    for (const m of writes) {
      expect(JOBS.slice(m.index, (m.index ?? 0) + 60), "a dead link written without a kind").toMatch(/kind: "(closed|agedOut)"/);
    }
    // Closure rows and aged-out rows are feed text and get the same display
    // hygiene every live row gets.
    expect(JOBS).toMatch(/res\.agedOut\.title \? cleanJobTitle\(res\.agedOut\.title\) : null/);
    expect(JOBS).toMatch(/res\.agedOut\.company \? decodeNameEntities\(res\.agedOut\.company\) : null/);
  });

  it("the payload the client now reads is the one the server actually emits", () => {
    // A client-side shape guess is how this field went unread for a month.
    const at = FN.indexOf("agedOut: {");
    expect(at).toBeGreaterThan(-1);
    const block = FN.slice(at, at + 320);
    for (const k of ["title:", "company:", "postedAt:", "capDays: FRESH_WINDOW_DAYS"]) {
      expect(block, `the server no longer sends ${k}`).toContain(k);
    }
  });

  it("the reason the two dead ends say different things stays written down", () => {
    // PROSE, so RAW source.
    expect(RAW).toMatch(/PAST OUR CAP IS NOT "FILLED OR TAKEN DOWN"/);
    expect(RAW).toMatch(/is a claim we have no evidence for/);
  });

  it("every new string is translated in all nine locales, with its placeholders intact", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const en = JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8")) as { jobsPage: Record<string, string> };
    const keys = ["agedLinkKnown", "agedLinkUnknown", "agedLinkPosted", "agedLinkUndated", "agedLinkCap", "agedLinkStillOpen"];
    for (const f of files) {
      const jp = (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, string> }).jobsPage ?? {};
      for (const k of keys) {
        expect(typeof jp[k], `${f}: jobsPage.${k}`).toBe("string");
        if (f !== "en.json" && f !== "en-GB.json") {
          expect(jp[k], `${f}: jobsPage.${k} is still the English text`).not.toBe(en.jobsPage[k]);
        }
        for (const ph of en.jobsPage[k].match(/\{\{\w+\}\}/g) ?? []) {
          expect(jp[k], `${f}: jobsPage.${k} lost ${ph}`).toContain(ph);
        }
      }
      // The old closure copy is untouched: it is still the right words for a
      // closure, and only the wrong words for an expiry.
      expect(typeof jp.deadLinkKnown, `${f}: the closure wording must survive`).toBe("string");
    }
  });
});
