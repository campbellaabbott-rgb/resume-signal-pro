/**
 * A FIX TIME AND A KEYWORD IMPORTANCE ARE SHOWN IN THE READER'S LANGUAGE
 * (register S11-149, a side effect of the S8-034 fix c9256067).
 *
 * Wave 3's language instruction keeps every fixed choice in English, so the
 * pages can pick colours by them. The Career Snapshot's fix time ("15
 * minutes") and the Keyword Fix importance ("critical") are fixed choices in
 * their prompts, but no page translated them, so they printed in English
 * inside translated paid reports. They are now in the enum-label map, in all
 * nine locales.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { useReportEnumLabel } from "@/hooks/use-report-enum-label";
import { CareerSnapshotResults } from "@/components/CareerSnapshotResults";

const LOCALES = resolve(__dirname, "../../src/i18n/locales");
const es = JSON.parse(readFileSync(resolve(LOCALES, "es.json"), "utf8"));

afterEach(async () => { await i18n.changeLanguage("en"); });

async function spanish() {
  i18n.addResourceBundle("es", "translation", es, true, true);
  await i18n.changeLanguage("es");
}

describe("the fixed choices the prompts keep in English", () => {
  it("each fix time and each lowercase importance has a label in every locale", () => {
    for (const file of readdirSync(LOCALES).filter((f) => f.endsWith(".json"))) {
      const labels = JSON.parse(readFileSync(resolve(LOCALES, file), "utf8")).careerReportEnum as Record<string, string>;
      for (const k of ["fiveMinutes", "fifteenMinutes", "thirtyMinutes", "critical", "high", "medium"]) {
        expect(typeof labels[k] === "string" && labels[k].trim().length > 0, `${file} careerReportEnum.${k}`).toBe(true);
      }
    }
  });

  it("the label hook reads them in the reader's language", async () => {
    await spanish();
    const { result } = renderHook(() => useReportEnumLabel());
    expect(result.current("15 minutes")).toBe(es.careerReportEnum.fifteenMinutes);
    expect(result.current("critical")).toBe(es.careerReportEnum.critical);
    expect(result.current("high")).toBe(es.careerReportEnum.high);
    expect(result.current("medium")).toBe(es.careerReportEnum.medium);
    expect(result.current("15 minutos")).toBe("15 minutos");
  });

  it("a Spanish Career Snapshot prints its fix time in Spanish", async () => {
    await spanish();
    render(<CareerSnapshotResults data={{
      careerSignalScore: {
        overall: "Strong",
        performanceSignal: { score: "Strong", summary: "Supera la cuota." },
        trajectorySignal: { score: "Growth", summary: "Dos ascensos." },
        credibilitySignal: { score: "High", summary: "Permanencias largas." },
        seniorityAlignment: { currentLevel: "Senior", targetFit: "Aligned", summary: "Encaja." },
      },
      recruiterPerception: { summary: "Una ingeniera sénior sólida." },
      topStrengths: [{ strength: "Pagos", evidence: "Migró los pagos." }],
      careerRisks: [{ risk: "Sin reportes", recruiterQuestion: "¿Lideró?", mitigation: "Mentoría." }],
      positioningGuidance: { idealPositioning: "IC sénior.", rolesToTarget: ["Staff"], rolesToAvoid: ["Gerente"], companyStages: ["Serie B"], storyFraming: "Multiplicadora." },
      priorityFixes: [{ fix: "Añadir mentoría", impact: "Muestra liderazgo", timeEstimate: "15 minutes" }],
    }} />);
    // The fixes section opens on a click on its heading.
    fireEvent.click(screen.getByText(es.careerSnapshot.priorityFixes.title));
    expect(screen.getAllByText(es.careerReportEnum.fifteenMinutes).length).toBeGreaterThan(0);
    expect(screen.queryByText("15 minutes")).toBeNull();
  });
});
