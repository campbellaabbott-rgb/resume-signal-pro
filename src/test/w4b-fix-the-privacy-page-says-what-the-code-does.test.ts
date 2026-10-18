// @vitest-environment node
/**
 * THE PRIVACY PAGE SAYS WHAT THE CODE DOES (wave 4 round 2 review, security
 * and coverage lenses).
 *
 * WHAT WAS WRONG.
 *   - The page said ipinfo receives only a free scan's IP. This round made
 *     every Full Analysis and Pro checkout send the buyer's IP to ipinfo.io
 *     for the sales-territory check (sales-territory.ts ipinfoLookup, called
 *     by create-checkout, create-subscription-checkout and
 *     create-product-checkout), undisclosed.
 *   - The cookie paragraph said nothing is sent for analytics before the
 *     visitor chooses, while Lovable's injected page counter still posts until
 *     the owner switches it off: the sentence now speaks for our own analytics.
 *   - Section 6 and the delete card said generated documents are kept until
 *     you ask; deleting an account now erases them (20261011210000), and the
 *     card's list says so.
 *
 * WHAT HOLDS NOW. Each sentence is pinned AND its path is run: ipinfoLookup
 * really asks ipinfo.io with the buyer's address, and the three checkouts
 * really pass it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ipinfoLookup } from "../../supabase/functions/_shared/sales-territory";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const privacy = read("src/pages/Privacy.tsx");

describe("ipinfo is disclosed for the checkout's country check", () => {
  it("the processors list names the purchase-time lookup", () => {
    const line = /<li data-ipinfo>([^<]+)<\/li>/.exec(privacy)?.[1] ?? "";
    expect(line).toMatch(/free scan/);
    expect(line).toMatch(/purchase/);
    expect(line).toMatch(/tax/);
  });

  it("the path runs: the lookup sends the buyer's address to ipinfo.io, and every selling checkout passes it", async () => {
    const asked: string[] = [];
    const lookup = ipinfoLookup(((k: string) => (k === "IPINFO_API_KEY" ? "tok" : undefined)) as never, (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify({ country: "US" }), { status: 200 });
    }) as unknown as typeof fetch);
    await lookup("203.0.113.9");
    expect(asked.some((u) => u.startsWith("https://ipinfo.io/203.0.113.9"))).toBe(true);
    for (const fn of ["create-checkout", "create-subscription-checkout", "create-product-checkout"]) {
      expect(read(`supabase/functions/${fn}/index.ts`), fn).toMatch(/lookup:\s*ipinfoLookup\(env\)/);
    }
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
