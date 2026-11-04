/**
 * A REPORT MAIL IS ASKED FOR IN THE LANGUAGE THE VISITOR READS THE PAGE IN
 * (S13-102, the page's half).
 *
 * send-scan-report writes the report mail and the four fix-plan mails in
 * body.language, then the browser's Accept-Language, then English. The pages
 * sent no language, so a visitor who chose German in the site's picker on an
 * English browser was mailed in English. Both presses now name the page's
 * language: the report form, and the button that starts the fix plan.
 *
 * Both are safe ahead of the function: the live send-scan-report ignores a body
 * field it does not read, and the scanner's seal does not cover it (proved on
 * the handler by the-report-and-digest-mails-are-written-in-the-readers-language).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: null }),
    from: () => stubTable(),
    functions: { invoke },
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

import { EmailReportCapture } from "../components/EmailReportCapture";
import FixPlanConfirm from "../pages/FixPlanConfirm";

const LOCALES = resolve(__dirname, "../../src/i18n/locales");
const payload = {
  score: 74, projectedScore: 86, scoreBreakdown: null, peerPercentile: null,
  applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology",
};

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { success: true, queued: true }, error: null });
  i18n.addResourceBundle("de", "translation", JSON.parse(readFileSync(resolve(LOCALES, "de.json"), "utf8")), true, true);
});
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});

describe("the two presses that start a report mail", () => {
  it("the report form sends the page's language beside the address", async () => {
    await i18n.changeLanguage("de");
    render(<EmailReportCapture payload={payload} variant="compact" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /senden|send/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [fn, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe("send-scan-report");
    expect(opts.body.language).toBe("de");
    expect(opts.body.email).toBe("me@example.com");
  });

  it("the report form's language follows the picker, not a fixed English", async () => {
    render(<EmailReportCapture payload={payload} variant="compact" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect((invoke.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body.language).toBe("en");
  });

  it("the fix-plan button sends the page's language beside its token", async () => {
    await i18n.changeLanguage("de");
    const token = `eyJ2IjoxfQ_-abc.${"0f".repeat(32)}`;
    window.history.replaceState(null, "", `/fix-plan/confirm#d=${token}`);
    render(<HelmetProvider><MemoryRouter><FixPlanConfirm /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /ja, e-mails starten/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("send-scan-report", { body: { action: "confirm-drip", token, language: "de" } });
  });
});
