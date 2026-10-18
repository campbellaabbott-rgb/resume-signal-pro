/**
 * NO SEEKER COPY ON THE BOARD SAYS WE SEND AN APPLICATION.
 *
 * The owner retired the server-side apply agent, its $29 pass and the $7
 * Apply Assistant on 2026-10-11: people apply on the employer's own site,
 * with their own AI's help where they want it. The board still carried the
 * pitch after that ("can fill and submit N of these for you", a 7-day trial
 * at $99 a month, a 5th/12th-save toast, "runs your search nightly", an
 * "Agent can apply" chip and filter), in all nine languages. Pass B removed
 * every one of them with its keys and the guards that pinned them.
 *
 * This file keeps it that way, mechanically: it collects every locale key
 * the board, its listing components, its company page and its filter row
 * read, and fails on any English value or inline default that claims we (or
 * an agent of ours) submit or send applications, names a retired product or
 * price, or names an AI host other than the three the owner allows on
 * seeker pages (Claude, ChatGPT, Claude Code). A planted regression of each
 * kind is shown failing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const dir = (p: string) => readdirSync(resolve(ROOT, p)).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx")).map((f) => `${p}/${f}`);

/** The board and everything it mounts for a seeker to read. */
const SURFACES = [
  "src/pages/Jobs.tsx",
  "src/pages/JobPosting.tsx",
  "src/components/jobs/FilterBar.tsx",
  "src/components/jobs/FilterSheet.tsx",
  "src/components/jobs/HowApplyingWorks.tsx",
  ...dir("src/components/jobs/listing"),
  ...dir("src/components/jobs/company"),
];

const flatten = (o: Record<string, unknown>, p = ""): Record<string, string> => Object.fromEntries(
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? Object.entries(flatten(v as Record<string, unknown>, `${p}${k}.`)) : [[`${p}${k}`, String(v)]])),
);
const EN: Record<string, string> = {
  ...flatten(JSON.parse(read("src/i18n/locales/en.json"))),
  ...flatten(JSON.parse(read("src/i18n/shards/listing/en.json"))),
  ...flatten(JSON.parse(read("src/i18n/shards/company/en.json"))),
};

/** Every (key, English text) a source can print: the locale value and the inline default. */
function strings(src: string): Array<[string, string]> {
  const code = codeOf(src);
  const out: Array<[string, string]> = [];
  for (const m of code.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"\s*(?:,\s*"((?:[^"\\]|\\.)*)")?/g)) {
    const key = m[1];
    if (m[2]) out.push([key, m[2]]);
    for (const k of [key, `${key}_one`, `${key}_other`]) if (EN[k]) out.push([k, EN[k]]);
  }
  // Object-form defaults: t("key", { defaultValue: "..." })
  for (const m of code.matchAll(/defaultValue(?:_one|_other)?:\s*"((?:[^"\\]|\\.)*)"/g)) out.push(["(defaultValue)", m[1]]);
  return out;
}

/** A sentence that says we, or an agent of ours, send an application for the reader. */
const WE_SUBMIT = [
  /\b(?:we|our (?:apply )?agent|the apply agent|the agent|it)\b[^.;:]{0,60}\b(?:submits?|send(?:s)?|fill(?:s)? and submit)\b[^.;:]{0,40}\b(?:applications?|for you)\b/i,
  /\b(?:applies|apply) (?:to [^.]{0,30})?for you\b/i,
  /\bcan (?:fill and )?submit\b/i,
  /\bagent can apply\b/i,
];
/** Words that turn a sentence into the refusal it should be ("we never submit for you"). */
const NEGATED = /\b(?:never|not|no|don't|doesn't|won't|cannot|can't|nothing is sent)\b/i;
const RETIRED = /\$99|\$29|\bAgent plan\b|\bAgent Pass\b|\bApply Assistant\b|\bMorning Queue\b|\bfree trial\b|\btrialDays\b|\{\{agentPrice\}\}/i;
const OTHER_HOSTS = /\b(?:Cursor|Gemini|Copilot|Perplexity|VS Code|Cline|Windsurf|Zed|Le Chat|Grok)\b/;

function violations(pairs: Array<[string, string]>): string[] {
  const bad: string[] = [];
  for (const [key, text] of pairs) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (WE_SUBMIT.some((re) => re.test(sentence)) && !NEGATED.test(sentence)) bad.push(`${key}: says we send an application: ${sentence}`);
      if (RETIRED.test(sentence)) bad.push(`${key}: names a retired product or price: ${sentence}`);
      if (OTHER_HOSTS.test(sentence)) bad.push(`${key}: names an AI host seeker pages do not name: ${sentence}`);
    }
  }
  return bad;
}

describe("no seeker copy on the board says we submit applications", () => {
  for (const file of SURFACES) {
    it(`${file} prints no such sentence, no retired product and no fourth AI host`, () => {
      const pairs = strings(read(file));
      if (file === "src/pages/Jobs.tsx") expect(pairs.length, "the collector found the board's strings").toBeGreaterThan(500);
      expect(violations(pairs)).toEqual([]);
    });
  }

  it("the retired pitch, its toast, its filter and its chip are gone from the board and from every locale", () => {
    const board = codeOf(read("src/pages/Jobs.tsx"));
    const RETIRED_KEYS = [
      "agentPitchCounted", "agentPitchCta", "agentPitchScopeLive", "agentPitchScopePlain", "savedMilestone",
      "savedMilestoneDesc", "queueBridge", "agentAppliesTip2", "agentAppliesChip", "agentOnly", "agentOnlyTip",
      "chipAgentOnly", "bringYourOwnAgent", "factApplying",
    ];
    for (const k of RETIRED_KEYS) expect(board, `jobsPage.${k} is read by the board again`).not.toContain(`jobsPage.${k}"`);
    for (const f of readdirSync(resolve(ROOT, "src/i18n/locales")).filter((x) => x.endsWith(".json"))) {
      const jp = JSON.parse(read(`src/i18n/locales/${f}`)).jobsPage as Record<string, unknown>;
      for (const k of RETIRED_KEYS) expect(jp[k], `${f} still carries jobsPage.${k}`).toBeUndefined();
      const ha = JSON.parse(read(`src/i18n/locales/${f}`)).howApply as Record<string, unknown>;
      expect(ha.agentSubmits, `${f} still says the Apply Agent can submit`).toBeUndefined();
      expect(ha.agentPrepares, `${f} still names the Apply Agent`).toBeUndefined();
    }
    expect(board, "the board links the retired agent's console").not.toMatch(/to="\/agent"/);
  });

  it("TEETH: each kind of claim is caught when planted, and the refusal it should be is not", () => {
    expect(violations([["planted", "The apply agent can fill and submit 3 of these for you."]]).length).toBeGreaterThan(0);
    expect(violations([["planted", "Our agent submits applications on Greenhouse."]]).length).toBeGreaterThan(0);
    expect(violations([["planted", "It applies for you while you sleep."]]).length).toBeGreaterThan(0);
    expect(violations([["planted", "See how it works — 7 days free, then $99/mo"]]).length).toBeGreaterThan(0);
    expect(violations([["planted", "Open it in Cursor or Gemini."]]).length).toBeGreaterThan(0);
    // A planted pitch inside the board's own source is collected and caught.
    const planted = read("src/pages/Jobs.tsx").replace(
      "toast({ title: t(\"jobsPage.jobSaved\", \"Saved to your application tracker\") });",
      "toast({ title: t(\"jobsPage.jobSavedPitch\", \"Saved. Our agent can fill and submit it for you.\") });",
    );
    expect(planted, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(read("src/pages/Jobs.tsx"));
    expect(violations(strings(planted)).length).toBeGreaterThan(0);
    // The refusals the board does print stay legal.
    expect(violations([["ok", "Review and edit each one, then apply on Acme's own site — we never submit for you."]])).toEqual([]);
    expect(violations([["ok", "Open in Claude or ChatGPT"]])).toEqual([]);
  });
});
