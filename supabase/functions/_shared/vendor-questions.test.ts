/**
 * The Breezy and Pinpoint question parsers, against REAL captured HTML.
 *
 * The fixtures are the actual bytes those two employers served on 2026-08-01,
 * trimmed to the relevant markup. A parser tested only against HTML I wrote
 * myself would prove that I can write HTML matching my own regex.
 *
 * The negative cases carry the weight. A harvester that returns [] on a form it
 * cannot read is honest — apply-agent falls back to the generic questions and
 * the worker still refuses, which is where we already are. A harvester that
 * returns the WRONG questions is far worse: the packet would carry confident
 * answers to questions the employer never asked, and the candidate would never
 * see it happen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseBreezyQuestions, parsePinpointQuestions,
  breezyApplyUrl, pinpointApplyUrl,
} from "./vendor-questions";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(resolve(here, "__fixtures__", n), "utf8");

describe("Breezy", () => {
  const html = fixture("breezy-apply.html");

  it("reads the four real questions the employer asked", () => {
    const qs = parseBreezyQuestions(html);
    expect(qs).toHaveLength(4);
    expect(qs[0].label).toMatch(/Walk me through your last role/);
    expect(qs[1].label).toMatch(/average close rate/);
    // These are the exact blockers the live dry run refused on.
    expect(qs.every((q) => q.required)).toBe(true);
    expect(qs.every((q) => q.type === "text")).toBe(true);
  });

  it("survives the HTML entity encoding the payload arrives in", () => {
    // The whole array is inside an attribute, so every quote is &quot;.
    expect(html).toContain("&quot;");
    expect(parseBreezyQuestions(html).length).toBeGreaterThan(0);
  });

  it("returns nothing rather than guessing when there is no questionnaire", () => {
    expect(parseBreezyQuestions("<html><body>no form here</body></html>")).toEqual([]);
  });

  it("skips a questions array that is not question-shaped", () => {
    // A nav menu that happens to use the same key must not become a form.
    const decoy = '<div data-x=\'{"questions":["Home","About"]}\'></div>';
    expect(parseBreezyQuestions(decoy)).toEqual([]);
  });

  it("fails closed on a truncated payload rather than half-parsing it", () => {
    const cut = html.slice(0, html.indexOf("average close rate"));
    expect(parseBreezyQuestions(cut)).toEqual([]);
  });
});

describe("Pinpoint", () => {
  const html = fixture("pinpoint-apply.html");

  it("reads every question component off the apply route", () => {
    const qs = parsePinpointQuestions(html);
    // 19 components, 18 questions — see the de-duplication test below.
    expect(qs).toHaveLength(18);
    expect(qs.map((q) => q.label).join(" | ")).toMatch(/salary expectations/i);
    expect(qs.map((q) => q.label).join(" | ")).toMatch(/adjustments or support/i);
  });

  it("asks a repeated question once", () => {
    // Not hypothetical: dnata's live form carries the adjustments question in
    // TWO components. Passing both through would put the same question in front
    // of the candidate twice and, once drafting is wired up, spend two model
    // calls to produce the same answer.
    const components = html.match(/data-component-name="[^"]*Form::Questions::/g) ?? [];
    expect(components).toHaveLength(19);
    const qs = parsePinpointQuestions(html);
    expect(new Set(qs.map((q) => q.label)).size).toBe(qs.length);
  });

  it("carries the required flag, which is not uniform on this form", () => {
    const qs = parsePinpointQuestions(html);
    // Both states genuinely occur here; if every question came back required
    // (or none did) the flag would not be being read at all.
    expect(qs.some((q) => q.required)).toBe(true);
    expect(qs.some((q) => !q.required)).toBe(true);
  });

  it("keeps the vendor's own type so the classifier can use it", () => {
    const types = new Set(parsePinpointQuestions(html).map((q) => q.type));
    expect(types.has("long_text")).toBe(true);
    expect(types.has("boolean")).toBe(true);
  });

  it("ignores react components that are not questions", () => {
    const notAQuestion = '<script type="application/json" class="js-react-on-rails-component" '
      + 'data-component-name="Shared::Header::Nav">{"questionDetails":{"title":"Home"}}</script>';
    expect(parsePinpointQuestions(notAQuestion)).toEqual([]);
  });

  it("survives a malformed component without losing the good ones", () => {
    const broken = '<script type="application/json" class="js-react-on-rails-component" '
      + 'data-component-name="Shared::Form::Questions::Longtext">{not json</script>';
    expect(parsePinpointQuestions(broken + html)).toHaveLength(18);
  });
});

describe("the apply URL comes from the posting, never from the id", () => {
  // The first version composed the path from (token, externalId). It worked on
  // Breezy and 404'd on 8 of 8 live Pinpoint boards: Pinpoint's id is numeric
  // (505393) and its apply path is an unrelated UUID (ac538c02-...). Live
  // measurement caught it; this test is what should have.
  it("breezy appends /apply to the posting url", () => {
    expect(breezyApplyUrl("https://wealthy-recruiting.breezy.hr/p/2ef4f0cf615f-senior-sales-manager"))
      .toBe("https://wealthy-recruiting.breezy.hr/p/2ef4f0cf615f-senior-sales-manager/apply");
  });

  it("pinpoint appends /applications/new to the posting url", () => {
    expect(pinpointApplyUrl("https://dnata.pinpointhq.com/en/postings/ac538c02-dd11-4998-a58d-74749bf58c42"))
      .toBe("https://dnata.pinpointhq.com/en/postings/ac538c02-dd11-4998-a58d-74749bf58c42/applications/new");
  });

  it("strips query, hash and trailing slash exactly as the adapters do", () => {
    // resolveFormUrl in both adapters does the same two replaces. If these
    // diverge, we harvest one URL and fill another.
    const base = "https://dnata.pinpointhq.com/en/postings/ac538c02";
    for (const messy of [`${base}/`, `${base}?utm=x`, `${base}#top`, `${base}/?a=1#b`]) {
      expect(pinpointApplyUrl(messy)).toBe(`${base}/applications/new`);
    }
    expect(breezyApplyUrl("https://x.breezy.hr/p/abc/?ref=1")).toBe("https://x.breezy.hr/p/abc/apply");
  });

  it("cannot be rebuilt from a Pinpoint id, which is why it is not", () => {
    // The numeric id appears nowhere in the apply path — a composed URL is a
    // 404, and a 404 harvests nothing while looking like "this form has no
    // questions".
    const url = pinpointApplyUrl("https://dnata.pinpointhq.com/en/postings/ac538c02-dd11-4998-a58d-74749bf58c42");
    expect(url).not.toContain("505393");
  });

  it("these are the routes the worker's adapters build", () => {
    const pinpoint = readFileSync(resolve(here, "../../../worker/src/vendors/pinpoint.ts"), "utf8");
    const breezy = readFileSync(resolve(here, "../../../worker/src/vendors/breezy.ts"), "utf8");
    expect(pinpoint).toContain("/applications/new");
    expect(breezy).toMatch(/\/apply/);
  });
});
