/**
 * THE SUCCESS PAGE ASKS FOR THE ANALYSIS IN THE PAGE'S LANGUAGE (S13-003, the
 * page half).
 *
 * analyze-resume writes the analysis in the language the request names, else
 * in the résumé's (report-language.ts). The success page sent no language at
 * any of its three asks, so a buyer reading the site in Spanish was answered
 * in the résumé's language at best and, before this branch, always in English.
 *
 * The page is mounted for real in Spanish, with only the backend and the
 * toast faked: the stored-résumé ask, the session-only ask for an analysis
 * already delivered, and the pasted-résumé ask each carry `language: "es"`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const { invoke, rpc, toastFn } = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  // One function for the page's whole life: Success re-runs its load effect whenever `toast` changes identity.
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
import { setResumeData, clearAllResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const ES = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/es.json"), "utf8"));
const RESUME = "Ingeniera de software con diez años de experiencia en sistemas de pago. ".repeat(10);
const PASTED = "Jane Doe. Ingeniera de pagos, ocho años de experiencia y liderazgo de equipo. ".repeat(8);
const DELIVERED = {
  shareId: "0123456789abcdef01234567",
  emailSent: false,
  industry: "technology",
  experienceLevel: "senior",
  atsScore: { score: 74, breakdown: { jobTitleMatch: 10, skillsMatch: 22, actionVerbUsage: 11, keywordCoverage: 15, formattingScore: 16 }, improvements: [] },
  optimizedBullets: [{ original: "hice cosas", improved: "Entregué cosas", explanation: "verbo" }],
  actionVerbs: ["Entregué"],
  keywords: { found: ["TypeScript"], missing: ["Kubernetes"] },
  redFlags: [],
};

type Body = { resumeText?: string; sessionId?: string; language?: string };
const analyzeBodies = () => invoke.mock.calls.filter(([fn]) => fn === "analyze-resume").map(([, o]) => (o as { body: Body }).body);

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearAllResumeData();
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_temp_resume") return { data: [{ resume_text: RESUME, linkedin_text: null, job_description_text: null }], error: null };
    if (name === "get_analysis_by_share_id") return { data: [], error: null };
    return { data: null, error: null };
  });
  i18n.addResourceBundle("es", "translation", ES, true, true);
  await i18n.changeLanguage("es");
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

describe("every ask names the page's language", () => {
  it("the analysis of the résumé stored at checkout", async () => {
    invoke.mockImplementation(async (fn: string) => (fn === "analyze-resume" ? { data: DELIVERED, error: null } : { data: {}, error: null }));
    setResumeData("tempSessionId:cs_live_es_stored", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    mount("?session_id=cs_live_es_stored");
    await waitFor(() => expect(analyzeBodies().some((b) => b.resumeText)).toBe(true), SLOW);
    const ask = analyzeBodies().find((b) => b.resumeText)!;
    expect(ask.resumeText).toBe(RESUME);
    expect(ask.language, "the stored-résumé ask named no language").toBe("es");
  });

  it("the session-only ask and the pasted résumé's ask, in the recovery flow", async () => {
    invoke.mockImplementation(async (fn: string, opts: { body: Body }) => {
      if (fn !== "analyze-resume") return { data: {}, error: null };
      if (!opts.body.resumeText) return { data: { error: "Todavía no hay análisis." }, error: null };
      return { data: DELIVERED, error: null };
    });
    mount("?session_id=cs_live_es_pasted");
    // ResumeRecovery's buttons are still written in English whatever the page's language (left as found).
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${ES.resumeRecovery.pasteText}|paste text`, "i") }, SLOW));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: PASTED } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${ES.resumeRecovery.generateAnalysis}|generate analysis`, "i") }));
    await waitFor(() => expect(analyzeBodies().some((b) => b.resumeText)).toBe(true), SLOW);

    const [sessionOnly, pasted] = [analyzeBodies().find((b) => !b.resumeText)!, analyzeBodies().find((b) => b.resumeText)!];
    expect(sessionOnly.sessionId).toBe("cs_live_es_pasted");
    expect(sessionOnly.language, "the session-only ask named no language").toBe("es");
    expect(pasted.resumeText).toBe(PASTED.trim());
    expect(pasted.language, "the pasted-résumé ask named no language").toBe("es");
  });
});
