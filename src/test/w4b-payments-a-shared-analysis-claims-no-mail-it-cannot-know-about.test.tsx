/**
 * A SHARED ANALYSIS CLAIMS NO MAIL IT CANNOT KNOW ABOUT, AND ITS PAGE SPEAKS
 * THROUGH THE TRANSLATOR (S12-114, the success page of the one product still
 * sold on its own).
 *
 * The Full Analysis page opened from a share link printed "Results emailed to
 * you" to whoever held the link, whether or not any mail was sent to them,
 * and its PDF and recovery strings were English in every locale. The claim is
 * gone; the strings go through t(key, English default) so the nine-locale
 * translator can carry them. Mounted for real with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/components/AnalysisResults", () => ({ AnalysisResults: () => <div data-testid="analysis">the analysis</div> }));

import Success from "../pages/Success";

vi.setConfig(MOUNT_TEST_BUDGET);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => name === "get_analysis_by_share_id"
    ? { data: [{ share_id: "share_from_a_link", analysis_result: { industry: "Software", atsScore: { overall: 72 } } }], error: null }
    : { data: null, error: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("the Full Analysis page opened from a share link", () => {
  it("shows the analysis and says nothing about a mail it cannot know was sent", async () => {
    window.history.replaceState(null, "", "/success?share=share_from_a_link");
    render(<BrowserRouter><Success /></BrowserRouter>);
    await waitFor(() => expect(screen.getByTestId("analysis")).toBeTruthy(), SLOW);
    expect(screen.queryByText(/Results emailed to you/), "a shared link told its holder the results were mailed to them").toBeNull();
  });

  it("speaks its PDF, recovery and error strings through the translator, never as bare English", () => {
    const src = codeOf(readFileSync(resolve(__dirname, "../pages/Success.tsx"), "utf8"));
    for (const english of ['"Save as PDF"', '"Generating..."', '"Analysis failed"', '"Failed to load analysis."', '"Browser data cleared"', '"Analysis ready"']) {
      expect(src, `${english} is rendered without t()`).not.toContain(`: ${english}`);
      expect(src).not.toMatch(new RegExp(`(title|description|setError\\()\\s*:?\\s*${english.replace(/[.()]/g, "\\$&")}`));
    }
    expect(src).toContain("t('success.actions.savePdf', 'Save as PDF')");
  });
});
