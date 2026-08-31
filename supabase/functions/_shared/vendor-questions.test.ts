













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
    
    expect(qs.every((q) => q.required)).toBe(true);
    expect(qs.every((q) => q.type === "text")).toBe(true);
  });

  it("survives the HTML entity encoding the payload arrives in", () => {
    
    expect(html).toContain("&quot;");
    expect(parseBreezyQuestions(html).length).toBeGreaterThan(0);
  });

  it("returns nothing rather than guessing when there is no questionnaire", () => {
    expect(parseBreezyQuestions("<html><body>no form here</body></html>")).toEqual([]);
  });

  it("skips a questions array that is not question-shaped", () => {
    
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
    
    expect(qs).toHaveLength(18);
    expect(qs.map((q) => q.label).join(" | ")).toMatch(/salary expectations/i);
    expect(qs.map((q) => q.label).join(" | ")).toMatch(/adjustments or support/i);
  });

  it("asks a repeated question once", () => {
    
    
    
    
    const components = html.match(/data-component-name="[^"]*Form::Questions::/g) ?? [];
    expect(components).toHaveLength(19);
    const qs = parsePinpointQuestions(html);
    expect(new Set(qs.map((q) => q.label)).size).toBe(qs.length);
  });

  it("carries the required flag, which is not uniform on this form", () => {
    const qs = parsePinpointQuestions(html);
    
    
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
  
  
  
  
  it("breezy appends /apply to the posting url", () => {
    expect(breezyApplyUrl("https://wealthy-recruiting.breezy.hr/p/2ef4f0cf615f-senior-sales-manager"))
      .toBe("https://wealthy-recruiting.breezy.hr/p/2ef4f0cf615f-senior-sales-manager/apply");
  });

  it("pinpoint appends /applications/new to the posting url", () => {
    expect(pinpointApplyUrl("https://dnata.pinpointhq.com/en/postings/ac538c02-dd11-4998-a58d-74749bf58c42"))
      .toBe("https://dnata.pinpointhq.com/en/postings/ac538c02-dd11-4998-a58d-74749bf58c42/applications/new");
  });

  it("strips query, hash and trailing slash exactly as the adapters do", () => {
    
    
    const base = "https://dnata.pinpointhq.com/en/postings/ac538c02";
    for (const messy of [`${base}/`, `${base}?utm=x`, `${base}#top`, `${base}/?a=1#b`]) {
      expect(pinpointApplyUrl(messy)).toBe(`${base}/applications/new`);
    }
    expect(breezyApplyUrl("https://x.breezy.hr/p/abc/?ref=1")).toBe("https://x.breezy.hr/p/abc/apply");
  });

  it("cannot be rebuilt from a Pinpoint id, which is why it is not", () => {
    
    
    
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
