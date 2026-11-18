/**
 * AN IMPORT THAT APPLIED NONE OF THE REPORT'S REWRITES SAYS SO (S14X-286: C-S14-137).
 *
 * WHAT WAS WRONG. "Open in builder with fixes applied" promises the report's
 * rewrites. When the import landed and none of them matched a bullet the
 * model extracted, the toast said only "Resume imported", the same as an
 * import with no fixes at all: the person was left to believe the fixes were
 * in. (S13-126 fixed only the path where the person keeps their draft.)
 *
 * WHAT HOLDS NOW. When the hand-off carried usable rewrites and none landed,
 * the toast says none of the report's N rewrites matched, and that they are
 * still in the report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const { invoke, toast } = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast: (...a: unknown[]) => toast(...a) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const SCAN = "Jordan Probe\nProduct analyst at Acme. ".padEnd(160, "A");
const parsed = { data: { success: true, contact: { fullName: "Imported Person" }, experience: [{ title: "Analyst", company: "Acme", bullets: ["Ran the weekly report"] }], education: [], skills: [] }, error: null };
const mount = () => render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
const handoff = (rewrites: Array<{ before: string; after: string }>) =>
  sessionStorage.setItem("rb_scan_fixes", JSON.stringify({ rewrites, keywords: [], reportId: null }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
  toast.mockReset();
  invoke.mockResolvedValue(parsed);
  sessionStorage.setItem("rb_resume_text", SCAN);
});
afterEach(() => cleanup());

describe("the toast after an import with the report's rewrites", () => {
  it("names none of one rewrite", async () => {
    handoff([{ before: "Managed a budget that is not in this résumé at all", after: "Owned a $2M budget across three regions" }]);
    mount();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t("builderPage.importedNoneMatchedTitle"),
      description: i18n.t("builderPage.importedNoneMatchedDescription", { count: 1 }),
    }));
  });

  it("names none of three, counting only rewrites that could be applied", async () => {
    handoff([
      { before: "First bullet that is not here", after: "Rewritten first" },
      { before: "Second bullet that is not here", after: "Rewritten second" },
      { before: "Third bullet that is not here", after: "Rewritten third" },
      { before: "A template the scan could not ground", after: "Led [what you did] for [who]" },
    ]);
    mount();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const said = toast.mock.calls[0][0] as { description: string };
    expect(said.description).toBe(i18n.t("builderPage.importedNoneMatchedDescription", { count: 3 }));
    expect(said.description).toContain("3");
  });

  it("still says how many landed when some did", async () => {
    handoff([{ before: "Ran the weekly report", after: "Owned the weekly report for four teams" }]);
    mount();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t("resumeBuilder.toast.importedWithFixesTitle", { count: 1 }) }));
  });

  it("an import with no rewrites says only that it was imported", async () => {
    mount();
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: i18n.t("resumeBuilder.toast.importedTitle") }));
  });
});
