/**
 * A LAYOUT THE SCAN NEVER SAW IS NOT CERTIFIED TO ANY ATS (register S13-036).
 *
 * computeVendorChecks read `!!multiColumnDetected`, so "not checked" counted
 * as "single column": a pasted résumé or a Word file (the page sets
 * multiColumnDetected undefined for both) was told "Single-column, standard
 * bullets — parses cleanly in Workday", and the findings index counted
 * Workday, Greenhouse and iCIMS as passed, for a layout nobody looked at.
 * hasTables was declared and never read.
 *
 * Now a vendor whose verdict depends on the layout is "not checked" when the
 * layout is unknown; Lever, judged on headers in the text, is unchanged. A
 * table counts as a layout risk the same as columns. The card and the
 * findings index say "not checked" in the reader's language and never count
 * it as a pass.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import { AtsVendorChecksCard, FindingsIndex, computeVendorChecks } from "@/components/ReportInsightCards";

const de = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/de.json"), "utf8"));
const CLEAN = "Jordan Probe\nEXPERIENCE\nOffice Coordinator, 2019 - Present\n- Scheduled 40 appointments a week\nEDUCATION\nBA, 2018\n";
const byVendor = (rows: ReturnType<typeof computeVendorChecks>) => Object.fromEntries(rows.map((r) => [r.vendor, r.status]));

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("the verdicts", () => {
  it("a layout never checked certifies nothing that depends on it", () => {
    expect(byVendor(computeVendorChecks({ resumeText: CLEAN }))).toEqual({
      Workday: "unknown", Greenhouse: "unknown", Lever: "pass", iCIMS: "unknown",
    });
  });

  it("a checked single-column PDF still passes", () => {
    expect(byVendor(computeVendorChecks({ resumeText: CLEAN, multiColumnDetected: false }))).toEqual({
      Workday: "pass", Greenhouse: "pass", Lever: "pass", iCIMS: "pass",
    });
  });

  it("columns, or a table, are a layout risk", () => {
    for (const facts of [{ multiColumnDetected: true }, { hasTables: true }, { multiColumnDetected: false, hasTables: true }]) {
      const v = byVendor(computeVendorChecks({ resumeText: CLEAN, ...facts }));
      expect(v.Workday, JSON.stringify(facts)).toBe("fail");
      expect(v.Greenhouse).toBe("warn");
      expect(v.iCIMS).toBe("warn");
    }
  });

  it("a risk the text itself shows is still reported when the layout is unknown", () => {
    const v = byVendor(computeVendorChecks({ resumeText: CLEAN + "Skills\t\tExcel\t\tWord\n" }));
    expect(v.Workday).toBe("warn");
    expect(v.iCIMS).toBe("warn");
  });
});

describe("the card and the index", () => {
  it("say 'not checked', never a pass, for an unknown layout", () => {
    const { container } = render(<AtsVendorChecksCard resumeText={CLEAN} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("parses cleanly in Workday");
    expect(container.querySelectorAll('[data-vendor-status="unknown"]').length).toBe(3);
    expect(text).toContain(en.reportInsights.vendor.uncheckedNote);
  });

  it("the index counts an unchecked finding apart from the passes", () => {
    const { container } = render(<FindingsIndex findings={[
      { severity: "pass", label: "Core sections present" },
      { severity: "unchecked", label: "Workday parsing: layout not checked" },
    ]} />);
    expect(container.querySelector("[data-findings-passed]")?.textContent).toBe(i18n.t("reportInsights.findings.passed", { count: 1 }));
    expect(container.querySelector("[data-findings-unchecked]")?.textContent).toBe(i18n.t("reportInsights.findings.unchecked", { count: 1 }));
  });

  it("are written in the reader's language", async () => {
    i18n.addResourceBundle("de", "translation", de, true, true);
    await i18n.changeLanguage("de");
    const { container } = render(<>
      <AtsVendorChecksCard resumeText={CLEAN} multiColumnDetected={true} />
      <FindingsIndex findings={[{ severity: "warning", label: "x" }]} />
    </>);
    const text = container.textContent ?? "";
    for (const s of ["How the big ATS platforms read this resume", "Findings at a glance", "Multi-column layouts scramble", "warning", "passed"]) {
      expect(text.includes(s), `"${s}" in German`).toBe(false);
    }
    expect(text).toContain(de.reportInsights.vendor.title);
    expect(text).toContain(de.reportInsights.findings.title);
  });
});
