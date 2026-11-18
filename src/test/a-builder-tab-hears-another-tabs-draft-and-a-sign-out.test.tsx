/**
 * A BUILDER TAB HEARS ANOTHER TAB'S DRAFT, AND A SIGN-OUT (S14X-096: M-S14-065).
 *
 * WHAT WAS WRONG. The builder keeps its draft in localStorage and writes it
 * on every change, but never listened for another tab changing it. A sign-out
 * in one tab clears the draft from this browser (clearLocalResumeCopies), yet
 * a builder left open in a second tab still held the résumé in memory, and
 * its next keystroke wrote the whole résumé back: on a shared computer, the
 * next person found it. Two builder tabs also overwrote each other in turn.
 *
 * WHAT HOLDS NOW. The builder hears the 'storage' event for its draft. When
 * the draft is removed elsewhere it empties itself, says so, and an import
 * still running is dropped. When the draft changes elsewhere, a tab that
 * held what was stored takes the new version; a tab holding something else
 * asks whether to load it or keep its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { createEmptyResume, type BuilderResume } from "@/types/resume-builder";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const KEY = "resumeBuilderDraft";
const draftNamed = (name: string, title = "Analyst"): BuilderResume => {
  const r = createEmptyResume();
  r.contact.fullName = name;
  r.contact.title = title;
  return r;
};
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
/** What another tab's write looks like here: the store already changed, then the event. */
const otherTab = (newValue: string | null, oldValue: string | null) => act(() => {
  if (newValue === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, newValue);
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue, newValue }));
});
const titleInput = () => screen.getByPlaceholderText(i18n.t("resumeBuilder.placeholder.title"));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
});
afterEach(() => cleanup());

describe("a sign-out or a clear in another tab", () => {
  it("empties this tab, says so, and a later edit never writes the old résumé back", async () => {
    const stored = JSON.stringify(draftNamed("Shared Name"));
    localStorage.setItem(KEY, stored);
    mount();
    expect(screen.getByDisplayValue("Shared Name")).toBeTruthy();
    localStorage.setItem("rb_signed_out_at", String(Date.now()));
    otherTab(null, stored);
    await waitFor(() => expect(screen.queryByDisplayValue("Shared Name")).toBeNull());
    expect(screen.getByText(i18n.t("builderPage.otherTab.cleared"))).toBeTruthy();
    fireEvent.change(titleInput(), { target: { value: "edit after sign-out" } });
    await waitFor(() => expect(localStorage.getItem(KEY) ?? "").toContain("edit after sign-out"));
    expect(localStorage.getItem(KEY)).not.toContain("Shared Name");
  });

  it("an import still running when the draft is cleared elsewhere is dropped", async () => {
    let land!: (v: unknown) => void;
    invoke.mockReturnValueOnce(new Promise((r) => { land = r; }));
    sessionStorage.setItem("rb_resume_text", "Jordan Probe\nProduct analyst at Acme. ".padEnd(160, "A"));
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    localStorage.setItem("rb_signed_out_at", String(Date.now()));
    otherTab(null, null);
    await act(async () => {
      land({ data: { success: true, contact: { fullName: "Imported Person" }, experience: [], education: [], skills: [] }, error: null });
    });
    expect(screen.queryByDisplayValue("Imported Person")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("a change in another tab", () => {
  it("a tab with nothing in it shows the other tab's draft", async () => {
    mount();
    otherTab(JSON.stringify(draftNamed("Other Tab Name")), null);
    expect(await screen.findByDisplayValue("Other Tab Name")).toBeTruthy();
  });

  it("a tab that held what was stored takes the new version without asking", async () => {
    const stored = JSON.stringify(draftNamed("Before"));
    localStorage.setItem(KEY, stored);
    mount();
    otherTab(JSON.stringify(draftNamed("After")), stored);
    expect(await screen.findByDisplayValue("After")).toBeTruthy();
    expect(screen.queryByText(i18n.t("builderPage.otherTab.changed"))).toBeNull();
  });

  it("a tab holding something else asks, and loads the other version on request", async () => {
    localStorage.setItem(KEY, JSON.stringify(draftNamed("Mine")));
    mount();
    otherTab(JSON.stringify(draftNamed("Theirs")), JSON.stringify(draftNamed("Something older")));
    expect(await screen.findByText(i18n.t("builderPage.otherTab.changed"))).toBeTruthy();
    expect(screen.getByDisplayValue("Mine")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("builderPage.otherTab.load") }));
    expect(await screen.findByDisplayValue("Theirs")).toBeTruthy();
  });

  it("keep mine writes this tab's version back", async () => {
    localStorage.setItem(KEY, JSON.stringify(draftNamed("Mine")));
    mount();
    otherTab(JSON.stringify(draftNamed("Theirs")), JSON.stringify(draftNamed("Something older")));
    fireEvent.click(await screen.findByRole("button", { name: i18n.t("builderPage.otherTab.keep") }));
    await waitFor(() => expect(localStorage.getItem(KEY)).toContain("Mine"));
    expect(screen.getByDisplayValue("Mine")).toBeTruthy();
    expect(screen.queryByText(i18n.t("builderPage.otherTab.changed"))).toBeNull();
  });
});
