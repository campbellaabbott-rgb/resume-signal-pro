/**
 * THE TAILORED-RÉSUMÉ EXPORT ROW FITS A PHONE, AND SAYS WHAT IT SAVED.
 *
 * S12-111: the Word and PDF buttons sat in a row that could not wrap; in six
 * locales the labels measured 452px against a 375px phone and pushed the page
 * sideways. The row and its buttons wrap.
 * S12-006 / S12-030 (the page's half): a résumé the PDF fonts cannot draw is
 * saved as a Word file and the person is told why; a résumé with no name is
 * refused with a request for the name, never exported as "Your Name".
 *
 * Mounted for real; only the toast and the exporter's file save are observed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
const saved = { docx: 0, pdf: 0 };
vi.mock("@/lib/resume-builder-export", async (orig) => {
  const real = await orig<typeof import("@/lib/resume-builder-export")>();
  return {
    ...real,
    // The real decision (missing name, unsupported characters); only the file save is counted.
    exportResumeBuilderDocx: async (r: Parameters<typeof real.buildResumeDocxDocument>[0]) => { await real.buildResumeDocxDocument(r); saved.docx++; },
    exportResumeBuilderPDF: async (r: Parameters<typeof real.buildResumePdf>[0]) => {
      if (!r.contact.fullName?.trim()) throw new real.ResumeExportError("missing_name");
      const unsupported = real.resumePdfUnsupported(r);
      if (unsupported.length) { saved.docx++; return { format: "docx", unsupported }; }
      await real.buildResumePdf(r); saved.pdf++; return { format: "pdf" };
    },
  };
});

import { ApplyAssistantResults, type ApplyPackageData } from "@/components/ApplyAssistantResults";
import { normalizeBuilderResume } from "@/types/resume-builder";

afterEach(() => { cleanup(); toast.mockReset(); saved.docx = 0; saved.pdf = 0; });

const data = (fullName: string): ApplyPackageData => ({
  jobMetadata: { company: "Initech", roleTitle: "Engineer", applyMethodHint: "" },
  tailoredResume: normalizeBuilderResume({
    contact: { fullName, title: "Engineer", email: "a@e.com", phone: "", location: "", linkedIn: "", website: "" },
    summary: "Engineer.", experience: [], education: [], skills: ["Go"], certifications: [],
  }),
  skillGaps: [], checklist: [],
});

describe("the export row", () => {
  it("wraps, row and buttons both", () => {
    render(<ApplyAssistantResults data={data("Sam Park")} />);
    const row = screen.getByTestId("apply-export-row");
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect((row.lastElementChild as HTMLElement).className).toMatch(/\bflex-wrap\b/);
    expect(row.querySelectorAll("button").length).toBe(2);
  });
});

describe("what the PDF button saves", () => {
  it("a name the PDF fonts cannot draw: the Word file, and a toast naming the character", async () => {
    render(<ApplyAssistantResults data={data("Łukasz Wójcik")} />);
    fireEvent.click(screen.getAllByRole("button").at(-1)!);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(saved).toEqual({ docx: 1, pdf: 0 });
    expect(JSON.stringify(toast.mock.calls[0][0])).toMatch(/Word/);
    expect(JSON.stringify(toast.mock.calls[0][0])).toContain("Ł");
  });

  it("no name: nothing saved, and the person is asked for their name", async () => {
    render(<ApplyAssistantResults data={data("")} />);
    fireEvent.click(screen.getAllByRole("button").at(-1)!);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(saved).toEqual({ docx: 0, pdf: 0 });
    expect(JSON.stringify(toast.mock.calls[0][0])).toMatch(/name/i);
  });

  it("a name it can draw: the PDF, with no warning", async () => {
    render(<ApplyAssistantResults data={data("Sam Park")} />);
    fireEvent.click(screen.getAllByRole("button").at(-1)!);
    await waitFor(() => expect(saved.pdf).toBe(1));
    expect(toast).not.toHaveBeenCalled();
  });
});
