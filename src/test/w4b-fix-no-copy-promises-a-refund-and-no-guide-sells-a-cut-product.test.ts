// @vitest-environment node
/**
 * NO COPY PROMISES A REFUND, AND NO GUIDE SELLS A CUT PRODUCT (wave 4 round 2
 * review, coverage lens).
 *
 * WHAT WAS WRONG.
 *   - The retirement notice (signed-in console, the morning queue, the pass
 *     page) and the indexed Apply Agent guide told buyers of the retired Agent
 *     plan, Agent Pass and Apply Assistant "We will refund it or honour it".
 *     The owner's decision is no refunds, the Terms say all sales are final,
 *     and this branch's own webhook mail says "Nothing was refunded".
 *   - Freelance Boost was still advertised with a price ("Freelance Boost
 *     ($29) ...") and linked as a product on two public guides after the
 *     owner removed it (decision 2 of 2026-10-17).
 *
 * WHAT HOLDS NOW, read from what renders:
 *   - no English or translated string, guide or source default promises a
 *     refund; the notice says what was bought is honoured;
 *   - no guide links /freelance-boost or names a cut product with a price.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { GUIDES } from "@/data/guides";

const ROOT = resolve(__dirname, "../..");
const REFUND_PROMISE = /\bwe(?:'ll| will)\s+refund\b|\brefund it\b|\bmoney[- ]back\b|\bfull refund\b|\bwill be refunded\b|\bget a refund\b|\beligible for a refund\b/i;

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|json)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
};

describe("no copy promises a refund", () => {
  it("in any locale", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const bad = strings(JSON.parse(readFileSync(join(dir, f), "utf8"))).filter((s) => REFUND_PROMISE.test(s));
      expect(bad, f).toEqual([]);
    }
  });

  it("in a guide or a source default the page renders", () => {
    expect(strings(GUIDES).filter((s) => REFUND_PROMISE.test(s))).toEqual([]);
    const bad = [...walk(resolve(ROOT, "src/components")), ...walk(resolve(ROOT, "src/pages")), ...walk(resolve(ROOT, "src/data"))]
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1]).filter((s) => REFUND_PROMISE.test(s)).map((s) => `${f}: ${s}`));
    expect(bad).toEqual([]);
  });

  it("the notice says what was bought is honoured", () => {
    const notice = readFileSync(resolve(ROOT, "src/components/agents/AgentRetiredNotice.tsx"), "utf8");
    expect(notice).toMatch(/agentPass\.retiredBuyersHonour", "Bought one before\? Write to us from the address you paid with and we will honour what you bought:"/);
    expect(JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")).agentPass.retiredBuyersHonour).toMatch(/we will honour what you bought/);
  });
});

describe("no guide sells a cut product", () => {
  const CUT = /\b(?:Freelance Boost|Transition Pro|Career Path(?: Simulator)?|Keyword Fix|ATS Defense|Premium Package|Career Snapshot|Graduate Game Plan|Interview Coach|Scan Packs?|Resume Roast|Recruiter View|Elevator Pitch)\b/;

  it("no related link opens /freelance-boost, and no text names a cut product with a price", () => {
    for (const [slug, g] of Object.entries(GUIDES)) {
      expect((g.related ?? []).filter((r) => /\/freelance-boost/.test(r.href)), slug).toEqual([]);
      const priced = strings(g).filter((s) => CUT.test(s) && /\$\d/.test(s));
      expect(priced, slug).toEqual([]);
      expect(strings(g).filter((s) => /Freelance Boost/.test(s)), slug).toEqual([]);
    }
  });
});
