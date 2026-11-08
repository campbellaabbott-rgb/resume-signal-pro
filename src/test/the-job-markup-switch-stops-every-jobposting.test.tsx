/**
 * THE OWNER'S STOP SWITCH TAKES EVERY JOBPOSTING OFF, AND NO PAGE (owner
 * decision 2026-11-07, option A; SEO/GEO audit 2026-11-07, B01).
 *
 * The owner kept JobPosting markup on the posting pages on condition of a
 * STOP rule; there was no switch to pull. src/config/seo-switches.ts holds
 * JOB_POSTING_MARKUP, and postingJsonLd (the one function every writer asks:
 * the bake, the React posting page, the board's detail pane) answers null
 * while it is false. The bake decides whether a row keeps its page on the
 * markup the row WOULD carry (postingJsonLdShape), so turning the switch off
 * keeps every page, its title and its index, and records why it carries none
 * ("switch") in the posting ledger. This file runs with the switch mocked off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../config/seo-switches", () => ({ JOB_POSTING_MARKUP: false }));

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
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import { POSTING_LD_TAG_ID, postingJsonLd, postingJsonLdShape, postingPagePath, type PostingRow } from "@/components/jobs/posting-page";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { bakePostingPage, postingMarkupWithheld } from "../../scripts/prerender-seo.mjs";

vi.setConfig(MOUNT_TEST_BUDGET);

const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const DESC = "We are hiring a medical assistant for our Bridgewater practice, working beside a team of physicians and nurses every day. ".repeat(5);
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

const jobEntities = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
    .filter((d) => d && d["@type"] === "JobPosting");
const clearHead = () => document.head.querySelectorAll('meta[name="robots"], script[type="application/ld+json"], link[rel="canonical"]').forEach((n) => n.remove());
beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); clearHead(); });
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); clearHead(); });

describe("with JOB_POSTING_MARKUP off, no writer writes a JobPosting", () => {
  it("postingJsonLd answers null for a row whose markup would otherwise be complete", () => {
    expect(postingJsonLdShape(good(), DESC, { site: SITE })).toMatchObject({ "@type": "JobPosting", title: "Medical Assistant" });
    expect(postingJsonLd(good(), DESC, { site: SITE })).toBeNull();
  });

  it("the bake keeps the page, carried or new, with no markup, and records the switch as the reason", () => {
    for (const carried of [true, false]) {
      const page = bakePostingPage(good(), DESC, { D, SITE, carried });
      expect(page).toMatchObject({ live: true, ld: null, switchedOff: true });
      expect(postingMarkupWithheld(page)).toBe("switch");
    }
  });

  it("a page D7 keeps without markup keeps its own reason, and a row with no page still gets none", () => {
    const lagos = bakePostingPage(good({ location: "Lagos, LA, Nigeria" }), DESC, { D, SITE, carried: true });
    expect(lagos).toMatchObject({ live: true, ld: null, switchedOff: false, mismatchOnly: true });
    expect(postingMarkupWithheld(lagos)).toBe("country");
    expect(bakePostingPage(good({ agency: true }), DESC, { D, SITE, carried: true })).toMatchObject({ live: false, ld: null });
    expect(bakePostingPage(good({ location: "Lagos, LA, Nigeria" }), DESC, { D, SITE, carried: false }).live).toBe(false);
  });

  it("the React posting page takes an older bake's JobPosting out and writes none", async () => {
    const row = good();
    invoke.mockImplementation(async (fn: string, a: { body?: { action?: string } } | undefined) =>
      fn === "job-board" && a?.body?.action === "detail" ? { data: { job: row, description: DESC }, error: null } : { data: [], error: null },
    );
    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.id = POSTING_LD_TAG_ID;
    s.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: row.title });
    document.head.appendChild(s);
    render(
      <MemoryRouter initialEntries={[postingPagePath(row.id)!]}>
        <Routes>
          <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { level: 1, name: row.title! }, SLOW);
    await waitFor(() => expect(jobEntities()).toEqual([]), SLOW);
  });
});

describe("the switch as committed is one line the verifier and the owner can read", () => {
  const file = readFileSync(resolve(__dirname, "../config/seo-switches.ts"), "utf8");

  it("holds exactly one JOB_POSTING_MARKUP declaration, true or false, as section 98-r2 reads it", () => {
    expect(file.match(/^export const JOB_POSTING_MARKUP = (true|false);$/gm)).toHaveLength(1);
    const section = readFileSync(resolve(__dirname, "../../scripts/verify-deploy.d/98-seo-r2.sh"), "utf8");
    expect(section).toContain("src/config/seo-switches.ts");
  });

  it("is read by postingJsonLd, the one function every writer of job markup asks", () => {
    const src = readFileSync(resolve(__dirname, "../components/jobs/posting-page.ts"), "utf8");
    expect(src).toMatch(/import \{ JOB_POSTING_MARKUP \} from "\.\.\/\.\.\/config\/seo-switches";/);
    expect(src).toMatch(/export function postingJsonLd\([\s\S]*?\): Record<string, unknown> \| null \{\s*if \(!JOB_POSTING_MARKUP\) return null;\s*return postingJsonLdShape\(row, description, opts\);\s*\}/);
  });
});
