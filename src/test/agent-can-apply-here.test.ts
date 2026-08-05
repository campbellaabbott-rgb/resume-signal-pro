/**
 * "THE AGENT CAN APPLY HERE" WAS ONLY VISIBLE AFTER THE AGENT HAD ALREADY
 * CHOSEN THE JOB.
 *
 * `isSendableVendor` decides which postings the nightly runner boosts and which
 * ones the worker will actually finish. It was rendered in exactly one place —
 * a reason chip inside the morning queue — so it appeared only on postings the
 * agent had already picked, and never on the board where a person decides what
 * to save, or on the saved rows they come back to.
 *
 * The risk in surfacing it is over-claiming. Sendable means "an adapter exists
 * and this vendor has no bot wall". It does NOT mean every application will
 * complete: 7 of 8 measured Breezy forms could be finished end to end, not 8,
 * and the eighth stops on questions that must stay refused. Nor does it mean
 * the reader has the agent. Most of this file pins that distinction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isSendableVendor, SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const account = readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8");

describe("both surfaces ask the shared predicate", () => {
  it("the board imports it rather than re-deriving the vendor list", () => {
    // A third copy of the list would be a third thing to forget when an adapter
    // lands — and this one would be the copy the PUBLIC reads, so its staleness
    // would be a false claim to strangers rather than a quiet mis-ranking.
    expect(jobs).toMatch(/import \{ isSendableVendor \} from "\.\.\/\.\.\/supabase\/functions\/_shared\/apply-automation"/);
    expect(account).toMatch(/import \{ isSendableVendor \} from "\.\.\/\.\.\/supabase\/functions\/_shared\/apply-automation"/);
  });

  it("asks it about the posting id, which is where the vendor lives", () => {
    expect(jobs).toMatch(/isSendableVendor\(job\.id\)/);
    expect(jobs).toMatch(/isSendableVendor\(detailJob\.id\)/);
    expect(account).toMatch(/isSendableVendor\(a\.job_id\)/);
  });

  it("the predicate still reads a board posting id", () => {
    // The board's ids are `source:token:externalId`. If that ever changed, the
    // chip would silently vanish from every row rather than fail loudly.
    expect(isSendableVendor("breezy:acme:12345")).toBe(true);
    expect(isSendableVendor("workday:acme:12345")).toBe(false);
    expect(SENDABLE_VENDORS.length).toBeGreaterThan(0);
  });
});

describe("the claim is about the form, not about the outcome", () => {
  const tip = jobs.match(/jobsPage\.agentAppliesTip", "([^"]+)"/)?.[1] ?? "";

  it("has a tooltip at all", () => {
    expect(tip.length).toBeGreaterThan(40);
  });

  it("says the application can still come back to the candidate", () => {
    // 7 of 8, not 8 of 8. A chip that reads as a guarantee is a promise the
    // employer's own screening questions get to break.
    expect(tip).toMatch(/hands the application back to you/i);
  });

  it("says it needs the subscription, rather than implying it is free", () => {
    expect(tip).toMatch(/Apply Agent subscription/i);
  });

  it("never promises the application will be sent", () => {
    for (const overclaim of [/we will apply/i, /applies automatically/i, /guarantee/i, /one click and/i]) {
      expect(tip, `tooltip must not promise: ${overclaim}`).not.toMatch(overclaim);
    }
  });
});

describe("the saved-jobs surface", () => {
  it("offers it only on rows not yet applied to", () => {
    // On an applied row it would be an offer to redo something done — and the
    // duplicate guard would refuse it, so the offer could not even be honoured.
    expect(account).toMatch(/a\.status === "saved" && a\.job_id && isSendableVendor\(a\.job_id\)/);
  });

  it("links somewhere that can actually act on it", () => {
    const i = account.indexOf('isSendableVendor(a.job_id)');
    expect(account.slice(i, i + 400)).toMatch(/to="\/agent"/);
  });
});
