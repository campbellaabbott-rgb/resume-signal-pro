// @vitest-environment node
/**
 * THE BUNDLED CHATGPT EGRESS IS THE LIST OPENAI PUBLISHED LAST (NB-31).
 *
 * agent-mcp falls back to a bundled copy of OpenAI's ChatGPT-connector egress
 * whenever the live list cannot be read in time, and that copy decides which
 * keyless calls are ChatGPT's (a person's own allowance) and which are
 * "everyone else" (one address's 100 a day). The copy was read on 2026-10-12
 * from OpenAI's list of 2026-10-06; the list OpenAI served on 2026-11-16
 * (creationTime 2026-11-06T18:26:55) holds seven prefixes the copy lacked and
 * widens one, so in a fallback isolate a ChatGPT user behind one of them was
 * counted as everyone else.
 *
 * Now the copy is that list. The deploy verifier re-reads the live list and
 * fails on any prefix the copy is missing, so the next drift is caught live.
 */
import { describe, expect, it } from "vitest";
import { BUNDLED_CHATGPT_EGRESS_AT, BUNDLED_CHATGPT_EGRESS_V4 } from "../../supabase/functions/agent-mcp/chatgpt-egress";

/** The prefixes OpenAI's list of 2026-11-06 adds to, or widens from, the 2026-10-06 copy. */
const NEW_SINCE_OCTOBER = [
  "135.222.99.32/28", "20.168.48.117/32", "20.203.144.245/32", "20.219.124.186/32",
  "51.57.158.112/28", "68.155.152.41/32", "9.129.0.0/16",
];

describe("the bundled ChatGPT egress", () => {
  it("is OpenAI's list of 2026-11-06 or later", () => {
    expect(Date.parse(BUNDLED_CHATGPT_EGRESS_AT)).toBeGreaterThanOrEqual(Date.parse("2026-11-06T18:26:55"));
  });

  it("holds every prefix that list added, and the narrower one it replaced is gone", () => {
    for (const p of NEW_SINCE_OCTOBER) expect(BUNDLED_CHATGPT_EGRESS_V4, p).toContain(p);
    expect(BUNDLED_CHATGPT_EGRESS_V4).not.toContain("9.129.0.0/17");
    expect(BUNDLED_CHATGPT_EGRESS_V4.length).toBeGreaterThanOrEqual(289);
  });
});
