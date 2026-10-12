/**
 * THE HAND-OFF TOOLTIP SAYS WHAT THE PROMPT ASKS (the apply pivot, owner
 * decision 2026-10-11).
 *
 * The job board's "Open in your agent" control copies the prompt built by
 * agentPrompt() (src/lib/agent-handoff.ts). Since the server-side apply agent
 * was switched off, that prompt no longer asks the agent whether it can
 * apply: it asks for the posting and the employer's apply link, and says the
 * person applies. The tooltip that describes the prompt must say the same, in
 * every locale — a locale value beats the inline default, so the nine values
 * are what readers see. The old sentence's "can it apply" clause is listed per
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

  it("the prompt it describes asks for the employer's apply link and says the person applies", () => {
    const p = agentPrompt({ id: "greenhouse:acme:1" });
    expect(p).toMatch(/employer's apply link/);
    expect(p).toMatch(/I will apply myself/);
  });

  for (const f of Object.keys(RETIRED_CLAUSE)) {
    it(`${f} describes that prompt, not the retired "can it apply" question`, () => {
      const v = tip(f);
      expect(v).not.toMatch(RETIRED_CLAUSE[f]);
      if (f.startsWith("en")) expect(v).toMatch(/give you the employer's apply link\. You apply yourself\./);
    });
  }
});
