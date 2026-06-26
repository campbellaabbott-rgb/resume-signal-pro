import { describe, it, expect } from "vitest";
import { emailSchema, uuidSchema, resumeTextSchema } from "./security-validation";

describe("emailSchema", () => {
  it("accepts well-formed emails", () => {
    expect(emailSchema.safeParse("jane@example.com").success).toBe(true);
    expect(emailSchema.safeParse(" jane@example.com ").success).toBe(true); // trimmed
  });

  it("rejects malformed emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("missing@domain").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });

  it("rejects emails over the length limit", () => {
    const longEmail = `${"a".repeat(250)}@example.com`;
    expect(emailSchema.safeParse(longEmail).success).toBe(false);
  });
});

describe("uuidSchema", () => {
  it("accepts a valid v4-shaped UUID", () => {
    expect(uuidSchema.safeParse("123e4567-e89b-12d3-a456-426614174000").success).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("resumeTextSchema", () => {
  it("rejects text shorter than the minimum", () => {
    expect(resumeTextSchema.safeParse("too short").success).toBe(false);
  });

  it("accepts text within bounds", () => {
    expect(resumeTextSchema.safeParse("a".repeat(100)).success).toBe(true);
  });

  it("rejects text over the maximum length", () => {
    expect(resumeTextSchema.safeParse("a".repeat(50001)).success).toBe(false);
  });
});
