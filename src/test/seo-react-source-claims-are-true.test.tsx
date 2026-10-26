/**
 * WHAT A PAGE SAYS ABOUT WHERE A POSTING CAME FROM IS TRUE (R4, R5b, R6b).
 *
 *   - LiveMatches' four "{{n}}+ verified openings" defaults rendered in all nine
 *     languages, because no locale had those keys (owner: never "verified").
 *   - Every posting page said "never an aggregator, never a repost", and /jobs
 *     "no aggregators", while the board carries staffing agencies' boards, the
 *     federal listing site and a caution when an employer re-posts a role.
 *   - The posting page said "the board re-checks a posting when you open it"
 *     with no condition; the live board asks the employer's system again only
 *     for a posting whose feed read is older than VERIFY_ON_VIEW_AFTER_HOURS.
 *
 * Held three ways: the rendered posting page, every main-locale and shard
 * string, and the code of the pages that printed the phrases (comments out).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BANNED_SOURCE_CLAIMS, VERIFY_ON_VIEW_AFTER_HOURS } from "@/lib/seo/source-copy";
import { LOCALE_FILES, readLocale, readMainLocale, stringLeaves } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stub(),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stub() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import JobPosting from "@/pages/JobPosting";
afterEach(cleanup);

const banned = (s: string) => BANNED_SOURCE_CLAIMS.filter((re) => re.test(s)).map(String);

describe("the posting page's source note", () => {
  it("says the posting was read from the employer's system and states the re-check's condition", async () => {
    invoke.mockResolvedValue({
      data: {
        job: { id: "workday:acme~wd3~Careers:JR1", title: "Staff Nurse", company: "Acme Health", location: "Leeds", country: "GB", workMode: null, token: "acme~wd3~Careers", postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), missingSince: null, applyUrl: "https://acme.example/jobs/JR1", salary: null, agency: false },
        description: "We are hiring a staff nurse for our Leeds site. ".repeat(12),
      },
      error: null,
    });
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/jobs/posting/workday/acme~wd3~Careers/JR1"]}>
          <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    const note = await screen.findByText(/never copied from another job board/);
    expect(note.textContent).toContain(`more than ${VERIFY_ON_VIEW_AFTER_HOURS} hours ago`);
    expect(banned(document.body.textContent ?? "")).toEqual([]);
  });
});

describe("the strings", () => {
  // agentHero.* is rendered only by AgentHero, which nothing mounts (its one
  // importer, JobBoardHero, is itself unused); it is not a page's text.
  const DEAD = /^agentHero\./;

  it.each(LOCALE_FILES)("%s: no string a page renders makes a banned source claim", (file) => {
    const offences = stringLeaves(readLocale(file))
      .filter(([k]) => !DEAD.test(k))
      .filter(([, v]) => banned(v).length > 0)
      .map(([k, v]) => `${k}: ${v.slice(0, 90)}`);
    expect(offences).toEqual([]);
  });

  it.each(LOCALE_FILES)("%s: the posting note and the board subtitle make no aggregator claim in any language", (file) => {
    const m = readMainLocale(file) as { jobPostingPage: Record<string, string>; jobsPage: Record<string, string> };
    for (const v of [m.jobPostingPage.sourceNote, m.jobsPage.subtitle]) {
      expect(v).not.toMatch(/aggregat|agregador|agrégateur|एग्रीगेटर|\brepost\b|republicación nuestra/i);
    }
    expect(m.jobPostingPage.sourceNote).toContain("{{hours}}");
  });

  it.each(LOCALE_FILES)("%s carries LiveMatches' four board lines, none saying verified", (file) => {
    const fm = (readMainLocale(file).freeResults as { matches: Record<string, string> }).matches;
    for (const k of ["openBoardFallbackLive", "openBoardFallbackPlain", "openBoardNoteLive", "openBoardNotePlain"]) {
      expect(typeof fm[k], `${file} freeResults.matches.${k}`).toBe("string");
      expect(fm[k]).not.toMatch(/verif|vérifi|überprüft|geverifieerd|beripikado|सत्यापित/i);
    }
  });
});

describe("the code of the pages that printed the phrases", () => {
  const FILES = [
    "src/pages/JobPosting.tsx", "src/pages/GhostJobIndex.tsx", "src/pages/EntryLevelIndex.tsx", "src/pages/Jobs.tsx",
    "src/pages/DataApi.tsx", "src/pages/Companies.tsx", "src/components/LiveMatches.tsx", "src/components/JobBoardHero.tsx",
  ];
  it.each(FILES)("%s prints none of them, even as a default", (f) => {
    const code = codeOf(readFileSync(resolve(__dirname, "../..", f), "utf8"));
    expect(banned(code)).toEqual([]);
    expect(code).not.toMatch(/aggregators? or (?:a )?scrape/i);
  });
});
