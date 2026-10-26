/**
 * THE AGENT CONSOLE DESCRIBES NO RUNNING AGENT WHILE THE AGENT IS OFF (wave 4,
 * the second recheck of the descope).
 *
 * WHAT WAS WRONG. Wave 4 switched the server-side apply agent off and gated
 * the setup checklist, the pending questions and the morning queue's subtitle
 * on APPLY_AGENT_ON, but left three things on the signed-in /agent page that
 * describe the agent as running. Mounted at /agent?tab=settings, signed in,
 * with job-board's live `status` answer (sendable 37,909 of 1,012,399, 3.7%,
 * read with x-rb-budget: probe on 2026-10-25), the same tab showed the
 * retirement notice ("Resume Booster does not send applications for
 * anyone") and also:
 *   - AgentReachNote: "It submits automatically to 37,909 of the 1,012,399
 *     postings on the board (3.7%) ... Auto-submits on: breezy, personio,
 *     pinpoint, teamtailor";
 *   - AgentControlsPanel: "Never apply to these employers" and "Pause, with a
 *     date it comes back", controls for an agent that does nothing;
 *   - ApplyProfilePanel's readiness block: "Nothing in your profile is
 *     holding applications back. If an employer asks something new, the agent
 *     still stops rather than guessing", or, with a gap, "Nothing can be sent
 *     yet" and "the agent refuses rather than guessing, so those postings are
 *     skipped"; and the panel's intro, "that application waits for you".
 * And on the Today tab, a past subscriber whose mandate is still active read
 * "your first queue arrives after tonight's run". On origin/main the agent
 * runs, so these sentences are true there; with the agent off they are not.
 * The signed-out page's "Had the plan? Sign in" link lands here.
 *
 * WHAT HOLDS NOW, mounted for real in all nine locales: with the switch as it
 * ships (off), none of those sentences renders; the retirement notice and the
 * profile form (the person's stored answers) still do. The positive control
 * switches the agent on and finds each of them, so the absence is not an
 * artefact of the mocks.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

import en from "../i18n/locales/en.json";
import enGB from "../i18n/locales/en-GB.json";
import de from "../i18n/locales/de.json";
import fr from "../i18n/locales/fr.json";
import es from "../i18n/locales/es.json";
import nl from "../i18n/locales/nl.json";
import pt from "../i18n/locales/pt.json";
import hi from "../i18n/locales/hi.json";
import tl from "../i18n/locales/tl.json";

/** The switch, as it ships unless a test turns it on (the positive control). */
const sw = vi.hoisted(() => ({ on: null as boolean | null }));
vi.mock("../../supabase/functions/_shared/apply-agent-switch", async (importActual) => {
  const actual = await importActual<typeof import("../../supabase/functions/_shared/apply-agent-switch")>();
  return {
    ...actual,
    get APPLY_AGENT_ON() { return sw.on ?? actual.APPLY_AGENT_ON; },
  };
});

/** job-board's live status answer on 2026-10-25 (read-only, x-rb-budget: probe). */
const LIVE_SENDABLE = { vendors: 4, postings: 37909, ofTotal: 1012399, pct: 3.7 };
vi.mock("@/lib/invoke-job-board", () => ({
  invokeJobBoard: async () => ({ data: { sendable: LIVE_SENDABLE }, error: null }),
}));

/** A complete profile (no readiness gap) unless a test empties a field. */
const COMPLETE = {
  user_id: "u1", email: "u@example.com", full_name: "Alex Rivera", phone: "+1 555 0100", linkedin: "linkedin.com/in/alex",
  website: "", city: "Austin", country: "US", address: "1 Main St", postcode: "78701", resume_file_url: "u1/cv.pdf",
  work_authorized: true, requires_sponsorship: false, willing_to_relocate: false, work_authorized_countries: [],
  cover_note: "Data engineer.", tailor_cover_note: false, salary_expectation: "$120,000", earliest_start: "2 weeks",
  share_demographics: false, consent_to_processing: true, apply_mode: "review", auto_apply_daily_cap: 5,
  // The past subscriber's mandate, still marked active.
  active: true, q: "data engineer", category: null, location: "", remote_only: false, salary_min: null, daily_count: 5,
  max_age_days: null, include_uncategorised: false, countries: "", email_opt_in: true,
  blocked_companies: [], paused_until: null, pause_reason: null, employer_cooldown_days: 30,
};
let mandate: Record<string, unknown> = COMPLETE;

vi.mock("@/integrations/supabase/client", () => {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_t, p) => {
        // Lists: the queue is empty (the morning queue's empty state), every other list too.
        if (p === "then") return (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
        if (p === "maybeSingle" || p === "single") return async () => ({ data: table === "agent_mandates" ? mandate : null, error: null });
        return () => chain;
      },
    });
    return chain;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: null }) },
      rpc: async () => ({ data: null, error: null }),
      from: (table: string) => chainFor(table),
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
      auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { access_token: "jwt" }, user: { id: "u1", email: "u@example.com" }, loading: false }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/account/AgentStatusBand", () => ({ AgentStatusBand: () => null }));
vi.mock("@/components/account/AgentNightSummary", () => ({ AgentNightSummary: () => null }));
vi.mock("@/components/account/PendingQuestionsPanel", () => ({ PendingQuestionsPanel: () => null }));
vi.mock("@/components/account/AgentSetupChecklist", () => ({ AgentSetupChecklist: () => null }));

import Agent from "../pages/Agent";

vi.setConfig(MOUNT_TEST_BUDGET);

const LOCALES: Record<string, Record<string, unknown>> = { en, "en-GB": enGB, de, fr, es, nl, pt, hi, tl };

beforeAll(() => {
  for (const [lng, res] of Object.entries(LOCALES)) if (lng !== "en") i18n.addResourceBundle(lng, "translation", res, true, true);
});
beforeEach(() => { sw.on = null; mandate = COMPLETE; });
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

/**
 * Keys no locale file carries: the components render their English default in
 * every language (AgentReachNote, AgentControlsPanel).
 */
const DEFAULTS: Record<string, string> = {
  "agent.reach.title": "Where the agent can apply for you",
  "agent.reach.body": "It submits automatically to {{drivable}} of the {{total}} postings on the board ({{pct}}%). ",
  "agent.reach.vendors": "Auto-submits on: {{vendors}}. Counted from the live board, not an estimate.",
  "agent.reach.vendorsCount": "Auto-submits on {{n}} application systems. Counted from the live board, not an estimate.",
  "agentControls.blocklist.title": "Never apply to these employers",
  "agentControls.pause.title": "Pause, with a date it comes back",
};

/** A key's value in this locale (en-GB falls back to en, as i18next does; then the component's default). */
const str = (lng: string, key: string): string => {
  const get = (o: unknown) => key.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
  const v = get(LOCALES[lng]) ?? get(en) ?? DEFAULTS[key];
  if (typeof v !== "string") throw new Error(`${lng}: ${key} is not a string`);
  return v;
};
/** The longest run of words between placeholders: what any rendering of the sentence carries. */
const fixed = (s: string) => {
  const run = s.split(/\{\{[^}]*\}\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] ?? "";
  if (run.length < 8) throw new Error(`no fixed words to look for in "${s}"`);
  return run.slice(0, 60);
};

/** Every sentence that describes the agent as running, by key. */
const RUNNING_KEYS = [
  "agent.reach.title", "agent.reach.body", "agent.reach.vendors", "agent.reach.vendorsCount",
  "agentControls.blocklist.title", "agentControls.pause.title",
  "applyReadiness.clear", "applyReadiness.headBlocked", "applyReadiness.headSome", "applyReadiness.headQuality",
  "applyReadiness.work_authorized", "applyProfile.intro",
];

const mount = async (lng: string, tab: "settings" | "today") => {
  await i18n.changeLanguage(lng);
  render(
    <MemoryRouter initialEntries={[`/agent?tab=${tab}`]}>
      <Routes><Route path="/agent" element={<Agent />} /></Routes>
    </MemoryRouter>,
  );
  // Let the profile load, the lazy reach note resolve and the status read land.
  await act(async () => {
    await import("@/components/account/AgentReachNote");
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  });
};

describe("/agent?tab=settings, signed in, with the agent switched off as it ships", () => {
  it("the switch ships off (the cases below read it as it is)", async () => {
    const actual = await vi.importActual<typeof import("../../supabase/functions/_shared/apply-agent-switch")>("../../supabase/functions/_shared/apply-agent-switch");
    expect(actual.APPLY_AGENT_ON).toBe(false);
  });

  it.each(Object.keys(LOCALES))("%s: no sentence says the agent submits, is controlled, or stops on a question", async (lng) => {
    await mount(lng, "settings");
    // The page is the console, with its retirement notice and the person's stored answers.
    expect(document.body.textContent).toContain(fixed(str(lng, "applyProfile.title")));
    const text = document.body.textContent ?? "";
    for (const key of RUNNING_KEYS) expect(text, `${lng}: ${key}`).not.toContain(fixed(str(lng, key)));
    expect(text).not.toMatch(/submits automatically|Auto-submits|stops rather than guessing|37,909|37\.909|37 909/);
  });

  it.each(Object.keys(LOCALES))("%s: a profile with gaps names no application that waits or is skipped", async (lng) => {
    mandate = { ...COMPLETE, work_authorized: null, resume_file_url: "" };
    await mount(lng, "settings");
    const text = document.body.textContent ?? "";
    for (const key of ["applyReadiness.headBlocked", "applyReadiness.work_authorized", "applyReadiness.resume_file_url"]) {
      expect(text, `${lng}: ${key}`).not.toContain(fixed(str(lng, key)));
    }
  });

  it.each(Object.keys(LOCALES))("%s: the Today tab promises no queue after tonight's run to a past subscriber", async (lng) => {
    await mount(lng, "today");
    expect(document.body.textContent).not.toContain(fixed(str(lng, "agentQueue.emptyActive")));
  });
});

describe("positive control: with the agent switched on, the same mounts show every one of them", () => {
  it("the settings tab shows the reach note with the live figure, the controls and the readiness line", async () => {
    sw.on = true;
    await mount("en", "settings");
    expect(await screen.findByText(/It submits automatically to 37,909 of the 1,012,399 postings/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Auto-submits on:");
    expect(text).toContain(str("en", "agentControls.blocklist.title"));
    expect(text).toContain(str("en", "agentControls.pause.title"));
    expect(text).toContain(fixed(str("en", "applyReadiness.clear")));
    expect(text).toContain(fixed(str("en", "applyProfile.intro")));
  });

  it("a gap shows its consequence", async () => {
    sw.on = true;
    mandate = { ...COMPLETE, work_authorized: null };
    await mount("en", "settings");
    expect(document.body.textContent).toContain(fixed(str("en", "applyReadiness.work_authorized")));
  });

  it("the Today tab shows the empty-queue line to an active mandate", async () => {
    sw.on = true;
    await mount("en", "today");
    expect(document.body.textContent).toContain(fixed(str("en", "agentQueue.emptyActive")));
  });
});
