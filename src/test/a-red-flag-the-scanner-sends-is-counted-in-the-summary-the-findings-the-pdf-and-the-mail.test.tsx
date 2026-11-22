/**
 * A RED FLAG THE SCANNER SENDS IS COUNTED IN THE SUMMARY, THE FINDINGS, THE
 * PDF AND THE MAIL (sweep SCAN-01).
 *
 * The scanner sends each red flag as { issue, impact, severity }. The report's
 * one findings list read a flag's sentence from `title` or `flag` only, found
 * neither, and dropped every flag: the summary line, the Findings index, the
 * downloaded PDF and the mailed report all said 0 critical over a report whose
 * Red Flags card listed a critical one. A flag shaped as the scanner sends it
 * is now one critical finding in all four places.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
const seen = vi.hoisted(() => ({ mail: [] as Array<Record<string, unknown>>, drawn: [] as string[], saved: 0 }));
vi.mock("@/components/EmailReportCapture", () => ({
  EmailReportCapture: (p: { payload: Record<string, unknown> }) => { seen.mail.push(p.payload); return null; },
}));
vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 595 } };
    setFontSize() {}
    setFont() {}
    setTextColor() {}
    splitTextToSize(text: string) { return [text]; }
    text(lines: string[] | string) { seen.drawn.push(...(Array.isArray(lines) ? lines : [lines])); }
    save() { seen.saved += 1; }
  },
}));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";

vi.setConfig(MOUNT_TEST_BUDGET);

beforeEach(async () => {
  seen.mail = []; seen.drawn = []; seen.saved = 0;
  localStorage.clear();
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

const FLAG = "Two years between roles with no explanation";

function renderReport() {
  return render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="data_engineering" atsScoreEstimate={64} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        // Exactly as free-keyword-scan sends it: the sentence is `issue`.
        redFlags={[{ issue: FLAG, impact: "Recruiters ask about it first", severity: "critical" }]}
        keywords={[]}
        resumeText={"Jordan Probe\nData Engineer, Acme Corp, 2019 - Present\n- Built pipelines that moved two billion rows a day\n".repeat(2)}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        contactInfo={{ hasEmail: true, hasPhone: true, hasLinkedIn: true, missingItems: [] } as never}
        reportVerdict="complete"
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("a red flag shaped as the scanner sends it", () => {
  it("is one critical finding in the summary line and in the Findings index", () => {
    const { container } = renderReport();
    const summary = container.querySelector("[data-report-summary]")?.textContent ?? "";
    expect(summary).toContain(i18n.t("freeResults.enterprise.summaryLine", { score: 64, critical: 1, warnings: 0, passed: 0 }).split(":")[0]);
    expect(summary, "the summary counts the flag").toMatch(/\b1 critical\b/);
    const index = container.querySelector("[data-findings-critical]")?.textContent ?? "";
    expect(index).toBe(i18n.t("reportInsights.findings.critical", { count: 1 }));
    expect(container.textContent).toContain(FLAG);
  });

  it("is counted and named in the downloaded PDF", async () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("freeResults.enterprise.downloadPdf", "Download PDF summary") }));
    await waitFor(() => expect(seen.saved).toBe(1), SLOW);
    const findingsLine = seen.drawn.find((l) => l.startsWith("Findings:")) ?? "";
    expect(findingsLine).toMatch(/^Findings: 1 critical/);
    expect(seen.drawn).toContain(`[x]  ${FLAG}`);
  });

  it("is counted in the mailed report, whose issue line is the scanner's own", () => {
    renderReport();
    expect(seen.mail.length).toBeGreaterThan(0);
    for (const payload of seen.mail) {
      expect((payload.findingsSummary as { critical: number }).critical).toBe(1);
      expect(payload.redFlags).toEqual([{ issue: FLAG }]);
    }
  });

  it("an older reply's title or flag field is still read when there is no issue", () => {
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="data_engineering" atsScoreEstimate={64} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[{ title: FLAG, severity: "critical" } as never, { flag: "Second flag", severity: "critical" } as never]}
          keywords={[]}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          contactInfo={{ hasEmail: true, hasPhone: true, hasLinkedIn: true, missingItems: [] } as never}
          reportVerdict="complete"
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-findings-critical]")?.textContent).toBe(i18n.t("reportInsights.findings.critical", { count: 2 }));
  });
});
