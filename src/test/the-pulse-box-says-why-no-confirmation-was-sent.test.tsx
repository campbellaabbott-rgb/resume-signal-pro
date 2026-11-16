/**
 * THE PULSE BOX SAYS WHY NO CONFIRMATION WAS SENT (S14X-240).
 *
 * A ticked "monthly market pulse" box asks send-market-pulse to mail a
 * confirmation link. The page answered a success ("check your inbox") and a
 * field the pulse does not cover (422), and said nothing at all for any
 * other answer: an inbox over its allowance, the day's ceiling, an outage.
 * The reader saw "Sent!" for the report and was left waiting for a pulse
 * confirmation that was never asked for. Any other answer now says no
 * confirmation was sent: the server's own sentence for an English reader,
 * ours in the reader's language for anyone else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import i18n from "@/i18n";
import { EmailReportCapture } from "@/components/EmailReportCapture";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}

const payload = {
  score: 74, projectedScore: 86, scoreBreakdown: null, peerPercentile: null,
  applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology",
};
const REFUSED = "This inbox has asked for the pulse too often today.";
/** The pulse answers `status` with `body`, as supabase-js hands a non-2xx back. */
const pulseAnswers = (status: number, body: Record<string, unknown>) =>
  invoke.mockImplementation(async (fn: string) => fn === "send-market-pulse"
    ? { data: null, error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) } }
    : { data: { success: true }, error: null });

beforeEach(() => { localStorage.clear(); invoke.mockReset(); });
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

async function tickAndSend() {
  render(<EmailReportCapture payload={payload} />);
  fireEvent.click(screen.getByRole("checkbox", { name: i18n.t("freeResults.enterprise.pulseOptIn") }));
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "me@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("freeResults.enterprise.emailSend", "Send") }));
  await waitFor(() => expect(invoke.mock.calls.some(([fn]) => fn === "send-market-pulse")).toBe(true));
}

describe("a pulse request that was refused or failed", () => {
  it("says the server's sentence to an English reader", async () => {
    await speak("en");
    pulseAnswers(429, { error: REFUSED });
    await tickAndSend();
    expect((await screen.findByTestId("pulse-not-asked")).textContent).toBe(REFUSED);
  });

  it("says ours to a Spanish reader, never the server's English", async () => {
    await speak("es");
    pulseAnswers(429, { error: REFUSED });
    await tickAndSend();
    const line = await screen.findByTestId("pulse-not-asked");
    expect(line.textContent).toBe(i18n.t("freeScanPage.pulse.notAsked"));
    expect(line.textContent).not.toContain(REFUSED);
  });

  it("says no confirmation was sent when the request never answered", async () => {
    await speak("en");
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "send-market-pulse") throw new Error("network");
      return { data: { success: true }, error: null };
    });
    await tickAndSend();
    expect((await screen.findByTestId("pulse-not-asked")).textContent).toBe(i18n.t("freeScanPage.pulse.notAsked"));
  });

  it("a field the pulse does not cover still says so, and nothing more", async () => {
    await speak("en");
    pulseAnswers(422, { error: "not covered" });
    await tickAndSend();
    await screen.findByText(/doesn't cover your field|does not cover your field/i);
    expect(screen.queryByTestId("pulse-not-asked")).toBeNull();
  });
});
