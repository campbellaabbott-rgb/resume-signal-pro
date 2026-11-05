/**
 * A CLAIM AND A KEY ARE ASKED FOR IN THE LANGUAGE THE PAGE IS READ IN (S13-102,
 * the pages' half; found by the review of audit-rest).
 *
 * company-claim and api-key-request write their mail in body.language, then the
 * browser's Accept-Language, then English. Neither page sent a language, so an
 * employer reading the site in French on an English browser was mailed in
 * English, and the claim stored 'en' for its later "verified" notice too. The
 * handlers' own test passed only because it wrote the field by hand.
 *
 * Mounted for real with only the backend faked: the request each press sends
 * names the language the page shows. Safe ahead of the functions: the live
 * builds read named fields and ignore one they do not know.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: { verified: false, website: null }, error: null }),
  },
}));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit", "in", "update", "insert"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import { CompanyClaim } from "@/components/jobs/CompanyClaim";
import DataApi from "../pages/DataApi";

vi.setConfig(MOUNT_TEST_BUDGET);

beforeEach(() => {
  invoke.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const pressClaim = async () => {
  const { container } = render(<MemoryRouter><CompanyClaim companyToken="savills" companyName="Savills" open /></MemoryRouter>);
  const box = await waitFor(() => {
    const el = container.querySelector<HTMLInputElement>("input[type=email]");
    expect(el).toBeTruthy();
    return el as HTMLInputElement;
  }, SLOW);
  fireEvent.change(box, { target: { value: "rh@savills.co.uk" } });
  fireEvent.click(box.parentElement!.querySelector("button")!);
  await waitFor(() => expect(invoke).toHaveBeenCalled(), SLOW);
  const [fn, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
  expect(fn).toBe("company-claim");
  return opts.body;
};

const pressKey = async () => {
  render(<HelmetProvider><MemoryRouter><DataApi /></MemoryRouter></HelmetProvider>);
  const box = document.querySelector<HTMLInputElement>("form input[type=email]")!;
  fireEvent.change(box, { target: { value: "dev@example.org" } });
  fireEvent.submit(box.closest("form")!);
  await waitFor(() => expect(invoke).toHaveBeenCalled(), SLOW);
  const [fn, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
  expect(fn).toBe("api-key-request");
  return opts.body;
};

describe("the claim's press", () => {
  it("names French on a page read in French, whatever the browser prefers", async () => {
    invoke.mockResolvedValue({ data: { status: "sent" }, error: null });
    await i18n.changeLanguage("fr");
    const body = await pressClaim();
    expect(body).toMatchObject({ action: "request", companyToken: "savills", workEmail: "rh@savills.co.uk", language: "fr" });
  });

  it("follows the picker, not a fixed language", async () => {
    invoke.mockResolvedValue({ data: { status: "sent" }, error: null });
    await i18n.changeLanguage("nl");
    expect((await pressClaim()).language).toBe("nl");
  });
});

describe("the key's press", () => {
  it("names Dutch on a page read in Dutch", async () => {
    invoke.mockResolvedValue({ data: { requested: true }, error: null });
    await i18n.changeLanguage("nl");
    const body = await pressKey();
    expect(body).toMatchObject({ email: "dev@example.org", language: "nl" });
  });

  it("names German after the picker moves to German", async () => {
    invoke.mockResolvedValue({ data: { requested: true }, error: null });
    await i18n.changeLanguage("de");
    expect((await pressKey()).language).toBe("de");
  });
});
