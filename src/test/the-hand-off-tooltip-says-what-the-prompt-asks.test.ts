/**
 * THE HAND-OFF TOOLTIP SAYS WHAT THE PROMPT ASKS (the apply pivot, owner
 * decision 2026-10-11).
 *
 * The job board's "Open in your agent" control copies the prompt built by
 * agentPrompt() (src/lib/agent-handoff.ts). Since CJ-05 (2026-11-07) that
 * prompt asks the person's AI to read the employer's application form with
 * apply_myself, ask the person what only they can answer, show every draft
 * and stop before Submit. The tooltip that describes the prompt must say the
 * same, in every locale — a locale value beats the inline default, so the
 * nine values are what readers see. The two retired descriptions (the "can it
 * apply" question, and "give you the employer's apply link") are listed per
 * language and refused.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentPrompt } from "../lib/agent-handoff";

const DIR = resolve(__dirname, "../i18n/locales");
const tip = (f: string) => (JSON.parse(readFileSync(resolve(DIR, f), "utf8")) as { jobsPage: { openInAgentTip: string } }).jobsPage.openInAgentTip;

/** The retired clause — "say whether it can apply" — as each locale spelled it. */
const RETIRED_CLAUSE: Record<string, RegExp> = {
  "en.json": /whether it can apply/, "en-GB.json": /whether it can apply/,
  "de.json": /ob er sich bewerben kann/, "es.json": /si puede postularse/, "fr.json": /s'il peut postuler/,
  "hi.json": /आवेदन कर सकता है या नहीं/, "nl.json": /of hij kan solliciteren/, "pt.json": /se consegue candidatar-se/,
  "tl.json": /kung maaari itong mag-apply/,
};

describe("the 'Open in your agent' tooltip", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  it("covers the nine locales", () => expect(files.sort()).toEqual(Object.keys(RETIRED_CLAUSE).sort()));

  it("the prompt it describes reads the employer's form, asks the person, shows every draft and stops before Submit", () => {
    const p = agentPrompt({ id: "greenhouse:acme:1" });
    expect(p).toMatch(/call apply_myself/);
    expect(p).toMatch(/ask me every question it marks you/);
    expect(p).toMatch(/show me every draft/);
    expect(p).toMatch(/stop before Submit/);
  });

  /** The 2026-10-11 description ("give you the employer's apply link"), as each locale spelled it. */
  const LINK_ONLY_CLAUSE: Record<string, RegExp> = {
    "en.json": /give you the employer's apply link/, "en-GB.json": /give you the employer's apply link/,
    "de.json": /Bewerbungslink des Arbeitgebers zu geben/, "es.json": /te dé el enlace de solicitud/, "fr.json": /vous donner le lien de candidature/,
    "hi.json": /आवेदन लिंक देने/, "nl.json": /sollicitatielink van de werkgever te geven/, "pt.json": /lhe dê o link de candidatura/,
    "tl.json": /ibigay sa iyo ang apply link/,
  };
  for (const f of Object.keys(RETIRED_CLAUSE)) {
    it(`${f} describes that prompt, not either retired description`, () => {
      const v = tip(f);
      expect(v).not.toMatch(RETIRED_CLAUSE[f]);
      expect(v).not.toMatch(LINK_ONLY_CLAUSE[f]);
      if (f.startsWith("en")) expect(v).toMatch(/read the employer's application form, ask you what only you can answer, show you every draft and stop before Submit\. You submit it yourself\./);
    });
  }
});
