/**
 * THE BUILDER OPENED AN OLD DRAFT FOR A NEW SCAN, AND ONE REWRITE REPLACED
 * SEVERAL BULLETS (platform sweep L3-11, L3-12).
 *
 * L3-11. A first visit saved the empty starting résumé as a draft, and any
 * saved draft made the builder skip the import without a word. "Build a
 * clean, structured version of this résumé" (the free report) and "Open in
 * builder" (after a paid rewrite) then opened an empty page, or last week's
 * résumé for this week's scan.
 *
 * L3-12. A rewrite matched every bullet that contained its "before" text or
 * was contained in it, and was never used up: "Managed budget" took the
 * rewrite meant for "Managed budget of $2M across 3 regions", so the document
 * lost a real line, held one sentence twice, and the toast counted two fixes.
 *
 * The page is mounted for real; the structured parser's answer is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import { createEmptyResume } from "@/types/resume-builder";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/lib/resume-builder-export", () => ({ exportResumeBuilderPDF: async () => undefined, exportResumeBuilderDocx: async () => undefined }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const SCAN_A = "Jordan Probe\nProduct analyst. ".padEnd(120, "A");
const SCAN_B = "Jordan Probe\nSenior product analyst. ".padEnd(140, "B");
const LONG = "Managed budget of $2M across 3 regions and cut vendor spend by 12%";
const REWRITE = "Owned a $2M budget across three regions, cutting vendor spend 12% in a year";

const parsed = (name: string, bullets: string[]) => ({
  data: {
    success: true,
    contact: { fullName: name },
    experience: [{ title: "Analyst", company: "Acme", bullets }],
    education: [],
    skills: [],
  },
  error: null,
});

const draftWith = (name: string) => {
  const r = createEmptyResume();
  r.contact.fullName = name;
  return r;
};

const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(parsed("Imported Person", ["Ran the weekly report"]));
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  confirm.mockRestore();
});

describe("what the builder imports", () => {
  it("imports the scan when the saved draft is the empty one a first visit left", async () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(createEmptyResume()));
    sessionStorage.setItem("rb_resume_text", SCAN_A);
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("parse-resume-structured", { body: { resumeText: SCAN_A } }));
    expect(await screen.findByDisplayValue("Imported Person")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("saves no draft for a visit that typed nothing", () => {
    mount();
    expect(localStorage.getItem("resumeBuilderDraft")).toBeNull();
  });

  it("asks before replacing a real draft with a newer scan, and imports it on yes", async () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draftWith("Old Draft")));
    sessionStorage.setItem("rb_resume_text", SCAN_B);
    mount();
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(en.resumeBuilder.replaceWithLatestScan));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("parse-resume-structured", { body: { resumeText: SCAN_B } }));
    expect(await screen.findByDisplayValue("Imported Person")).toBeTruthy();
  });

  it("keeps the draft on no, and does not ask again about the same scan", async () => {
    confirm.mockReturnValue(false);
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draftWith("Old Draft")));
    sessionStorage.setItem("rb_resume_text", SCAN_B);
    mount();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("Old Draft")).toBeTruthy();
    cleanup();
    mount();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Old Draft")).toBeTruthy();
  });

  it("does not ask about the scan the draft was imported from", async () => {
    sessionStorage.setItem("rb_resume_text", SCAN_A);
    mount();
    await screen.findByDisplayValue("Imported Person");
    cleanup();
    invoke.mockClear();
    mount();
    expect(confirm).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Imported Person")).toBeTruthy();
  });
});

/**
 * S11-143: the builder's own "Rescan this version" wrote the draft's export
 * to the tab without marking it as the draft's source, so coming back asked
 * to replace the hand-edited draft with an AI re-parse of its own export.
 * S11-144: "Start Over" then leaving before typing re-imported (and
 * re-parsed) the scan on the next visit.
 */
describe("the builder's own loops do not re-import", () => {
  let hrefs: string[];
  beforeEach(() => {
    hrefs = [];
    const real = window.location;
    const loc: Record<string, unknown> = {};
    for (const k of ["origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const) {
      Object.defineProperty(loc, k, { get: () => real[k], enumerable: true });
    }
    Object.defineProperty(loc, "href", { get: () => real.href, set: (v: string) => { hrefs.push(v); }, enumerable: true });
    vi.stubGlobal("location", loc);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("coming back from 'Rescan this version' opens the draft without offering to replace it", async () => {
    sessionStorage.setItem("rb_resume_text", SCAN_A);
    mount();
    await screen.findByDisplayValue("Imported Person");
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    fireEvent.click(await screen.findByRole("button", { name: /rescan this version/i }));
    expect(hrefs).toEqual(["/?rescan=1#upload"]);
    expect(sessionStorage.getItem("rb_resume_text")).not.toBe(SCAN_A);
    cleanup();
    invoke.mockClear();
    confirm.mockClear();
    mount();
    expect(confirm, "the builder offered to replace the draft with a re-parse of its own export").not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Imported Person")).toBeTruthy();
  });

  it("'Start Over' sticks: leaving before typing does not re-import the scan", async () => {
    sessionStorage.setItem("rb_resume_text", SCAN_A);
    mount();
    await screen.findByDisplayValue("Imported Person");
    fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    await waitFor(() => expect(screen.queryByDisplayValue("Imported Person")).toBeNull());
    cleanup();
    invoke.mockClear();
    mount();
    expect(invoke, "the cleared builder re-imported the scan").not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Imported Person")).toBeNull();
  });

  it("the report's 'fixes applied' handoff still imports after 'Start Over'", async () => {
    sessionStorage.setItem("rb_resume_text", SCAN_A);
    mount();
    await screen.findByDisplayValue("Imported Person");
    fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    cleanup();
    invoke.mockClear();
    sessionStorage.setItem("rb_scan_fixes", JSON.stringify({ rewrites: [], keywords: ["SQL"], reportId: null }));
    mount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("parse-resume-structured", { body: { resumeText: SCAN_A } }));
  });
});

describe("how the report's rewrites land", () => {
  it("replaces only the bullet the rewrite was written for, once", async () => {
    sessionStorage.setItem("rb_resume_text", SCAN_A);
    sessionStorage.setItem("rb_scan_fixes", JSON.stringify({
      rewrites: [{ before: LONG, after: REWRITE }], keywords: [], reportId: null,
    }));
    invoke.mockResolvedValue(parsed("Imported Person", ["Managed budget", LONG, LONG]));
    mount();
    await screen.findByDisplayValue("Imported Person");
    // The short bullet is kept, the first exact match takes the rewrite, and
    // the rewrite is spent: the repeated line stays as written.
    expect(screen.getByDisplayValue("Managed budget")).toBeTruthy();
    expect(screen.getAllByDisplayValue(REWRITE)).toHaveLength(1);
    expect(screen.getAllByDisplayValue(LONG)).toHaveLength(1);
  });
});
