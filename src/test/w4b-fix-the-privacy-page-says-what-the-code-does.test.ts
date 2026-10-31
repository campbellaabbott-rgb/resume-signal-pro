// @vitest-environment node
/**
 * THE PRIVACY PAGE SAYS WHAT THE CODE DOES (wave 4 round 2 review, security
 * and coverage lenses).
 *
 * WHAT WAS WRONG.
 *   - The page said ipinfo receives only a free scan's IP while wave 4 made
 *     every Full Analysis and Pro checkout send the buyer's IP to ipinfo.io
 *     for its sales-territory check, undisclosed. That check is gone (owner,
 *     2026-10-27, on the EU, the EEA, the UK and India: "keep selling as
 *     today"), so no checkout sends ipinfo anything and the line says the
 *     free scan only, as it did before the check.
 *   - The cookie paragraph said nothing is sent for analytics before the
 *     visitor chooses, while Lovable's injected page counter still posts until
 *     the owner switches it off: the sentence now speaks for our own analytics.
 *   - Section 6 and the delete card said generated documents are kept until
 *     you ask; deleting an account now erases them (20261011210000), and the
 *     card's list says so.
 *
 * WHAT HOLDS NOW. Each sentence is pinned AND its path is checked: the free
 * scan asks ipinfo.io, and no checkout does.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const privacy = read("src/pages/Privacy.tsx");

describe("ipinfo is disclosed for what it is asked: a free scan's country", () => {
  it("the processors list names the free scan, and no purchase-time lookup", () => {
    const line = /<li data-ipinfo>([^<]+)<\/li>/.exec(privacy)?.[1] ?? "";
    expect(line).toMatch(/free scan/);
    expect(line).not.toMatch(/purchase|tax/);
  });

  it("the path: the free scan asks ipinfo.io, and no checkout does", () => {
    expect(read("supabase/functions/free-keyword-scan/index.ts")).toMatch(/https:\/\/ipinfo\.io\//);
    for (const fn of ["create-checkout", "create-subscription-checkout", "create-product-checkout"]) {
      expect(codeOf(read(`supabase/functions/${fn}/index.ts`)), fn).not.toMatch(/ipinfo/i);
    }
    expect(existsSync(resolve(__dirname, "../..", "supabase/functions/_shared/sales-territory.ts"))).toBe(false);
  });
});

describe("the cookie paragraph speaks for our own analytics only", () => {
  it("it no longer says nothing at all is sent before the choice, and still names the host's counter", () => {
    expect(privacy).not.toMatch(/Until you choose, nothing is stored or sent for analytics/);
    expect(privacy).toMatch(/Until you choose, our own analytics stores and sends nothing/);
    expect(privacy).toMatch(/hosting provider runs its own page-visit counter/);
  });
});

describe("deleting an account erases the documents made for it", () => {
  it("section 6 and the delete card say so, and the eraser does it", () => {
    expect(privacy).toMatch(/deleting an account erases the documents made for its purchases/);
    const card = read("src/components/account/DataPrivacyCard.tsx");
    expect(card).toMatch(/accountPrivacy\.deletedListDocs", "[^"]*the documents we made for your purchases/);
    expect(card).not.toMatch(/"accountPrivacy\.deletedList"/);
    expect(read("supabase/migrations/20261011210000_a_deleted_account_takes_the_documents_made_for_it_and_its_pro_grants.sql")).toMatch(/DELETE FROM public\.purchased_content/);
  });
});
