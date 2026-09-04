import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * AN AGENT COULD NOT ASK WHAT ITS OWN KEY COULD DO.
 *
 * 2026-09-04 audit of the MCP surface. Five findings, and every one of them is
 * the same shape: the server KNEW something and had no way to say it.
 *
 *  1. THE PAY IT HAD ALREADY PARSED. compactJob emitted the employer's prose
 *     ("$120k-$140k DOE") and dropped salary_min_annual, salary_max_annual,
 *     period, currency, experience_band, min_years and department — the very
 *     columns search_jobs offers salaryMin/salaryMax/payBasis/maxYears/
 *     experience filters against. A surface that filters on a number and will
 *     not return it makes its own filters unverifiable: an agent could not
 *     check that a floor bound, or sort a shortlist by money, without
 *     re-parsing a sentence the database had already parsed.
 *  2. THE KEY'S OWN LIMITS. Tier, rate and quota travelled only as HTTP
 *     response headers — which an MCP client never surfaces to a model — and
 *     apply-readiness could be discovered ONLY by calling request_application
 *     and reading which gate refused. "May I?" required a side effect to ask.
 *  3. WHICH CALLS ARE SAFE. No tool carried annotations, so a spec-following
 *     client had to assume every one of them might be destructive and
 *     interrupt its human before board_stats. Exactly one tool here acts.
 *  4. THAT ONE QUESTION COULD COVER MANY IDS. get_job is one posting per
 *     metered call against 1,000/day, and it can trigger a vendor fetch;
 *     re-verifying a twenty-job shortlist spent twenty. The board already
 *     answers liveness for 200 ids at once and had done for the site's tracker
 *     the whole time.
 *  5. FOUR FILTERS THE BOARD SERVES AND THE AGENT COULD NOT ASK FOR —
 *     experience, companies, postedAfter, includeUnstatedPay — all of them
 *     already carried by /v1. two-doors-onto-one-board catches drift in one
 *     direction (MCP ahead of /v1); nothing caught this one.
 *
 * Every assertion runs against COMMENT-STRIPPED source. A guard literal that
 * lives in a comment has passed a dead guard five times in this repository —
 * and the tools file this guards is 90% comment by line. The naive stripper
 * also eats a `//` inside a string, so anything carrying a URL is checked on
 * the one RAW line that holds it, never on a comment.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const MCP_RAW = read("supabase/functions/agent-mcp/index.ts");
const MCP = strip(MCP_RAW);
const BOARD_RAW = read("supabase/functions/job-board/index.ts");
const FILTERS = strip(read("supabase/functions/job-board/filters.ts"));
const PROBE = strip(read("scripts/api-contract-probe.mjs"));

/** The slice of `src` from the first `from` to the next `to` after it. */
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `anchor "${from}" present`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + 1);
  expect(b, `anchor "${to}" after "${from}"`).toBeGreaterThan(a);
  return src.slice(a, b);
};

/** Each entry of the TOOLS array, split on its own `name:` line. */
const TOOLS_SRC = between(MCP, "const TOOLS = [", "\n];");
const TOOL_BLOCKS = (() => {
  const marks = [...TOOLS_SRC.matchAll(/\n    name: "([a-z_]+)",/g)];
  return marks.map((m, i) => ({
    name: m[1],
    src: TOOLS_SRC.slice(m.index ?? 0, i + 1 < marks.length ? (marks[i + 1].index ?? TOOLS_SRC.length) : TOOLS_SRC.length),
  }));
})();
const block = (name: string) => {
  const b = TOOL_BLOCKS.find((t) => t.name === name);
  expect(b, `tool ${name} is declared`).toBeTruthy();
  return b!.src;
};
/** A tool's annotations, resolved through the two shared hint constants. */
const annotationsOf = (src: string) => {
  const named = /annotations: (READS_THE_BOARD|READS_THE_KEY)/.exec(src);
  if (named) return between(MCP, `const ${named[1]} =`, "\n");
  const i = src.indexOf("annotations: {");
  return i < 0 ? "" : src.slice(i, src.indexOf("\n    },", i));
};

describe("the card carries what the board already parsed", () => {
  it("passes the structured columns through under the board's OWN names", () => {
    // Cross-file, because the point is that these are not new fields: the
    // board emits every one of them and the MCP layer dropped them. Read from
    // rowToJob's own body so a name that only appears in a board COMMENT
    // cannot satisfy this.
    const rowToJob = strip(between(BOARD_RAW, "const rowToJob = (", "\n});"));
    const card = between(MCP, "function compactJob(", "function disclosures(");
    const fields = between(MCP, "const CARD_STRUCTURED_FIELDS = [", "] as const;");
    for (const f of ["salaryMinAnnual", "salaryMaxAnnual", "salaryPeriod", "salaryCurrency", "experienceBand", "minYears", "department"]) {
      expect(rowToJob, `the board emits ${f}`).toMatch(new RegExp(`${f}:`));
      expect(fields, `the card must carry ${f} — it is a column search_jobs already filters on`).toMatch(new RegExp(`"${f}"`));
    }
    expect(card, "the fields are copied off the row, not re-derived").toMatch(/for \(const k of CARD_STRUCTURED_FIELDS\)/);
    expect(card, "absent, not null — and only when the row actually carries it")
      .toMatch(/if \(j\[k\] !== undefined && j\[k\] !== null\) out\[k\] = j\[k\];/);
    // Without the employer handle the new `companies` scope is unusable: an
    // agent has nowhere else to learn a token.
    expect(card).toMatch(/companyToken: j\.token \?\? null,/);
  });

  it("says in the schema that an absent pay field is unstated, never zero", () => {
    const schema = between(MCP, "const JOB_CARD_SCHEMA = {", "\nconst DISCLOSURE_SCHEMA");
    expect(schema, "the ~87% with no stated pay must not read as free labour")
      .toMatch(/ABSENT when the posting states no pay — absence is not zero/);
    expect(schema).toMatch(/experienceBand: \{ type: "string", enum: \["entry", "mid", "senior", "expert"\]/);
    expect(schema, "the board keeps adding honest fields; a closed schema would reject the next one")
      .toMatch(/additionalProperties: true/);
  });

  it("declares an outputSchema on the tools that return rows, and always sends the structured half", () => {
    for (const t of ["search_jobs", "get_job", "get_jobs", "check_jobs_open", "fit_resume", "key_status"]) {
      expect(block(t), `${t} returns data an agent parses — declare its shape`).toMatch(/outputSchema: \{/);
    }
    // A declared outputSchema with no structuredContent is a schema describing
    // nothing; structuredContent with no text block is an empty render on a
    // client that predates it. 2025-06-18 asks for both.
    const ok = between(MCP, "const toolOk = (data: unknown) => (", "const toolErr");
    expect(ok).toMatch(/content: \[\{ type: "text", text: JSON\.stringify\(data, null, 1\) \}\]/);
    expect(ok).toMatch(/structuredContent: data as Record<string, unknown>/);
    expect(ok, "structuredContent is an object in the schema").toMatch(/typeof data === "object" && !Array\.isArray\(data\)/);
    expect(MCP, "outputSchema and structuredContent are 2025-06-18 features — the one revision this server speaks")
      .toMatch(/const MCP_PROTOCOL_VERSIONS = \["2025-06-18"\];/);
  });
});

describe("a key can be asked what it is", () => {
  it("key_status reports tier, both windows and the paid features, from the decision that allowed the call", () => {
    const fn = between(MCP, "async function runKeyStatus(", "async function callTool(");
    expect(fn).toMatch(/async function runKeyStatus\(client: SupabaseClient, d: Decision\)/);
    for (const f of ["d.rate_limit", "d.rate_used", "d.quota_limit", "d.quota_used", "d.key_tier"]) {
      expect(fn, `${f} must come from the decision, not a second read`).toMatch(new RegExp(f.replace(".", "\\.")));
    }
    expect(fn).toMatch(/remaining: Math\.max\(0, d\.rate_limit - d\.rate_used\)/);
    expect(fn).toMatch(/remaining: Math\.max\(0, d\.quota_limit - d\.quota_used\)/);
    // api_key_check counts before it answers, so the figures include this call.
    // Saying so is the difference between a number and a riddle.
    expect(fn).toMatch(/These figures include this call/);
    expect(fn, "the rate window is a clock minute, not a rolling 60s — reporting 60 would be a guess")
      .toMatch(/resetsInSeconds: secondsToNextMinute\(\)/);
    expect(fn).toMatch(/resetsInSeconds: secondsToMidnightUtc\(\)/);
    // The same predicate the paid gates use, so the advance answer cannot
    // disagree with the refusal.
    expect(fn).toMatch(/const paid = isPaidTier\(d\.key_tier\)/);
    expect(fn).toMatch(/fit_resume: paid,/);
    expect(fn).toMatch(/rankedEngine: paid,/);
    expect(fn).toMatch(/request_application: apply\.ready === true,/);
    expect(MCP, "the key itself is only ever held as a hash — never echo one").not.toMatch(/key: raw/);
  });

  it("is metered once, like every other tool, and never widens callTool's pinned signature", () => {
    const checks = MCP.match(/api_key_check/g) ?? [];
    expect(checks.length, "one metering call per request — key_status must not check the key twice").toBe(1);
    expect(MCP).toMatch(/p_endpoint: `\/mcp\/\$\{toolName\}`/);
    // The tier is handed to callTool and the decision row is not — the shape
    // the free-tier fit_resume hole was closed with. key_status is answered
    // beside it rather than by widening it.
    expect(MCP).toMatch(/callTool\(client, d\.api_key_id \?\? "", d\.key_tier, toolName, toolArgs\)/);
    expect(MCP).toMatch(/toolName === "key_status"\s*\n?\s*\? toolOk\(await runKeyStatus\(client, d\)\)/);
  });

  it("apply-readiness asks the gates the seam enforces, with the seam's own predicates", () => {
    const fn = between(MCP, "async function applyReadiness(", "async function runRequestApplication(");
    expect(fn).toMatch(/from\("agent_mandates"\)/);
    expect(fn).toMatch(/rowIsEntitled\(subRow as SubscriberRow \| null\)/);
    expect(fn, "existence is not entitlement — the same columns the seam reads").toMatch(/select\(ENTITLEMENT_COLUMNS\)/);
    expect(fn, "the seam's own resume floor, or 'ready' would promise a refusal")
      .toMatch(/String\(m\?\.resume_text \?\? ""\)\.length >= 100/);
    expect(fn).toMatch(/const pausedUntil = m\?\.paused_until && Date\.parse\(m\.paused_until\) > Date\.now\(\)/);
    expect(fn, "a not-ready answer must name what to fix").toMatch(/blockers\.push\(/);
    expect(fn, "readiness is account-level; the mandate's reach still binds per job")
      .toMatch(/Each job is still checked against the mandate's own reach/);
    // It reports, it does not gate: the seam keeps running every check itself.
    const seam = between(MCP, "async function enqueueApplication(", "async function readApplicationStatus(");
    for (const fence of ["scope-country", "scope-category", "scope-age", "scope-salary"]) {
      expect(seam, `${fence} must still be enforced at the seam`).toMatch(new RegExp(fence));
    }
    expect(fn, "the owner's address and résumé must not leave in a status answer").not.toMatch(/email,\s*$/m);
  });
});

describe("annotations say which call needs a human", () => {
  it("every tool ships a title and all four hints", () => {
    expect(TOOL_BLOCKS.length, "eleven tools as of 2026-09-04.2").toBeGreaterThanOrEqual(11);
    for (const t of TOOL_BLOCKS) {
      expect(t.src, `${t.name} needs a display title`).toMatch(/\n    title: "/);
      const ann = annotationsOf(t.src);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(ann, `${t.name} must declare ${hint} — a missing hint reads as "assume the worst"`).toMatch(new RegExp(hint));
      }
    }
  });

  it("exactly one tool is not read-only, and it is the one that acts", () => {
    const acting = TOOL_BLOCKS.filter((t) => /readOnlyHint: false/.test(annotationsOf(t.src))).map((t) => t.name);
    expect(acting, "request_application is the only tool here that acts on an account").toEqual(["request_application"]);
    const ann = annotationsOf(block("request_application"));
    expect(ann, "an application in front of an employer cannot be recalled — the client should ask first")
      .toMatch(/destructiveHint: true/);
    expect(ann, "the queue upsert ignores duplicates, so a retry is safe and should be advertised as such")
      .toMatch(/idempotentHint: true/);
    expect(MCP).toMatch(/const READS_THE_BOARD = \{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true \};/);
    expect(MCP, "key_status reads this key's own record — that is not an open world")
      .toMatch(/const READS_THE_KEY = \{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false \};/);
  });
});

describe("a shortlist costs one call, not twenty", () => {
  it("check_jobs_open rides the board's ids-based liveness path — the read-only one", () => {
    const fn = between(MCP, "async function runCheckJobsOpen(", "async function runFitResume(");
    expect(fn).toMatch(/board\(\{ action: "exists", ids \}\)/);
    expect(fn, "200 is the board's own cap for that action, echoed rather than re-chosen").toMatch(/asked\.slice\(0, 200\)/);
    expect(fn, "ids past the cap are NAMED — a silently truncated list is a shortlist believed verified")
      .toMatch(/notChecked/);
    // `verify` probes each vendor live, is capped at 12 for that reason, and
    // WRITES: it stamps missing_since and can delete rows. A tool annotated
    // read-only must not carry a path that prunes the corpus.
    expect(fn, "the writing liveness action must not appear on a read-only tool").not.toMatch(/action: "verify"/);
    expect(fn, "a published answer names its basis").toMatch(/basis:/);
    expect(fn).toMatch(/the board still holds a row for this posting/);
    expect(fn, "it must not claim to have asked the employer this second").toMatch(/not a live probe of the employer's site/);
    // `exists` asks a WEAKER question than the serving path: a row inside the
    // removal grace window, or past the 30-day cap, still exists. Two tools
    // that disagree about whether a posting is live must say which is stricter.
    expect(fn, "the gap against get_job's test has to be stated, not glossed")
      .toMatch(/WEAKER[\s\S]{0,300}freshness cap[\s\S]{0,120}get_job declines to serve it/);
    expect(block("check_jobs_open")).toMatch(/maxItems: 200/);
  });

  it("get_jobs is bounded by the vendor fetch, and one dead id never costs the others", () => {
    const fn = between(MCP, "async function runGetJobs(", "async function runCheckJobsOpen(");
    expect(MCP).toMatch(/const GET_JOBS_MAX = 10;/);
    expect(MCP, "job-board shares a worker pool with the ingest — the fit-batch lesson")
      .toMatch(/const GET_JOBS_CONCURRENCY = 5;/);
    expect(fn).toMatch(/asked\.slice\(0, GET_JOBS_MAX\)/);
    expect(fn).toMatch(/i \+= GET_JOBS_CONCURRENCY/);
    expect(fn, "a per-id failure is a row in `unavailable`, not a dead call").toMatch(/unavailable\.push\(\{/);
    expect(fn, "the detail stays server-side, like every other failure here").toMatch(/console\.error\(`\[AGENT-MCP\] get_jobs detail failed/);
    expect(fn, "overflow ids are named").toMatch(/notFetched/);
    expect(block("get_jobs")).toMatch(/maxItems: 10/);
  });

  it("get_job keeps the exact closure answers it always gave, and stops calling a bad id an internal error", () => {
    const fn = between(MCP, "async function runGetJob(", "const GET_JOBS_MAX");
    expect(fn).toMatch(/closed: out\.detail, note: "This posting closed/);
    expect(fn).toMatch(/agedOut: out\.detail, note: "Past the board's 30-day freshness cap\."/);
    // A throw reaches the agent as "hit an internal error. Try again shortly" —
    // a retry instruction for a call that can never succeed, which is the
    // scorer-429 lesson in a second place.
    expect(fn, "no posting is an ANSWER, like its two siblings").toMatch(/notFound: true,/);
    expect(fn).not.toMatch(/throw new Error\("Posting not found/);
    const shared0 = between(MCP, "async function detailOf(", "async function runGetJob(");
    expect(shared0, "an id the board does not carry is a fact about the id")
      .toMatch(/unknown job id\/i\.test\([\s\S]{0,80}return \{ ok: false, id, reason: "notFound" \}/);
    const shared = between(MCP, "async function detailOf(", "async function runGetJob(");
    expect(shared, "missing is a RESULT, or one closed posting takes the whole batch with it")
      .toMatch(/return \{ ok: false, id, reason: "closed", detail: r\.closed \};/);
    expect(shared, "the single-job cap is unchanged").toMatch(/descCap > 0/);
    expect(fn).toMatch(/detailOf\(id, 24_000, "\\n\[truncated\]"\)/);
  });
});

describe("the four filters the board served and the agent could not ask for", () => {
  it("map to the board's own parameter names", () => {
    const body = between(MCP, "function searchBody(args: Record<string, unknown>)", "\n}");
    expect(body).toMatch(/\.\.\.\(args\.experience \? \{ experience: String\(args\.experience\) \} : \{\}\)/);
    expect(body).toMatch(/\.\.\.\(args\.postedAfter \? \{ postedAfter: String\(args\.postedAfter\) \} : \{\}\)/);
    expect(body, "literal true only — the board names a non-boolean and the flag silently fails to widen")
      .toMatch(/\.\.\.\(args\.includeUnstatedPay === true \? \{ includeUnstatedPay: true \} : \{\}\)/);
    expect(body).toMatch(/\.\.\.\(companies\.length \? \{ companies \} : \{\}\)/);
    for (const p of ["companies", "experience", "postedAfter", "includeUnstatedPay"]) {
      expect(FILTERS, `the board reads body.${p} — the mapping must use its name`).toMatch(new RegExp(`body\\.${p}`));
    }
  });

  it("sends companies as an ARRAY, which is the only shape the board binds", () => {
    expect(FILTERS, "a bare string lands in ignoredFilters and the employer scope evaporates")
      .toMatch(/const compAsked = Array\.isArray\(body\.companies\) \? body\.companies : \[\];/);
    const fn = between(MCP, "const companyTokens = (v: unknown): string\\[] =>".replace("\\", ""), "function searchBody(");
    expect(fn).toMatch(/Array\.isArray\(v\) \? v : String\(v \?\? ""\)\.split\(","\)/);
    expect(fn, "no second cap here: the board caps and NAMES its trim, a cap here would be silent")
      .not.toMatch(/slice\(0, \d+\)/);
  });

  it("search_jobs and debug_search declare one object, because they run one mapping", () => {
    expect(MCP).toMatch(/const SEARCH_PROPERTIES = \{/);
    expect(block("search_jobs")).toMatch(/properties: SEARCH_PROPERTIES,/);
    expect(block("debug_search"), "'Takes the SAME arguments as search_jobs' must be a fact about the code")
      .toMatch(/properties: SEARCH_PROPERTIES,/);
    for (const p of ["companies", "experience", "postedAfter", "includeUnstatedPay"]) {
      expect(between(MCP, "const SEARCH_PROPERTIES = {", "\n};"), `${p} must be advertised, not merely accepted`)
        .toMatch(new RegExp(`\\n  ${p}:`));
    }
  });
});

describe("the surface says it changed, and the live probe checks it", () => {
  it("bumps the served version", () => {
    expect(MCP).toMatch(/version: "2026-09-\d\d\.\d"/);
    expect(MCP, "the version an agent reads must move when the tools do").not.toMatch(/version: "2026-09-04\.1"/);
  });

  it("the probe exercises the new tools against the live server", () => {
    for (const t of ["key_status", "check_jobs_open", "get_jobs"]) {
      expect(PROBE, `the probe must call ${t}`).toMatch(new RegExp(`name: "${t}"`));
    }
    expect(PROBE, "annotations are only useful on the wire").toMatch(/every tool ships annotations with readOnlyHint/);
    expect(PROBE).toMatch(/exactly one tool is NOT read-only, and it is request_application/);
    expect(PROBE, "a declared outputSchema must be matched by a sent structuredContent")
      .toMatch(/answers with structuredContent, not only JSON-in-text/);
    expect(PROBE, "the probe holds a FREE key, so the paid features must read false in advance")
      .toMatch(/key_status refuses the paid features in ADVANCE/);
    expect(PROBE, "accepted is not applied — the board's cardinal rule, on this surface too")
      .toMatch(/experience is APPLIED and the band is returned/);
    expect(PROBE).toMatch(/hasStatedPay rows carry a numeric salaryMinAnnual/);
  });
});
