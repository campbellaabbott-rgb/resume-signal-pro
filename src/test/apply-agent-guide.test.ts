/**
 * A PUBLIC PAGE DESCRIBING A THING THAT ACTS ON SOMEBODY'S BEHALF.
 *
 * This codebase has a named failure mode for exactly this: copy goes false when
 * the thing it describes moves, and nobody diffs prose against a runtime. It has
 * already happened three times in one file — MorningQueuePanel claimed "nothing
 * is ever submitted on your behalf" for weeks after auto mode shipped.
 *
 * A prerendered SEO guide is the worst case of that pattern, because it is the
 * copy least likely to be re-read and the most likely to be the first thing a
 * stranger believes. So every factual claim in the guide is pinned here to the
 * code or the migration that makes it true.
 *
 * The rule the guide follows, and this file enforces: STRUCTURE may be stated,
 * QUANTITIES may not. How many postings the agent can submit to changes daily;
 * AgentReachNote reads it live and renders nothing rather than show a stale
 * number. A figure baked into a prerendered page would defeat that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GUIDES } from "@/data/guides";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

const guide = GUIDES["how-the-apply-agent-works"];
const prose = (() => {
  const parts: string[] = [guide.tldr, guide.description, guide.h1, guide.title];
  for (const s of guide.sections) parts.push(s.h2, ...s.paras, ...(s.bullets ?? []));
  for (const f of guide.faqs ?? []) parts.push(f.q, f.a);
  return parts.join("\n");
})();

const DIR = resolve(__dirname, "../../supabase/migrations");
const allSql = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8")).join("\n");

describe("the guide exists and is wired like every other one", () => {
  it("is registered under its own slug", () => {
    expect(guide, "the apply-agent guide is missing from GUIDES").toBeTruthy();
    expect(guide.slug).toBe("how-the-apply-agent-works");
  });

  it("has the fields the article page and the prerenderer both read", () => {
    // GuidesIndex renders title/description; GuideArticle renders tldr and
    // sections; prerender-seo emits all of it. A missing field is a blank page
    // in the build output rather than an error.
    expect(guide.title.length).toBeGreaterThan(10);
    expect(guide.description.length).toBeGreaterThan(50);
    expect(guide.tldr.length).toBeGreaterThan(100);
    expect(guide.sections.length).toBeGreaterThanOrEqual(5);
    expect(guide.faqs?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(guide.related.length).toBeGreaterThan(0);
  });
});

describe("what the guide promises matches what the code does", () => {
  it("says review mode is the default, and the migration agrees", () => {
    // If somebody flips this default, the guide becomes a false statement about
    // whether applications go out without being seen — the single highest-stakes
    // sentence on the page.
    expect(allSql).toMatch(/apply_mode text NOT NULL DEFAULT 'review'/);
    expect(prose).toMatch(/starts in review mode/i);
    expect(prose).toMatch(/off by default|default for everyone/i);
  });

  it("says the first releases are held, and hold_first_n still exists", () => {
    expect(allSql).toMatch(/hold_first_n integer NOT NULL DEFAULT 3/);
    expect(prose).toMatch(/held for your approval/i);
  });

  it("states the daily-pick default the migration actually sets", () => {
    expect(allSql).toMatch(/daily_count integer NOT NULL DEFAULT 5 CHECK \(daily_count BETWEEN 1 AND 10\)/);
    expect(prose).toMatch(/defaults to 5/);
  });

  it("describes comma-separated terms, which is how the runner reads them", () => {
    const runner = readFileSync(
      resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"), "utf8");
    expect(runner).toMatch(/split\(","\)/);
    expect(prose).toMatch(/comma-separated/i);
  });

  it("describes the uncategorised opt-in that now exists", () => {
    // Added the same day as this guide. If the checkbox is ever removed, the
    // troubleshooting step telling people to tick it becomes a dead end.
    expect(allSql).toMatch(/include_uncategorised/);
    expect(prose).toMatch(/could not be classified/i);
  });
});

describe("it does not bake in a number that will go stale", () => {
  it("quotes no posting counts or percentages of the board", () => {
    // AgentReachNote exists BECAUSE a hardcoded "30,000+" outliving its data is
    // the failure to avoid. A prerendered page cannot re-read the board, so it
    // must not claim a quantity at all.
    const offenders = [
      /\b\d{1,3}(,\d{3})+\s*(postings|jobs)/i,   // "29,522 postings"
      /\b\d+(\.\d+)?\s*%\s*of the board/i,        // "3.5% of the board"
      /\b\d+(\.\d+)?%\s*(of )?(postings|jobs)/i,
    ];
    for (const re of offenders) {
      expect(prose, `the guide must not hardcode a board quantity (${re})`).not.toMatch(re);
    }
  });

  it("names no vendor as auto-submittable, since that list moves", () => {
    // SENDABLE_VENDORS changes whenever an adapter lands or a vendor puts up a
    // wall. Naming one here would be a claim with no test between it and a
    // stranger — and the board's own chip already says it per posting.
    for (const v of SENDABLE_VENDORS) {
      expect(prose.toLowerCase(), `the guide must not name ${v} as auto-submittable`)
        .not.toContain(v.toLowerCase());
    }
  });

  it("points at the live surface for the split instead", () => {
    expect(prose).toMatch(/live count|shows the current split|Apply Agent page/i);
  });
});

describe("somebody can actually find it", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("is linked from the agent page itself, on every tab", () => {
    // A guide nobody can reach from the product is an SEO page, not
    // instructions. The link sits next to the h1 rather than inside a tab.
    expect(read("../pages/Agent.tsx")).toMatch(/\/guides\/how-the-apply-agent-works/);
  });

  it("is linked from the setup checklist, where people are most lost", () => {
    expect(read("../components/account/AgentSetupChecklist.tsx"))
      .toMatch(/\/guides\/how-the-apply-agent-works/);
  });

  it("its own links point at routes the app actually serves", () => {
    // A related-link 404 in a prerendered page is a dead end for a reader and a
    // broken internal link for a crawler.
    const app = read("../App.tsx");
    for (const r of guide.related) {
      const top = "/" + r.href.split("/").filter(Boolean)[0];
      expect(app, `no route for ${r.href}`).toMatch(new RegExp(`path="${top}`));
    }
  });
});

describe("the byline says what THIS guide is grounded in", () => {
  it("does not inherit the résumé-scanner default", () => {
    // The byline was hardcoded in GuideArticle.tsx AND prerender-seo.mjs as
    // "Grounded in the checks our scanner runs on every resume". True of eight
    // résumé guides; false of this one, and it would have shipped under it.
    expect(guide.grounding, "this guide must state its own grounding").toBeTruthy();
    expect(guide.grounding).not.toMatch(/scanner runs on every resume/);
  });

  it("both renderers read the shared helper rather than a literal", () => {
    const article = readFileSync(resolve(__dirname, "../pages/GuideArticle.tsx"), "utf8");
    const prerender = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(article).toMatch(/guideGrounding\(g\)/);
    expect(prerender).toMatch(/guideGrounding\(g\)/);
    for (const [name, src] of [["GuideArticle", article], ["prerender-seo", prerender]] as const) {
      expect(src, `${name} still hardcodes the byline`).not.toMatch(/Grounded in the checks our scanner/);
    }
  });
});

describe("the refusals are stated, because they are the product", () => {
  it("promises no CAPTCHA solving or fingerprint evasion", () => {
    // The hard product boundary. If this sentence ever stops being true, the
    // change should be loud.
    expect(prose).toMatch(/does not solve CAPTCHAs|never solves or evades a CAPTCHA/i);
    expect(prose).toMatch(/fingerprint|spoof/i);
  });

  it("promises it never invents an answer", () => {
    expect(prose).toMatch(/never invents an answer/i);
  });

  it("promises identity and demographic questions stay with the candidate", () => {
    expect(prose).toMatch(/identity, nationality, demographic/i);
  });

  it("promises no duplicate applications", () => {
    expect(prose).toMatch(/never sends twice/i);
  });

  it("does not claim a success rate or an interview outcome", () => {
    // Zero applications have been submitted to date. Any performance claim on a
    // public page would be unfounded, and this is the page a stranger reads
    // first.
    for (const re of [/\d+\s*%\s*(success|response|interview)/i, /guaranteed/i, /land(s)? you (a|an) (job|interview)/i]) {
      expect(prose, `the guide must not claim outcomes (${re})`).not.toMatch(re);
    }
  });
});
