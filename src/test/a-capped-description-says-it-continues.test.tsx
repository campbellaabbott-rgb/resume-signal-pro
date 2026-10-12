// @vitest-environment jsdom
/**
 * A CAPPED DESCRIPTION SAYS IT CONTINUES — and a doubled one is printed once.
 *
 * The board stores at most STORED_DESC_CAP characters of a description; a copy
 * that long may stop short of the employer's posting, and the pane now says
 * where the rest is. The cap is a constant mirrored from another runtime, so
 * this file reads job-board/index.ts and fails when the two disagree.
 *
 * Feeds that hand us a body twice (audit JL6: Lever's plain body plus its
 * lists, iCIMS and Pinpoint sections) printed every paragraph twice. A line of
 * 80+ characters that already appeared verbatim is folded, and the fold is
 * disclosed in one sentence; short lines (headings, bullets) are never folded.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { PostingDescription } from "@/components/jobs/listing/PostingDescription";
import { collapseRepeatedParagraphs, descriptionMayContinue, prepareDescription, REPEAT_MIN_CHARS, STORED_DESC_CAP } from "@/lib/listing/description";

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
afterEach(cleanup);

const mount = (text: string) => render(
  <MemoryRouter>
    <PostingDescription description={{ text, state: "loaded" }} employer="Acme" applyUrl="https://boards.greenhouse.io/acme/jobs/1" />
  </MemoryRouter>,
);

describe("the cap is the edge's cap", () => {
  it("mirrors STORED_DESC_CAP in supabase/functions/job-board/index.ts", () => {
    const edge = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    const m = /^const STORED_DESC_CAP = ([\d_]+);/m.exec(edge);
    expect(m, "the edge no longer declares STORED_DESC_CAP — re-point this mirror").toBeTruthy();
    expect(Number(m![1].replace(/_/g, ""))).toBe(STORED_DESC_CAP);
  });
});

describe("a stored copy at the cap", () => {
  const atCap = "Responsibilities include close, reconciliations and audit support. ".repeat(400).slice(0, STORED_DESC_CAP);

  it("says our copy stops there and links where the posting continues", () => {
    expect(descriptionMayContinue(atCap)).toBe(true);
    mount(atCap);
    const note = document.querySelector("[data-description-capped]");
    expect(note?.textContent).toContain("Our copy stops at 12,000 characters.");
    expect(screen.getByRole("link", { name: /The posting continues on Acme's site/ }).getAttribute("href")).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });

  it("positive control: a shorter copy carries no note", () => {
    mount("We are hiring a staff accountant to own month-end close.");
    expect(document.querySelector("[data-description-capped]")).toBeNull();
    expect(descriptionMayContinue("x".repeat(STORED_DESC_CAP - 1))).toBe(false);
  });
});

describe("a body handed to us twice", () => {
  const para = "You will own the month-end close, the balance sheet reconciliations and the audit file for two entities.";
  const doubled = ["About the role", para, "", "Requirements:", "• CPA", "", "About the role", para, "", "Requirements:", "• CPA"].join("\n");

  it("folds a repeated long paragraph and keeps the repeated short lines", () => {
    expect(para.length).toBeGreaterThanOrEqual(REPEAT_MIN_CHARS);
    const { text, collapsed } = collapseRepeatedParagraphs(doubled);
    expect(collapsed).toBe(1);
    expect(text.split(para).length - 1).toBe(1);
    expect(text.split("• CPA").length - 1, "a short line is never folded").toBe(2);
  });

  it("prints it once and says one paragraph was left out", () => {
    mount(doubled);
    expect((document.body.textContent ?? "").split(para).length - 1).toBe(1);
    expect(document.querySelector("[data-description-collapsed]")?.textContent).toBe("We left out 1 paragraph that repeated another word for word.");
  });

  it("whitespace differences do not hide a repeat, and a near-repeat is not one", () => {
    expect(collapseRepeatedParagraphs(`${para}\n${para.replace(/ /g, "  ")}`).collapsed).toBe(1);
    expect(collapseRepeatedParagraphs(`${para}\n${para.replace("two", "three")}`).collapsed).toBe(0);
  });

  it("decodes entities the ingest missed, and finds the employer's own sections", () => {
    const p = prepareDescription("Intro &amp; overview\nResponsibilities\nDo things\nRequirements\nKnow things");
    expect(p.text.startsWith("Intro & overview")).toBe(true);
    expect(p.sections?.map((s) => s.title)).toEqual([null, "Responsibilities", "Requirements"]);
  });
});
