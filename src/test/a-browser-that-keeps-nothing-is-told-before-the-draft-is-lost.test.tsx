/**
 * A BROWSER THAT KEEPS NOTHING IS TOLD BEFORE THE DRAFT IS LOST (S14X-129: M-S14-103).
 *
 * WHAT WAS WRONG. The builder's only copy of a draft is localStorage. In a
 * browser that blocks site storage, src/lib/storage-guard.ts (S8-104) swaps
 * in an in-memory store so the site still runs, and a full storage refuses
 * the write; either way the draft is gone on the next reload or the next
 * full-page hand-off, and saveDraft swallowed the failure as "not worth
 * surfacing". A person could type a whole résumé and lose it with no warning.
 *
 * WHAT HOLDS NOW. When localStorage is not the browser's own Storage (the
 * guard's in-memory stand-in), or a write is refused, the builder says so
 * ("This browser isn't saving your draft. Export it before you leave.") and
 * asks before the page is left while the résumé has anything in it. With a
 * storage that keeps things, nothing is said and nothing is asked.
 *
 * Part of the register entry did not reproduce: Start Over's removeItem
 * cannot throw, because the guard replaces a blocked storage first. It now
 * goes through the same guarded remove as every other write anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { memoryStorage } from "@/lib/storage-guard";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

/** A storage that is the browser's own kind (an instance of Storage), backed by a map; `full` refuses every write. */
function browserStorage(full = false): Storage {
  const m = new Map<string, string>();
  const s = Object.create(Storage.prototype) as Storage;
  Object.defineProperties(s, {
    getItem: { value: (k: string) => (m.has(k) ? m.get(k)! : null) },
    setItem: { value: (k: string, v: string) => { if (full) throw new DOMException("full", "QuotaExceededError"); m.set(k, String(v)); } },
    removeItem: { value: (k: string) => { m.delete(k); } },
    clear: { value: () => m.clear() },
    key: { value: (i: number) => [...m.keys()][i] ?? null },
    length: { get: () => m.size },
  });
  return s;
}

const realLocal = window.localStorage;
const useLocal = (s: Storage) => Object.defineProperty(window, "localStorage", { value: s, writable: true, configurable: true });
const NOTICE = () => i18n.t("builderPage.storageBlocked");
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
const typeName = (v: string) => fireEvent.change(screen.getByPlaceholderText(i18n.t("resumeBuilder.placeholder.fullName")), { target: { value: v } });
/** Dispatch a beforeunload and say whether the page asked to stay. */
const leaving = () => {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

beforeEach(() => {
  sessionStorage.clear();
  invoke.mockReset();
});
afterEach(() => {
  cleanup();
  useLocal(realLocal);
  realLocal.clear();
});

describe("a browser whose storage keeps nothing", () => {
  it("the storage guard's in-memory stand-in: the notice shows, and leaving with a résumé asks first", async () => {
    useLocal(memoryStorage());
    mount();
    expect(screen.getByText(NOTICE())).toBeTruthy();
    expect(leaving(), "an empty builder asked before leaving").toBe(false);
    typeName("Blocked Storage");
    await waitFor(() => expect(leaving()).toBe(true));
  });

  it("a full storage that refuses the write: the notice shows once it is refused", async () => {
    useLocal(browserStorage(true));
    mount();
    expect(screen.queryByText(NOTICE())).toBeNull();
    typeName("Full Storage");
    expect(await screen.findByText(NOTICE())).toBeTruthy();
    expect(leaving()).toBe(true);
  });

  it("Start Over with the stand-in raises nothing", () => {
    useLocal(memoryStorage());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    typeName("Blocked Storage");
    expect(() => fireEvent.click(screen.getByRole("button", { name: new RegExp(i18n.t("resumeBuilder.startOver")) }))).not.toThrow();
    confirm.mockRestore();
  });
});

describe("a browser that keeps the draft", () => {
  it("says nothing and asks nothing", async () => {
    useLocal(browserStorage());
    mount();
    typeName("Kept Name");
    await waitFor(() => expect(window.localStorage.getItem("resumeBuilderDraft") ?? "").toContain("Kept Name"));
    expect(screen.queryByText(NOTICE())).toBeNull();
    expect(leaving()).toBe(false);
  });
});
