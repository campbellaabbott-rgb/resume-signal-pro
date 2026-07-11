// The crash that took down real users' reports: detectedLanguage arrived in
// shapes older engine versions cached (string, object without code). Every
// shape must render-or-hide — never throw.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ResumeLanguageSuggestion } from "../components/ResumeLanguageSuggestion";

describe("ResumeLanguageSuggestion payload shapes", () => {
  const shapes: Array<[string, unknown]> = [
    ["object without code (the production crash)", { name: "English" }],
    ["object with null code", { code: null, name: "Spanish" }],
    ["plain string code", "es"],
    ["empty object", {}],
    ["null", null],
    ["undefined", undefined],
    ["well-formed object", { code: "de", name: "German" }],
  ];
  for (const [label, shape] of shapes) {
    it(`does not throw for ${label}`, () => {
      expect(() =>
        render(<ResumeLanguageSuggestion detectedLanguage={shape as never} />),
      ).not.toThrow();
    });
  }
});
