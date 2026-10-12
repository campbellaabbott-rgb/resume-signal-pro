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
 *
 * SINCE THE APPLY PIVOT (owner decision 2026-10-11) the agent is switched off
 * and its products are retired, and the guide at this address says so. The
 * old pins on review mode, the held releases and the nightly defaults are
 * replaced by the claims the page now makes: the switch is off, nothing is
 * sent for anyone (no sentence of ours submits), the form vendors are the
 * connector mirror's, ChatGPT's subset is the mirror's, the drafting rule is
 * default-deny, and the hosts named are only Claude, ChatGPT and Claude Code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GUIDES } from "@/data/guides";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";
import { APPLY_AGENT_ON, AGENT_PRODUCTS_ON_SALE } from "../../supabase/functions/_shared/apply-agent-switch";
import { MCP_FORM_VENDORS, MCP_FORM_VENDORS_ON_CHATGPT } from "@/config/mcp-tools";

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

describe("what the guide says matches the switch", () => {
  it("says the agent is switched off, and the switch ships off", () => {
    // If the agent is ever switched back on, this page becomes a false
    // statement in the other direction, and the change should be loud.
    expect(APPLY_AGENT_ON).toBe(false);
    expect(AGENT_PRODUCTS_ON_SALE).toBe(false);
    expect(guide.h1).toMatch(/switched off/i);
    expect(guide.tldr).toMatch(/does not send applications for anyone/);
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
    expect(prose).toMatch(/Resume Booster never submits anything/);
    expect(prose).toMatch(/You submit on the employer's own site/);
  });

  it("names the form vendors off the connector mirror, and ChatGPT's subset", () => {
    for (const v of MCP_FORM_VENDORS) expect(prose).toContain(v.label);
    const onChatgpt = MCP_FORM_VENDORS.filter((v) => MCP_FORM_VENDORS_ON_CHATGPT.includes(v.key)).map((v) => v.label);
    const chatgptLine = prose.split("\n").find((l) => /Inside ChatGPT it reads the form only for/.test(l)) ?? "";
    for (const label of onChatgpt) expect(chatgptLine).toContain(label);
    for (const v of MCP_FORM_VENDORS.filter((x) => !MCP_FORM_VENDORS_ON_CHATGPT.includes(x.key))) {
      expect(chatgptLine.split("Inside ChatGPT")[1] ?? "").not.toContain(v.label);
    }
  });

  it("states the default-deny drafting rule and the factual list that goes to the person", () => {
    expect(prose).toMatch(/default-deny/);
    expect(prose).toMatch(/open questions about the work you have done/);
    for (const topic of [/Work authorisation/, /sponsorship/, /Salary/, /References/, /employment gaps/, /why you left a job/, /demographic/, /Consent/]) {
      expect(prose).toMatch(topic);
    }
  });

  it("says model behaviour is our instruction, not a guarantee", () => {
    expect(prose).toMatch(/Resume Booster tells your AI/);
    expect(prose).toMatch(/not a promise about what a model will do/);
  });

  it("names only Claude, ChatGPT and Claude Code as hosts", () => {
    for (const ide of [/Cursor/, /VS ?Code/, /Cline/, /Windsurf/, /Zed\b/, /Gemini/, /Copilot/]) {
      expect(prose, `the guide names an IDE or other host (${ide})`).not.toMatch(ide);
    }
  });

  it("tells a past buyer they are refunded or honoured, at the retirement notice's address", () => {
    expect(prose).toMatch(/refund it or honour it/);
    expect(prose).toMatch(/resumeboostersupp@gmail\.com/);
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

  it("names no vendor as auto-submittable", () => {
    // The sender's vendors (SENDABLE_VENDORS) may appear only as hiring
    // systems whose FORM an AI reads; no sentence naming one may say it is
    // submitted to. The two the sender and the form readers share (Breezy,
    // Pinpoint) are in the form-reading sentence, built off the mirror.
    const sentences = prose.split(/(?<=[.:])\s+|\n/);
    for (const v of SENDABLE_VENDORS) {
      for (const sentence of sentences.filter((x) => x.toLowerCase().includes(v.toLowerCase()))) {
        expect(sentence, `the guide names ${v} beside a send`).not.toMatch(/submit|send/i);
        expect(sentence).toMatch(/reads/);
      }
    }
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
  it("tells the AI never to solve or evade a CAPTCHA, create an account or enter a password", () => {
    expect(prose).toMatch(/Never create an employer account, enter a password, or solve or evade a CAPTCHA/);
  });

  it("tells the AI never to invent an answer", () => {
    expect(prose).toMatch(/Never invent an answer/);
  });

  it("keeps identity and demographic questions with the candidate", () => {
    expect(prose).toMatch(/identity, nationality, demographic/i);
  });

  it("leaves the final Submit to the person", () => {
    expect(prose).toMatch(/stop before the final Submit/);
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
