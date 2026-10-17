// @vitest-environment node
/**
 * EVERY BUNDLE OF THE CREDIT MODULE CARRIES THIS ROUND'S BUILD (wave 4, round
 * 2, payments-delivery; S12-154 and S12-103).
 *
 * _shared/scan-credits.ts changed in this round: a purchase an account claimed
 * answers only that account (the redeem call names p_user_id, which only the
 * 20261011141000 function takes), and a pack whose address is only in
 * customer_details is found by buyerEmailOf. A function is deployed as a
 * bundle, so every function that imports the module changed with it, and a
 * build string may name only one version of the code (the ledger's --against
 * rule, which fails the integration otherwise). An old free-keyword-scan
 * bundle left in place after the migration would refuse every claimed pack on
 * the scanner: the migration is applied first, so the scanner that passes
 * p_user_id must be in the same deploy, under a stamp the verifier asks for.
 *
 * R1 stamped these functions 2026-10-14.1 and deploys first; this round keeps
 * R1's day with its own sequence (22), as it does for verify-product-purchase
 * and scan-credits, so the stamps stay in order after R1 is live.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIsAtLeast } from "./helpers/fn-build";

const ROOT = resolve(__dirname, "../..");
const FUNCTIONS = resolve(ROOT, "supabase/functions");
const SECTION = resolve(ROOT, "scripts/verify-deploy.d/92-w4b-payments-delivery.sh");

/** Every function whose index.ts imports the credit module (the bundles that changed). */
function importersOfCreditModule(): string[] {
  return readdirSync(FUNCTIONS)
    .filter((d) => !d.startsWith("_") && statSync(join(FUNCTIONS, d)).isDirectory())
    .filter((d) => {
      try { return /from\s+"\.\.\/_shared\/scan-credits\.ts"/.test(readFileSync(join(FUNCTIONS, d, "index.ts"), "utf8")); } catch { return false; }
    })
    .sort();
}

function stampOf(fn: string): string | null {
  const src = readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8");
  return src.match(/^const FN_BUILD = "([^"]+)";/m)?.[1] ?? null;
}

describe("every function that bundles _shared/scan-credits.ts is stamped for this round", () => {
  const importers = importersOfCreditModule();

  it("the importer list is the one this test reasons about", () => {
    expect(importers).toEqual(["free-keyword-scan", "get-account-data", "scan-credits"]);
  });

  it.each(importers)("%s carries a build of 2026-10-14.22 or later", (fn) => {
    const stamp = stampOf(fn);
    expect(stamp, `${fn}/index.ts has no literal FN_BUILD line`).not.toBeNull();
    expect(
      buildIsAtLeast(stamp, fn, "2026-10-14", 22),
      `${fn} is stamped ${stamp}: its bundle carries the changed credit module under a build string an older bundle already answers`,
    ).toBe(true);
  });

  it("the payments-delivery verifier section asks for each of them at that floor", () => {
    const sh = readFileSync(SECTION, "utf8");
    const loop = sh.match(/for VD92_FN in ([^;\n]+); do\n(?:[^\n]*\n){1,2}[^\n]*build_ge "\$VD92_FN" "\$VD92_H" "2026-10-14" "22"/);
    expect(loop, "no loop in section 92 asks for a 2026-10-14.22 build").not.toBeNull();
    const asked = loop![1].trim().split(/\s+/).sort();
    for (const fn of importers) expect(asked, `section 92's 2026-10-14.22 loop does not ask for ${fn}`).toContain(fn);
  });
});
