/**
 * THE FULL ANALYSIS PAGE SPEAKS THE BUYER'S LANGUAGE (S14X-178; bug round
 * 2026-11-12).
 *
 * WHAT WAS WRONG. The success page a buyer lands on after paying printed its
 * cards in English whatever the site's language: "Email Sent", "Clear Browser
 * Data", "Delete Server Data", the whole delete confirmation, "Scroll to view
 * results", and "Analyze Your Resume" when no analysis was open. It also set
 * no head of its own, so the tab kept whatever title the page before it left,
 * and nothing told a crawler that this page is one buyer's.
 *
 * NOW every one of them is a key: paidAnalysis.page.* in the nine paid
 * shards, and the cancel and deleting labels the page's other dialogs already
 * use (success.actions). The page sets its own translated title and asks not
 * to be indexed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const { invoke, rpc, toastFn } = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  toastFn: () => undefined,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastFn }), toast: toastFn }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "upsert", "in", "gte", "lte"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Success from "../pages/Success";
import i18n from "@/i18n";
import { clearAllResumeData, setResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const shard = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/paid", `${l}.json`), "utf8"));
const main = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8"));

/** Every English sentence the page printed as a literal. */
const LITERALS = [
  "Email Sent", "A copy was sent to your email", "Check your inbox",
  "Clear Browser Data", "Remove local session data", "Clear Data",
  "Delete Server Data", "Delete analysis from servers", "Delete Data",
  "Delete your analysis data?", "Yes, delete my data", "This action cannot be undone. Your resume analysis will be permanently deleted",
  "Scroll to view results", "Analyze Your Resume",
];

const SHARE = "0123456789abcdef01234567";
const ANALYSIS = {
  industry: "Software",
  experienceLevel: "senior",
  atsScore: { score: 74, breakdown: { keywordMatch: 70, formatting: 75, structure: 76, relevance: 73 }, improvements: [] },
  optimizedBullets: [{ original: "did things", improved: "Shipped things", explanation: "verb" }],
  actionVerbs: ["Shipped"],
  keywords: { found: ["TypeScript"], missing: ["Kubernetes"] },
  redFlags: [],
};

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  // A purchase an earlier test opened stays stashed in this tab otherwise.
  sessionStorage.clear();
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_analysis_by_share_id") return { data: [{ share_id: SHARE, analysis_result: ANALYSIS }], error: null };
    if (name === "get_temp_resume") return { data: [{ resume_text: "Senior engineer. ".repeat(40), linkedin_text: null, job_description_text: null }], error: null };
    return { data: null, error: null };
  });
  i18n.addResourceBundle("de", "translation", main("de"), true, true);
  i18n.addResourceBundle("de", "translation", shard("de"), true, true);
  await i18n.changeLanguage("de");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const mount = (search: string) => render(
  <MemoryRouter initialEntries={[`/success${search}`]}>
    <Success />
  </MemoryRouter>,
);
const de = (key: string) => i18n.t(key, { lng: "de" });
const noEnglish = (text: string, where: string) => {
  for (const l of LITERALS) expect(text, `${where} still prints "${l}" in English`).not.toContain(l);
};

describe("in German", () => {
  it("the buyer's cards and the delete confirmation", async () => {
    const { container } = mount(`?session_id=cs_live_german_buyer&share=${SHARE}`);
    await screen.findByText(de("paidAnalysis.page.clearTitle"), {}, SLOW);
    for (const k of ["clearTitle", "clearBody", "clearButton", "deleteTitle", "deleteBody", "deleteButton", "scrollHint"]) {
      expect(container.textContent, `paidAnalysis.page.${k}`).toContain(de(`paidAnalysis.page.${k}`));
    }
    noEnglish(container.textContent ?? "", "the buyer's page");

    fireEvent.click(screen.getByRole("button", { name: de("paidAnalysis.page.clearButton") }));
    expect(await screen.findByText(de("paidAnalysis.page.cleared"), {}, SLOW)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: de("paidAnalysis.page.deleteButton") }));
    const dialog = await screen.findByRole("alertdialog", {}, SLOW);
    expect(dialog.textContent).toContain(de("paidAnalysis.page.deleteConfirmTitle"));
    expect(dialog.textContent).toContain(de("paidAnalysis.page.deleteConfirmBody"));
    expect(dialog.textContent).toContain(de("paidAnalysis.page.deleteConfirmYes"));
    expect(dialog.textContent).toContain(de("success.actions.cancel"));
    noEnglish(dialog.textContent ?? "", "the delete confirmation");
    expect(dialog.textContent).not.toMatch(/\bCancel\b/);
  });

  it("the mailed card, when the analysis was mailed", async () => {
    setResumeData("tempSessionId:cs_live_german_mailed", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    invoke.mockImplementation(async (fn: string) =>
      fn === "analyze-resume" ? { data: { ...ANALYSIS, shareId: SHARE, emailSent: true }, error: null } : { data: {}, error: null });
    const { container } = mount("?session_id=cs_live_german_mailed");
    await screen.findByText(de("paidAnalysis.page.emailSentTitle"), {}, SLOW);
    expect(container.textContent).toContain(de("paidAnalysis.page.emailSentBody"));
    expect(container.textContent).toContain(de("paidAnalysis.page.emailSentCheck"));
    noEnglish(container.textContent ?? "", "the mailed card");
  });

  it("no analysis open", async () => {
    const { container } = mount("");
    await waitFor(() => expect(container.textContent).toContain(de("success.noSession.title")), SLOW);
    expect(container.textContent).toContain(de("paidAnalysis.page.analyzeYourResume"));
    noEnglish(container.textContent ?? "", "the empty page");
  });

  it("its own title, translated, and a request not to be indexed", async () => {
    mount(`?session_id=cs_live_german_head&share=${SHARE}`);
    await screen.findByText(de("paidAnalysis.page.clearTitle"), {}, SLOW);
    await waitFor(() => expect(document.title).toBe(de("paidAnalysis.page.seoTitle")), SLOW);
    const robots = [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute("content"));
    expect(robots.some((c) => /noindex/.test(String(c))), "the success page asks to be indexed").toBe(true);
  });
});

describe("the words", () => {
  it("every paidAnalysis.page key is in all nine shards, English keeps today's words, and only English says them in English", () => {
    const en = shard("en").paidAnalysis.page as Record<string, string>;
    expect(en, "the paid shard has no paidAnalysis.page").toBeTruthy();
    // The English the tests and the help pages already quote.
    expect(en.clearTitle).toBe("Clear Browser Data");
    expect(en.deleteButton).toBe("Delete Data");
    expect(en.deleteConfirmYes).toBe("Yes, delete my data");
    for (const l of LOCALES) {
      const page = shard(l).paidAnalysis.page as Record<string, string>;
      expect(Object.keys(page).sort(), `${l}: paidAnalysis.page keys`).toEqual(Object.keys(en).sort());
      if (l === "en" || l === "en-GB") continue;
      for (const [k, v] of Object.entries(page)) expect(v, `${l} says paidAnalysis.page.${k} in English`).not.toBe(en[k]);
    }
  });

  it("the page names no English sentence in its markup", () => {
    const src = readFileSync(resolve(__dirname, "../pages/Success.tsx"), "utf8");
    for (const l of LITERALS) expect(src, `Success.tsx still prints "${l}"`).not.toContain(l);
  });
});
