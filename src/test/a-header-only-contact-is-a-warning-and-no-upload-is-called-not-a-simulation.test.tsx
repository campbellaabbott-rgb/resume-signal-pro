/**
 * A HEADER-ONLY CONTACT IS A WARNING, AND NO UPLOAD IS CALLED "NOT A
 * SIMULATION" (RC-S13-036).
 *
 * The parse check ran on the text OUR reader pulled from the file and said,
 * for an upload, that this was "the same operation an ATS performs. Not a
 * simulation." An ATS uses its own reader, and parse-docx already found
 * résumés whose email and phone sat only in the Word page header, which some
 * ATS skip, yet the contact check passed them. Now an upload's line says the
 * checks ran on the text we extracted, in the reader's language, and a
 * contact found only in the header is a warning.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { simulateAtsParse } from "@/lib/ats-parse-simulator";
import { ATSParseSimulator } from "@/components/ATSParseSimulator";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const TEXT = [
  "Jane Doe", "jane.doe@example.com | +1 415 555 0100",
  "Summary", "Data engineer with eight years on batch and streaming pipelines.",
  "Experience", "Data Engineer, Acme Corp, Jan 2020 - Present", "- Built pipelines that moved two billion rows a day",
  "Analyst, Beta Ltd, Jun 2016 - Dec 2019", "- Cut reporting time by 40%",
  "Education", "BSc Computer Science, 2012 - 2016",
  "Skills", "SQL, Python, Spark, Airflow",
].join("\n");
const contactCheck = (r: ReturnType<typeof simulateAtsParse>) => r.checks.find((c) => /contact/i.test(`${c.id} ${c.label}`))!;

describe("the contact check", () => {
  it("is a warning when the email and phone sit only in the page header", () => {
    expect(contactCheck(simulateAtsParse(TEXT, { contactOnlyInHeader: true } as never)).status).toBe("warning");
  });
  it("still passes a contact in the body", () => {
    expect(contactCheck(simulateAtsParse(TEXT)).status).toBe("pass");
  });
});

describe("an upload's parse check", () => {
  for (const lng of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
    it(`never calls itself "not a simulation" (${lng})`, async () => {
      await speak(lng);
      const { container } = render(<ATSParseSimulator resumeText={TEXT} isActualExtraction translated />);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/Not a simulation|same operation an ATS performs/i);
      expect(text, "the line is not in the reader's language").toContain(i18n.t("freeScanPage.parseCheck.fromYourFile"));
      expect(text).not.toContain("freeScanPage.");
    });
  }
});
