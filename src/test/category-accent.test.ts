import { describe, it, expect } from "vitest";
import { accentFor, CATEGORY_ACCENT } from "@/lib/category-accent";

// accentFor's value is interpolated straight into CSS
// (`border-left: 3px solid ${accentFor(...)}`), and category arrives from
// route params on the category lander, so the key is not fully ours to trust.
// A bare index reached Object.prototype and `??` did not catch it, because a
// function is not nullish.
describe("accentFor resists Object.prototype keys", () => {
  for (const c of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    it(`returns a colour string for "${c}"`, () => {
      const v = accentFor(c);
      expect(typeof v).toBe("string");
      expect(v).not.toMatch(/\[native code\]/);
      expect(v).toBe(CATEGORY_ACCENT.other);
    });
  }

  it("still resolves real categories and the null default", () => {
    expect(accentFor("engineering")).toBe(CATEGORY_ACCENT.engineering);
    expect(accentFor(null)).toBe(CATEGORY_ACCENT.other);
    expect(accentFor("not_a_category")).toBe(CATEGORY_ACCENT.other);
  });
});
