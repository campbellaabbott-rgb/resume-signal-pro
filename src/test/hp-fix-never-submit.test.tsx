/**
 * NEITHER NEW PAGE PROMISES IT NEVER SUBMITS WHILE THE APPLY AGENT IS LIVE.
 *
 * On 2026-10-18 the read-only agent_sender_public_status RPC answered true:
 * the server-side apply agent still runs until wave 4 retires it. The base
 * branch (design/integration d823aae4) took the same claim off the old
 * homepage's hero and strip for that reason, and its refusal in
 * a-pass-number-on-a-page-is-a-placeholder.test.tsx covers only those two.
 * This file extends it to the new pages: the board note, the "use it from
 * your AI" never-list, the homepage FAQ and the pricing FAQ, rendered in
 * English and read in all nine languages. Wave 4 can restore the sentence,
 * with a test of its own, once the retirement is live
 * (docs/homepage-pricing/README.md, switch-over WHEN).
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

import { HomeBoardRows } from "@/components/home/HomeBoardRows";
import { HomeAiSection } from "@/components/home/HomeAiSection";
import { HomeFaq } from "@/components/home/HomeFaq";
import { PricingFaq } from "@/components/pricing/PricingFaq";
import "@/lib/home/strings";
import "@/components/pricing/use-pricing-strings";

vi.setConfig(MOUNT_TEST_BUDGET);

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Tree = Record<string, unknown>;
const read = (rel: string): Tree => JSON.parse(readFileSync(resolve(__dirname, rel), "utf8")) as Tree;
const leaves = (o: unknown, path = "", out: Array<[string, string]> = []): Array<[string, string]> => {
  if (typeof o === "string") out.push([path, o]);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
};

/** "We never submit" in each language, as the shards wrote it before this fix. */
const NEVER_SUBMITS =
  /never submit|never apply|reichen nie|nie eine bewerbung|nunca enviamos|ne soumettons jamais|कभी आवेदन जमा नहीं|dienen nooit|hindi kami kailanman nagsusumite/i;
/** A never-list item about submitting (the list is titled "What we never do"). */
const SUBMIT_LEAD = /submit|einreichen|enviar una candidatura|soumettre|जमा करना|indienen|enviar uma candidatura|magsumite/i;
/** An apply answer that opens with "No" (Portuguese "No site" is "On the site", so the word must end its clause). */
const OPENS_WITH_NO = /^(No[.,]|Nein[.,]|Non[.,]|नहीं|Nee[.,]|Não[.,]|Hindi[.,])/;

describe("the strings, in every language", () => {
  for (const lng of LOCALES) {
    it(`${lng}: no page says we never submit, and no apply answer opens with "No"`, () => {
      const home = leaves(read(`../lib/home/strings/${lng}.json`));
      const pricing = leaves(read(`../components/pricing/strings/${lng}.json`));
      const all = [...home, ...pricing];
      expect(all.filter(([, v]) => NEVER_SUBMITS.test(v)).map(([k, v]) => `${k}: ${v}`)).toEqual([]);
      const neverLeads = home.filter(([k]) => /^home\.ai\.never\d*Lead$/.test(k));
      expect(neverLeads.length, "the never-list keeps its other items").toBeGreaterThan(0);
      expect(neverLeads.filter(([, v]) => SUBMIT_LEAD.test(v)).map(([k, v]) => `${k}: ${v}`)).toEqual([]);
      for (const key of ["home.faq.applyA", "pricingPlans.faq.applyA"]) {
        const v = all.find(([k]) => k === key)?.[1] ?? "";
        expect(v, key).not.toBe("");
        expect(OPENS_WITH_NO.test(v), `${lng} ${key}: "${v}"`).toBe(false);
      }
    });
  }
});

describe("the rendered sections, in English", () => {
  const ROWS = { status: "ready" as const, rows: [] };
  it("the board note, the never-list, the homepage FAQ and the pricing FAQ say no such thing", () => {
    const { container } = render(
      <MemoryRouter>
        <HomeBoardRows state={ROWS} openTotal={null} asOf={null} />
        <HomeAiSection counts={{}} openTotal={null} asOf={null} />
        <HomeFaq counts={{}} />
        <PricingFaq alertsStatable={false} />
      </MemoryRouter>,
    );
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("You apply on the employer's own site.");
    expect(text, "a page promises never to submit while the agent is still live").not.toMatch(/never submit/i);
    expect(text).not.toMatch(/No, on any plan/);
    expect(text).not.toMatch(/What we never do[^]*Submit an application/);
  });
});
