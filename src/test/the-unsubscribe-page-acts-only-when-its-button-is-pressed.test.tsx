/**
 * THE UNSUBSCRIBE PAGE ACTS ONLY WHEN ITS BUTTON IS PRESSED (wave 2 email-ops,
 * register L10-14).
 *
 * The unsubscribe links in our mail used to unsubscribe on a GET of the
 * mailer's supabase.co URL, which link scanners follow before a person reads
 * the mail. They now open /email/unsubscribe on resumebooster.work. Renders the
 * real page with the network faked and holds that: nothing is invoked on load;
 * the button posts {action:"unsubscribe"} with the link's own parameters to
 * the mailer that owns the list; a refused link and a link that is not ours
 * say so; and the fragment leaves the address bar once it is spent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unsubscribeFromHash } from "@/lib/unsubscribe-link";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import i18n from "@/i18n";
import EmailUnsubscribe from "../pages/EmailUnsubscribe";
import { readLocale } from "./helpers/locale-strings";

const SID = "5e7a0c1d-1111-4111-8111-111111111111";
const TOKEN = "ab".repeat(16);
const page = () => render(<HelmetProvider><MemoryRouter><EmailUnsubscribe /></MemoryRouter></HelmetProvider>);
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { context: new Response("{}", { status }) });

beforeEach(() => { invoke.mockReset(); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("the fragment parser", () => {
  it("reads each list's own parameters and nothing that is not one of our links", () => {
    expect(unsubscribeFromHash(`#list=search-digest&id=${SID}&token=${TOKEN}`)).toEqual({ list: "search-digest", fn: "send-search-digest", params: { id: SID, token: TOKEN } });
    expect(unsubscribeFromHash(`#list=market-pulse&email=a%40b.example&token=${TOKEN}`)).toEqual({ list: "market-pulse", fn: "send-market-pulse", params: { email: "a@b.example", token: TOKEN } });
    expect(unsubscribeFromHash(`#list=scan-report&token=${TOKEN}`)).toEqual({ list: "scan-report", fn: "send-scan-report", params: { token: TOKEN } });
    expect(unsubscribeFromHash(`#list=search-digest&id=not-a-uuid&token=${TOKEN}`)).toBeNull();
    expect(unsubscribeFromHash(`#list=scan-report&token=<script>`)).toBeNull();
    expect(unsubscribeFromHash(`#list=send-everything&token=${TOKEN}`)).toBeNull();
    expect(unsubscribeFromHash("")).toBeNull();
  });
});

describe("the page", () => {
  it("invokes nothing on load; the button stops exactly the linked saved search", async () => {
    window.history.replaceState(null, "", `/email/unsubscribe#list=search-digest&id=${SID}&token=${TOKEN}`);
    invoke.mockResolvedValue({ data: { unsubscribed: true }, error: null });
    page();
    expect(screen.getByText(/Stop the digest emails for this saved search/)).toBeTruthy();
    expect(invoke, "a scanner's page load unsubscribed someone").not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Yes, turn them off/ }));
    await waitFor(() => expect(screen.getByText(/You will not get these emails again/)).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith("send-search-digest", { body: { action: "unsubscribe", id: SID, token: TOKEN } });
    // The fragment is forgotten in an effect that runs after the "done" render.
    await waitFor(() => expect(window.location.hash, "the spent token stayed in the address bar").toBe(""));
  });

  it("a link the mailer refuses says it is not valid", async () => {
    window.history.replaceState(null, "", `/email/unsubscribe#list=scan-report&token=${TOKEN}`);
    invoke.mockResolvedValue({ data: null, error: httpError(400) });
    page();
    fireEvent.click(screen.getByRole("button", { name: /Yes, turn them off/ }));
    await waitFor(() => expect(screen.getByText(/This link is not valid/)).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith("send-scan-report", { body: { action: "unsubscribe", token: TOKEN } });
  });

  it("a server that could not act says so and keeps the button", async () => {
    window.history.replaceState(null, "", `/email/unsubscribe#list=market-pulse&email=a%40b.example&token=${TOKEN}`);
    invoke.mockResolvedValue({ data: null, error: httpError(503) });
    page();
    fireEvent.click(screen.getByRole("button", { name: /Yes, turn them off/ }));
    await waitFor(() => expect(screen.getByText(/Could not turn them off right now/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Yes, turn them off/ })).toBeTruthy();
  });

  it("without one of our links there is no button at all", () => {
    window.history.replaceState(null, "", "/email/unsubscribe");
    page();
    expect(screen.getByText(/needs the unsubscribe link from one of our emails/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

/**
 * S14X-225, its copy half: the agent-digest line told the reader "Your agent
 * keeps running", in all nine languages, while the apply agent is switched
 * off (the server-side switch in _shared/apply-agent-switch.ts). The line now
 * says it has been retired, and the page's title and description, which were
 * English literals, are strings of their own in every language.
 */
describe("the agent-digest line says the agent is retired, in every language", () => {
  const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
  // The old claim, as each locale spelled it.
  const KEEPS_RUNNING: Record<(typeof LOCALES)[number], RegExp> = {
    en: /keeps running/i, "en-GB": /keeps running/i, de: /läuft weiter/, es: /sigue funcionando/, fr: /continue de tourner/,
    hi: /चलता रहेगा/, nl: /blijft draaien/, pt: /continua a funcionar/, tl: /Patuloy na tatakbo/i,
  };
  const switchSrc = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/apply-agent-switch.ts"), "utf8");
  const agentOn = /export const APPLY_AGENT_ON: boolean = true;/.test(switchSrc);

  it("the switch this guard reads is still where it was", () => {
    expect(switchSrc).toMatch(/export const APPLY_AGENT_ON: boolean = (?:true|false);/);
  });

  it.each(LOCALES)("%s: while the switch is off, the line never says the agent runs", (l) => {
    const line = String((readLocale(`${l}.json`).emailUnsubscribe as Record<string, unknown>).agentDigest ?? "");
    expect(line, `${l} has no emailUnsubscribe.agentDigest`).not.toBe("");
    if (!agentOn) expect(line).not.toMatch(KEEPS_RUNNING[l]);
  });

  it("the page's own English default says the same", () => {
    const src = readFileSync(resolve(__dirname, "../pages/EmailUnsubscribe.tsx"), "utf8");
    expect(src).not.toMatch(KEEPS_RUNNING.en);
  });

  it("an agent-digest link shows the retired line", () => {
    window.history.replaceState(null, "", `/email/unsubscribe#list=agent-digest&id=${SID}&token=${TOKEN}`);
    page();
    expect(screen.getByText(/The apply agent has been retired and applies nowhere/)).toBeTruthy();
  });

  it.each(LOCALES)("%s carries the page's title and description", (l) => {
    const u = readLocale(`${l}.json`).emailUnsubscribe as Record<string, unknown>;
    expect(String(u.metaTitle ?? ""), `${l} metaTitle`).toMatch(/\| Resume Booster$/);
    expect(String(u.metaDescription ?? ""), `${l} metaDescription`).not.toBe("");
  });

  it("a Spanish reader's tab is titled in Spanish", async () => {
    i18n.addResourceBundle("es", "translation", readLocale("es.json"), true, true);
    await i18n.changeLanguage("es");
    try {
      window.history.replaceState(null, "", "/email/unsubscribe");
      page();
      const want = String((readLocale("es.json").emailUnsubscribe as Record<string, unknown>).metaTitle ?? "the Spanish metaTitle");
      await waitFor(() => expect(document.title).toBe(want));
      expect(document.title).not.toBe("Unsubscribe | Resume Booster");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
