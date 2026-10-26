/**
 * THE TOAST NOTE SAYS HOW SONNER ANNOUNCES (regression review of 3ebdcbb2).
 *
 * use-toast.ts and the design README said a destructive toast "becomes
 * sonner's error toast, which sonner announces assertively". Measured: with
 * create-product-checkout returning 500, /pricing's "Server error — Stripe is
 * unavailable right now" sat inside a SECTION with aria-live=polite, and
 * "polite" is the only aria-live value in sonner's bundle. So every toast is
 * announced politely (as the Radix toaster's role=status toasts were), and
 * the notes now say so. This guard reads the installed sonner and the notes,
 * so an upgrade that adds an assertive region makes the note stale loudly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SONNER = readFileSync(resolve(ROOT, "node_modules/sonner/dist/index.mjs"), "utf8");
const HOOK = readFileSync(resolve(ROOT, "src/hooks/use-toast.ts"), "utf8");
const README = readFileSync(resolve(ROOT, "docs/design-upgrade/README.md"), "utf8");

describe("sonner has one polite live region", () => {
  it("the installed bundle names aria-live polite and nothing assertive", () => {
    const values = [...SONNER.matchAll(/aria-live["']?\s*[:=]\s*["'](\w+)["']/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values)).toEqual(new Set(["polite"]));
    expect(SONNER).not.toMatch(/role["']?\s*[:=]\s*["']alert["']/);
  });

  it("the hook's note and the README say polite, and claim no assertive announcement", () => {
    expect(HOOK).toMatch(/NOT announced assertively/);
    expect(HOOK).not.toMatch(/which sonner announces\s+assertively/);
    expect(README).not.toMatch(/sonner announces assertively/);
    expect(README).toMatch(/announced politely/);
  });
});
