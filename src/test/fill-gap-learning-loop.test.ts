/**
 * THE SAME LOOP, ONE STEP EARLIER IN THE RUN — and the more expensive step.
 *
 * agent_confirmation_gaps turned "every phrase in CONFIRMED_RE is a guess" into
 * something measurable by making the misses name themselves. The form FILL had
 * the identical defect: seventeen distinct refusals, all filed as
 * `{kind:"worker", detail:"<sentence>"}`, so 19 of 60 fills failing looked from
 * the database exactly like 19 unrelated accidents.
 *
 * A confirmation gap costs a review. A fill gap costs the application.
 *
 * The safety bar is the same and the mechanism is deliberately stricter: the
 * worker decides at the point of failure what may be published, against an
 * allow-list, so a refusal nobody has classified is counted and never quoted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { classifyRefusal, refusalBlocker, scrubWording } from "../../worker/src/refusal.js";

const DIR = resolve(__dirname, "../../supabase/migrations");
const sqlFile = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.agent_fill_gaps"))
  .sort()
  .pop()!;
const bare = readFileSync(resolve(DIR, sqlFile), "utf8").replace(/--[^\n]*/g, "");
const hb = readFileSync(resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
const workerIndex = readFileSync(resolve(__dirname, "../../worker/src/index.ts"), "utf8");
const applyTs = readFileSync(resolve(__dirname, "../../worker/src/apply.ts"), "utf8");

describe("every refusal apply.ts can return is classified", () => {
  // The corpus is read OUT OF apply.ts rather than hand-listed, so a refusal
  // added tomorrow shows up here as an `unclassified` rather than as nothing.
  // A hand-list is the thing that goes stale silently — the same failure the
  // sendable-vendor mirror test exists to catch.
  const reasons = [...applyTs.matchAll(/reason:\s*`([^`]{10,200})`/g)].map((m) => m[1]!)
    .concat([...applyTs.matchAll(/reason:\s*"([^"]{10,200})"/g)].map((m) => m[1]!));

  it("finds the refusal sentences in apply.ts at all", () => {
    // An empty corpus would make every assertion below pass vacuously.
    expect(reasons.length).toBeGreaterThan(8);
  });

  it("leaves none of them unclassified", () => {
    // Template literals arrive with `${…}` intact; substituting something
    // plausible is closer to the real string than leaving the placeholder.
    const filled = reasons.map((r) =>
      r.replace(/\$\{[^}]*\}/g, (m) => (/source|src|key/.test(m) ? "breezy" : "3")));
    const unclassified = filled.filter((r) => classifyRefusal(r).stage === "unclassified");
    expect(unclassified, `unclassified refusals: ${unclassified.join(" | ")}`).toEqual([]);
  });

  it("covers the uncertain sentences too, which do not arrive here today", () => {
    // An `uncertain` outcome goes to agent_mark_uncertain and never reaches
    // refusalBlocker. Both of its sentences carry the landing URL and the
    // page's text, so their emptiness must be a decision rather than a
    // consequence of which branch they happen to miss.
    for (const r of [
      'no confirmation recognised after submit — url: https://x/y — page said: "All done"',
      "submitted but the page never settled — outcome unknown, not retrying",
    ]) {
      expect(classifyRefusal(r).stage).toBe("submit-uncertain");
      expect(classifyRefusal(r).wording).toBe("");
    }
  });
});

describe("classification separates the causes that need different fixes", () => {
  const stage = (r: string, b?: Array<{ label: string }>) => classifyRefusal(r, b).stage;

  it("tells a question it cannot answer from a control that refused an answer", () => {
    // One is a gap in the standing profile or the matcher; the other is a bug
    // in the adapter. Same sentence shape, opposite work.
    expect(stage("2 required question(s) the agent cannot answer — identity-document: no")).toBe("question-unanswerable");
    expect(stage('could not answer "Notice period": select had no matching option')).toBe("control-refused");
  });

  it("tells a partial fill from a vendor's own required-field check", () => {
    expect(stage("only placed 3/6 fields (missing: email, phone) — refusing to submit a partial application")).toBe("partial-fill");
    expect(stage("2 required field(s) the packet could not answer")).toBe("required-empty");
  });

  it("keeps a closed posting out of the failure count's interesting half", () => {
    expect(stage("posting is closed")).toBe("posting-closed");
    expect(stage("could not find the application form from this posting URL")).toBe("form-not-found");
  });

  it("does not file a driver error as whatever the exception happened to quote", () => {
    // A Playwright timeout can quote the page, including any phrase below it in
    // the ladder. Filed by its own prefix, and — see the next block — never
    // quoted, which is the point of checking it first.
    expect(stage('driver error: Timeout 30000ms exceeded waiting for "posting is closed"')).toBe("driver-error");
  });
});

describe("the evidence it publishes, and the evidence it withholds", () => {
  it("keeps the employer's question label, which is the whole point", () => {
    const f = classifyRefusal("1 required question(s) the agent cannot answer — unrecognised: no rule", [
      { label: "Are you an Internal Applicant?" },
    ]);
    // This exact question is the one genuine gap RECON.md records across all
    // eight Breezy forms. It is unanswerable because we hold no current
    // employer — but the loop can only surface it if the label survives.
    expect(f.wording).toContain("Are you an Internal Applicant?");
  });

  it("prefers the structured list over re-parsing the sentence", () => {
    // apply.ts builds the sentence by truncating the same list to three and
    // flattening the options away. Parsing it back is reconstructing a lossy
    // copy of a structure that is right there.
    const f = classifyRefusal("3 required question(s) the agent cannot answer — a: x; b: y", [
      { label: "Q one" }, { label: "Q two" }, { label: "Q three" }, { label: "Q four" },
    ]);
    expect(f.wording).toBe("Q one | Q two | Q three");
  });

  it("publishes nothing at all for a driver error", () => {
    const f = classifyRefusal("driver error: net::ERR_ABORTED at https://acme.breezy.hr/p/abc/apply");
    expect(f.wording).toBe("");
  });

  it("publishes nothing for a refusal it does not recognise", () => {
    // ALLOW-LIST. A new refusal costs a blind spot in the aggregate; a
    // deny-list would cost a leak through a rule nobody remembered to update.
    const f = classifyRefusal("some brand new sentence nobody has classified yet");
    expect(f.stage).toBe("unclassified");
    expect(f.wording).toBe("");
  });

  it("scrubs a URL, an email, a phone number and a file path anyway", () => {
    // Everything reaching the scrubber is employer text by construction. It is
    // scrubbed regardless, because "by construction" is the assumption that put
    // an apply URL into a public projection in the first place.
    const s = scrubWording(
      "See https://acme.com/apply or mail jane.doe@example.com or +44 7700 900123 or /tmp/x/jane-doe-cv.pdf",
    );
    expect(s).not.toMatch(/https?:\/\//);
    expect(s).not.toContain("@example.com");
    expect(s).not.toContain("7700 900123");
    expect(s).not.toContain("jane-doe-cv.pdf");
  });

  it("bounds the wording, so one enormous label cannot bloat every row", () => {
    expect(scrubWording("x".repeat(5000)).length).toBeLessThanOrEqual(200);
  });
});

describe("the worker writes it without changing what the candidate sees", () => {
  it("keeps kind and detail exactly as they were", () => {
    // packetState derives state from `kind`; ApplyQueuePanel renders `detail`
    // to the person whose application it is. Both are already correct.
    const b = refusalBlocker("posting is closed", "Breezy");
    expect(b.kind).toBe("worker");
    expect(b.detail).toBe("posting is closed");
  });

  it("records the vendor, because every adapter's field map is vendor-specific", () => {
    expect(refusalBlocker("posting is closed", "Breezy").source).toBe("breezy");
  });

  it("is what index.ts actually writes on a not-submitted release", () => {
    expect(workerIndex).toMatch(/blockers: \[refusalBlocker\(outcome\.reason, src, outcome\.blocked\)\]/);
  });

  it("passes the blocked questions through, or the labels never reach the aggregate", () => {
    // Dropping the third argument would leave every question-unanswerable row
    // with a category and no label — a count that says the refusal was correct
    // and nothing about which question caused it.
    expect(workerIndex).toMatch(/refusalBlocker\([^)]*outcome\.blocked\)/);
  });
});

describe("the SQL cannot republish what the worker withheld", () => {
  it("reads the worker-stamped wording", () => {
    expect(bare).toMatch(/b->>'wording'/);
  });

  it("NEVER falls back to the free-text detail", () => {
    // This is the whole safety argument. A packet written by an older worker
    // has no wording; falling back would publish the exact free text the
    // allow-list exists to withhold, on the rows least likely to be noticed.
    expect(bare).not.toMatch(/b->>'detail'/);
  });

  it("counts an unstamped row rather than dropping it", () => {
    // An out-of-date worker must not look like a quiet one.
    expect(bare).toMatch(/'unstamped'/);
  });

  it("groups by stage, vendor and wording", () => {
    expect(bare).toMatch(/GROUP BY stage, source, wording/);
  });

  it("orders by how often it happens, not by when", () => {
    // The function exists to decide what to fix next.
    expect(bare).toMatch(/ORDER BY count\(\*\) DESC/);
  });

  it("returns nothing that identifies a candidate or a posting", () => {
    const sig = bare.slice(bare.indexOf("RETURNS TABLE"), bare.indexOf("LANGUAGE sql"));
    for (const forbidden of ["user_id", "posting", "url", "email", "resume", "detail"]) {
      expect(sig.toLowerCase(), `${forbidden} must not be returned`).not.toContain(forbidden);
    }
  });

  it("is revoked from PUBLIC before anything is granted", () => {
    // A GRANT without a REVOKE leaves PUBLIC access — 107 of 121 definer
    // functions were anon-callable exactly that way.
    const rev = bare.indexOf("REVOKE ALL ON FUNCTION public.agent_fill_gaps");
    const grant = bare.indexOf("GRANT EXECUTE ON FUNCTION public.agent_fill_gaps");
    expect(rev).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(rev);
  });
});

describe("the heartbeat carries it where somebody will see it", () => {
  const fn = (() => {
    const start = hb.indexOf("async function evaluateFillGaps");
    const ends = ["\nasync function ", "\n/**"].map((m) => hb.indexOf(m, start + 1)).filter((i) => i > -1);
    return hb.slice(start, ends.length ? Math.min(...ends) : hb.length);
  })();

  it("is reported on every run", () => {
    expect(hb).toMatch(/^\s*fillGaps,?\s*$/m);
    expect(hb).toMatch(/const fillGaps = await evaluateFillGaps\(supabase\)/);
  });

  it("reports zero as a state, not as silence", () => {
    expect(fn).toMatch(/'none-yet'/);
    expect(fn).toMatch(/'fills-refused'/);
  });

  it("rolls up per stage, because that is the number that names the next fix", () => {
    expect(fn).toMatch(/topStage/);
    expect(fn).toMatch(/byStage/);
  });

  it("a missing RPC degrades to a reason, never to a failed heartbeat", () => {
    expect(fn).toMatch(/'rpc-missing'/);
    expect(fn).toMatch(/catch/);
    expect(fn).not.toMatch(/\bthrow\b/);
  });

  it("bounds what it prints", () => {
    expect(fn).toMatch(/slice\(0, 10\)/);
    expect(fn).toMatch(/slice\(0, 200\)/);
  });
});
