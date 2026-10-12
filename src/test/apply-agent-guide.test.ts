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
 * stranger believes. So every factual claim in the guide is pinned here.
 *
 * SINCE THE APPLY PIVOT (owner decision 2026-10-11) the server-side agent and
 * the plan and pass sold with it are retired, and the guide at this address
 * says so. The old pins on review mode, the held releases and the nightly
 * defaults are replaced by the claims the page now makes: the agent is
 * retired, no sentence says we submit or send for anyone, the person submits
 * on the employer's site, and the hosts it names are only Claude, ChatGPT and
 * Claude Code. It describes nothing of the connector beyond searching and
 * reading, and no instruction the server gives a model: those change with the
 * connector, and wave 4's guide states them once its server ships them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GUIDES, GUIDES_INDEX_DESCRIPTION, GUIDES_INDEX_TITLE, GUIDES_INTRO } from "@/data/guides";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";
import { RETIRED_CLAIMS } from "../../scripts/prerender-retired.mjs";

const guide = GUIDES["how-the-apply-agent-works"];
const prose = (() => {
  const parts: string[] = [guide.tldr, guide.description, guide.h1, guide.title];
  for (const s of guide.sections) parts.push(s.h2, ...s.paras, ...(s.bullets ?? []));
  for (const f of guide.faqs ?? []) parts.push(f.q, f.a);
  return parts.join("\n");
})();

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

describe("what the guide says is the retirement, and only that", () => {
  it("says the agent is retired, in its title, its heading and its short answer", () => {
    expect(guide.title).toMatch(/retired/i);
    expect(guide.h1).toMatch(/retired/i);
    expect(guide.tldr).toMatch(/does not prepare or send applications any more/);
  });

  it("no sentence says we, or an agent of ours, submit or send an application", () => {
    for (const re of [
      /\b(it|agent|we)\b[^.]*\b(submits|sends) (the )?applications?\b/i,
      /can fill and submit/i,
      /submit (it |them )?for you/i,
      /switch it to auto/i,
      /\bauto mode\b/i,
      /every night (the agent|it) scans/i,
    ]) {
      expect(prose, `the guide still claims a send (${re})`).not.toMatch(re);
    }
    expect(prose).toMatch(/Resume Booster does not submit applications/);
    expect(prose).toMatch(/You submit on the employer's own site/);
  });

  it("carries none of the claims the crawler copy may no longer make", () => {
    // The same list the bake checks its own output against.
    for (const [claim, re] of RETIRED_CLAIMS) expect(prose, `the guide carries ${claim}`).not.toMatch(re);
  });

  it("names no product it retired by its sale name, and no price", () => {
    expect(prose).not.toMatch(/Agent Pass|Agent plan|Morning Queue|Apply Assistant/);
    expect(prose).not.toMatch(/\$\d/);
  });

  it("names only Claude, ChatGPT and Claude Code as hosts", () => {
    for (const ide of [/Cursor/, /VS ?Code/, /Cline/, /Windsurf/, /Zed\b/, /Gemini/, /Copilot/]) {
      expect(prose, `the guide names an IDE or other host (${ide})`).not.toMatch(ide);
    }
    expect(prose).toMatch(/Claude, ChatGPT or Claude Code/);
  });

  it("describes no connector feature beyond searching and reading, and no instruction to a model", () => {
    // Those belong to the connector's page and move with it.
    expect(prose).not.toMatch(/Resume Booster tells your AI|application form, question by question|default-deny/);
  });

  it("tells a past buyer where to write", () => {
    expect(prose).toMatch(/resumeboostersupp@gmail\.com/);
  });

  it("the guides index no longer sells the agent either", () => {
    for (const s of [GUIDES_INDEX_TITLE, GUIDES_INDEX_DESCRIPTION, GUIDES_INTRO]) {
      expect(s).not.toMatch(/apply agent/i);
    }
  });
});

describe("it does not bake in a number that will go stale", () => {
  it("quotes no posting counts or percentages of the board", () => {
    const offenders = [
      /\b\d{1,3}(,\d{3})+\s*(postings|jobs)/i,   // "29,522 postings"
      /\b\d+(\.\d+)?\s*%\s*of the board/i,        // "3.5% of the board"
      /\b\d+(\.\d+)?%\s*(of )?(postings|jobs)/i,
    ];
    for (const re of offenders) {
      expect(prose, `the guide must not hardcode a board quantity (${re})`).not.toMatch(re);
    }
  });

  it("names no vendor the old sender drove", () => {
    for (const v of SENDABLE_VENDORS) {
      expect(prose.toLowerCase(), `the guide names ${v}`).not.toContain(v.toLowerCase());
    }
  });
});

describe("somebody can actually find it", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("is still linked from the agent page and the setup checklist", () => {
    expect(read("../pages/Agent.tsx")).toMatch(/\/guides\/how-the-apply-agent-works/);
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

describe("the advice keeps the person in charge", () => {
  it("leaves every factual and identity question with the person", () => {
    expect(prose).toMatch(/Everything factual is yours to answer/);
    expect(prose).toMatch(/Identity, nationality, demographic/);
    for (const topic of [/Work authorisation/, /sponsorship/, /Salary/, /References/, /employment gaps/, /why you left a job/, /Consent/]) {
      expect(prose).toMatch(topic);
    }
  });

  it("never sends the person around a CAPTCHA, an account or a password", () => {
    expect(prose).toMatch(/Never let a tool create an employer account for you, enter a password, or solve or get around a CAPTCHA/);
  });

  it("does not claim a success rate or an interview outcome", () => {
    for (const re of [/\d+\s*%\s*(success|response|interview)/i, /guaranteed/i, /land(s)? you (a|an) (job|interview)/i]) {
      expect(prose, `the guide must not claim outcomes (${re})`).not.toMatch(re);
    }
  });
});
