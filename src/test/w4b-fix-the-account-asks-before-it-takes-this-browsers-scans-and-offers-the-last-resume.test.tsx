/**
 * THE ACCOUNT ASKS BEFORE IT TAKES THIS BROWSER'S SCANS, AND OFFERS TO SAVE
 * THE RÉSUMÉ JUST SCANNED (wave 4 round 2 review: S12-025 finished, and the
 * shared-computer import).
 *
 * WHAT WAS WRONG.
 *   - The import ran once per account, silently, into accounts that already
 *     held scans, carrying each scan's fix-plan text and matched job. On a
 *     shared computer the next person to sign in got the previous visitor's
 *     scans in their user_scans for good.
 *   - The résumé behind the free report was lost at sign-up: the report's
 *     link lands on /account, which could import scores and checklists only.
 *     SaveResumeVersion's signed-out card was a bare link to /auth in English
 *     literals.
 *
 * WHAT HOLDS NOW.
 *   - /account offers "Scans found in this browser: N" with Add / Not mine;
 *     nothing is inserted until Add. Not mine stops the offer for that
 *     account; a scan one account added is never offered to another.
 *   - /account offers to save the résumé this tab scanned last; Save inserts a
 *     résumé version (user_scans.resume_text), No thanks stops the offer.
 *   - The signed-out card sends the visitor to /auth?next=/account, in t()
 *     strings.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLAIMED_KEY, importLocalScans, lastScanResumeToOffer, localScansToOffer, LOCAL_HISTORY_KEY, SESSION_RESUME_KEY,
} from "@/lib/account-history-import";
import { LocalHistoryOffer } from "@/components/account/LocalHistoryOffer";

type Row = Record<string, unknown>;
const fakeDb = () => {
  const inserted: unknown[] = [];
  const rows: Row[] = [];
  return {
    inserted,
    db: {
      from: () => ({
        insert: async (r: Row | Row[]) => { inserted.push(r); rows.push(...(Array.isArray(r) ? r : [r])); return { error: null }; },
        select: () => ({ order: () => ({ limit: async () => ({ data: [...rows] }) }) }),
      }),
    },
  };
};

const LOCAL = {
  entries: [
    { id: "a1", timestamp: "2026-10-01T10:00:00.000Z", atsScore: 61, industry: "healthcare", checklist: [{ id: "q", label: "Add your BLS certification", completed: false, category: "quick_win" }], jobTitle: "Charge Nurse", jobCompany: "Acme Health" },
    { id: "a2", timestamp: "2026-10-02T10:00:00.000Z", atsScore: 70, industry: "healthcare" },
  ],
};
const RESUME = "Jane Doe, RN. Charge nurse with eight years in acute care. ".repeat(8);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(LOCAL));
});
afterEach(cleanup);

describe("this browser's scans are offered, never taken silently", () => {
  it("nothing is inserted until the person presses Add, and then the checklist and job come with each scan", async () => {
    const { db, inserted } = fakeDb();
    const offered = localScansToOffer("u-1", []);
    let shown: unknown[] = [];
    render(<MemoryRouter><LocalHistoryOffer db={db} userId="u-1" offeredScans={offered} offeredResume={null} mapRow={(r: never) => r} onScans={(l) => { shown = l; }} /></MemoryRouter>);
    expect(screen.getByText("Scans found in this browser: 2")).toBeTruthy();
    expect(inserted).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add them to my account" })); });
    expect(inserted).toHaveLength(1);
    expect((inserted[0] as Row[]).map((r) => r.label)).toEqual(["Charge Nurse @ Acme Health", null]);
    expect(shown).toHaveLength(2);
    expect(document.querySelector("[data-local-scans-offer]")).toBeNull();
  });

  it("Not mine inserts nothing and stops the offer for that account only", () => {
    const { db, inserted } = fakeDb();
    render(<MemoryRouter><LocalHistoryOffer db={db} userId="u-1" offeredScans={localScansToOffer("u-1", [])} offeredResume={null} mapRow={(r: never) => r} onScans={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Not mine" }));
    expect(inserted).toEqual([]);
    expect(localScansToOffer("u-1", [])).toEqual([]);
    expect(localScansToOffer("u-2", []).map((e) => e.id)).toEqual(["a1", "a2"]);
  });

  it("a scan one account added is never offered to the next person on this browser", async () => {
    const { db } = fakeDb();
    await importLocalScans(db, "u-1", localScansToOffer("u-1", []).filter((e) => e.id === "a1"), (r: never) => r);
    expect(JSON.parse(localStorage.getItem(CLAIMED_KEY)!)).toEqual({ a1: "u-1" });
    expect(localScansToOffer("u-2", []).map((e) => e.id)).toEqual(["a2"]);
  });
});

describe("the résumé this tab scanned is offered to the account", () => {
  it("Save stores it as a résumé version; nothing is stored before", async () => {
    sessionStorage.setItem(SESSION_RESUME_KEY, RESUME);
    const offered = lastScanResumeToOffer("u-1");
    expect(offered).toBe(RESUME.trim());
    const { db, inserted } = fakeDb();
    render(<MemoryRouter><LocalHistoryOffer db={db} userId="u-1" offeredScans={[]} offeredResume={offered} mapRow={(r: never) => r} onScans={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Save the résumé from your last scan?")).toBeTruthy();
    expect(inserted).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save it" })); });
    expect(inserted).toEqual([expect.objectContaining({ user_id: "u-1", resume_text: RESUME.trim(), ats_score: 70 })]);
    expect(screen.getByText("Saved to your account as a résumé version.")).toBeTruthy();
    expect(lastScanResumeToOffer("u-1"), "not offered again in this tab").toBeNull();
  });

  it("No thanks stores nothing, and a short or missing text is never offered", () => {
    sessionStorage.setItem(SESSION_RESUME_KEY, RESUME);
    const { db, inserted } = fakeDb();
    render(<MemoryRouter><LocalHistoryOffer db={db} userId="u-1" offeredScans={[]} offeredResume={lastScanResumeToOffer("u-1")} mapRow={(r: never) => r} onScans={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(inserted).toEqual([]);
    expect(lastScanResumeToOffer("u-1")).toBeNull();
    sessionStorage.setItem(SESSION_RESUME_KEY, "too short");
    expect(lastScanResumeToOffer("u-3")).toBeNull();
  });
});

describe("the page wires the offer, and the signed-out card returns to it", () => {
  it("Account.tsx reads the offer and imports nothing on load", () => {
    const page = readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8");
    expect(page).toMatch(/const offeredScans = localScansToOffer\(session\.user\.id, cloudScans\);/);
    expect(page).toMatch(/<LocalHistoryOffer/);
    expect(page).not.toMatch(/importLocalHistory|importLocalScans\(/);
  });

  it("SaveResumeVersion's signed-out card links /auth?next=/account in t() strings", () => {
    const card = readFileSync(resolve(__dirname, "../components/SaveResumeVersion.tsx"), "utf8");
    expect(card).toMatch(/to=\{`\/auth\?next=\$\{encodeURIComponent\(FREE_REPORT_SIGNUP_NEXT\)\}`\}/);
    expect(card).toMatch(/t\("saveResume\.signedOutCta", "Create a free account"\)/);
    expect(card).not.toMatch(/>\s*Keep this scan working for you\s*</);
  });
});
