/**
 * THE PAID AUTO-FIX TURNED "GOOD FORTUNE" INTO "GOOD FORTUNE 500" (sweep S8-066).
 *
 * Both copies of the Premium Package auto-fix (server auto-fix.ts and the
 * browser's content-autofix.ts) replaced every "Fortune" not followed by a
 * number with "Fortune 500" whenever the source mentioned Fortune 500, and
 * every "/CD" with "CI/CD" whenever the text had no CI/CD. Buyers submitted
 * documents saying "the good Fortune 500 to lead", "Fortune 500 Global 500"
 * and "DVDCI/CD".
 */
import { describe, expect, it } from "vitest";
import { autoFixContent as clientFix } from "@/lib/content-autofix";
import { autoFixContent as serverFix } from "../../supabase/functions/generate-premium-package/auto-fix";

const SOURCE = "Sold to Fortune 500 accounts. Built DVD/CD authoring tools.";

describe.each([
  ["server", (c: string, o: string) => serverFix(c, o).fixed],
  ["browser", (c: string, o: string) => clientFix(c, o).fixed],
])("the %s auto-fix", (_name, fix) => {
  it("leaves the word fortune and the Fortune Global 500 alone", () => {
    const draft = "I had the good fortune to lead sales into Fortune Global 500 accounts.";
    expect(fix(draft, SOURCE)).toBe(draft);
  });

  it("leaves DVD/CD alone", () => {
    const draft = "Built DVD/CD authoring tools.";
    expect(fix(draft, SOURCE)).toBe(draft);
  });

  it("still repairs the exact truncation including/CD", () => {
    expect(fix("Pipelines including/CD on GitHub Actions.", SOURCE)).toBe("Pipelines including CI/CD on GitHub Actions.");
  });
});
