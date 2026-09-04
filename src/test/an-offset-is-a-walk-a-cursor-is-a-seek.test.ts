import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE API SHIPPED WITH THE PAGINATION THAT ALREADY TOOK THIS BOARD DOWN.
 *
 * Measured on /v1/jobs the day it went live:
 *
 *   offset=0        0.7s        offset=100,000   8.7s
 *   offset=5,000    1.6s        offset=500,000   5.7s
 *
 * It answered 200 the whole way, which is what makes it dangerous — nothing
 * fails, the database just does more work the deeper a caller goes. And walking
 * the corpus is the FIRST thing an API consumer does. The board itself already
 * took an outage from this exact shape (offset 583,921 → HTTP 500 after 9.1s)
 * and answers it with a keyset cursor.
 *
 * The subtle half is where the cursor's key comes from. Rows are published from
 * JOB_FIELDS, which does NOT include effective_posted — the column the query
 * actually sorts by. Building the cursor from posted_at instead (it is right
 * there, and often equal) yields a key that does not match the ordering, and
 * pages that silently skip and repeat rows. So the sort key is selected, used,
 * and stripped back off before the response.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const PAGE = readFileSync(resolve(ROOT, "src/pages/DataApi.tsx"), "utf8");

describe("an offset is a walk, a cursor is a seek", () => {
  it("pages by keyset in the same order the query sorts by", () => {
    expect(CODE).toMatch(/effective_posted\.lt\."\$\{cursor\.ep\}",and\(effective_posted\.eq\."\$\{cursor\.ep\}",id\.gt\."\$\{cursor\.id\}"\)/);
    expect(CODE).toMatch(/\.order\("effective_posted", \{ ascending: false, nullsFirst: false \}\)/);
    expect(CODE).toMatch(/\.order\("id", \{ ascending: true \}\)/);
  });

  it("builds the cursor from the SORT key, never from posted_at", () => {
    expect(CODE).toMatch(/const ep = last\?\.effective_posted \?\? null;/);
    expect(CODE, "the cursor falls back to a column the query does not sort by")
      .not.toMatch(/effective_posted \?\? last\?\.posted_at/);
  });

  it("selects the sort key but does not publish it", () => {
    // ONE NAMED SUFFIX IS ALLOWED, AND ONLY ONE. `?include=description` appends
    // an opt-in column AFTER the sort key (2026-09-04), so the pattern admits
    // `${extraSelect}` by name and nothing else — an arbitrary interpolation
    // here is how a column nobody agreed to publish reaches the response, which
    // is the same reason JOB_FIELDS is a list and not select("*").
    expect(CODE).toMatch(/\.select\(`\$\{JOB_FIELDS\},effective_posted(\$\{extraSelect\})?`/);
    // Stripped before the response so the documented field list is the contract.
    expect(CODE).toMatch(/const \{ effective_posted: _sortKey, \.\.\.rest \} = r;/);
  });

  it("caps offset and names the cursor in the refusal", () => {
    expect(CODE).toMatch(/const MAX_OFFSET = 10_000;/);
    expect(CODE).toMatch(/"offset_too_deep"/);
    expect(CODE, "the refusal does not tell the caller what to use instead").toMatch(/page\.nextCursor/);
  });

  it("nextOffset stops before the cap so it cannot walk a caller off the cliff", () => {
    expect(CODE).toMatch(/nextOffset: !cursor && full && offset \+ limit <= MAX_OFFSET \? offset \+ limit : null/);
  });

  it("rejects a cursor it did not issue rather than trusting it", () => {
    expect(CODE).toMatch(/"bad_cursor"/);
    // A quote or backslash would break out of the quoted PostgREST value.
    // Substring, not a regex: the guard IS a regex literal, and escaping one
    // regex inside another is how an assertion ends up testing its own
    // backslashes instead of the code.
    expect(CODE).toContain(".test(o.ep)");
    expect(CODE).toContain(".test(o.id)");
    expect(CODE.slice(Math.max(0, CODE.indexOf(".test(o.ep)") - 24), CODE.indexOf(".test(o.ep)")))
      .toContain('"');
  });

  it("the docs tell callers to use the cursor, not the offset", () => {
    expect(PAGE).toMatch(/Paginate with <code className="text-xs">cursor=<\/code>/);
    expect(PAGE).toMatch(/nextCursor/);
  });
});

describe("the endpoints that make the API worth paying for", () => {
  it("/v1/changes reports opened AND closed", () => {
    expect(CODE).toMatch(/path === "\/v1\/changes"/);
    expect(CODE).toMatch(/from\("job_board_closures"\)/);
    expect(CODE).toMatch(/\.gte\("first_seen", sinceIso\)/);
  });

  it("a re-list is not reported as a close", () => {
    // Counting a re-listed posting as a filled role is the specific way this
    // dataset gets misread, and the board's own fills stats had to be corrected
    // for exactly that.
    expect(CODE).toMatch(/outcome: \(c as \{ superseded\?: boolean \}\)\.superseded \? "relisted" : "closed"/);
  });

  it("/v1/changes is bounded, so a poller cannot ask for the whole corpus", () => {
    expect(CODE).toMatch(/"since_too_old"/);
    expect(CODE).toMatch(/const oldest = Date\.now\(\) - maxDays \* 86_400_000;/);
  });

  it("/v1/usage can only ever read the calling key's own usage", () => {
    // key_id comes from the authenticated decision, never the query string.
    expect(CODE).toMatch(/usage\(client, d\.api_key_id, rateHeaders\)/);
    expect(CODE).toMatch(/\.eq\("key_id", keyId\)/);
    expect(CODE, "usage reads a key id supplied by the caller").not.toMatch(/searchParams\.get\("key_id"\)/);
  });

  it("conditional requests are supported and still spend quota", () => {
    expect(CODE).toMatch(/if-none-match/);
    expect(CODE).toMatch(/status: 304/);
    // The wrapper runs AFTER the key check, so accounting has already happened.
    const checkAt = CODE.indexOf('rpc("api_key_check"');
    const condAt = CODE.indexOf("const conditional = async");
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt, "the ETag short-circuit runs before authentication").toBeLessThan(condAt);
  });

  it("the new filters are bound, not silently ignored", () => {
    for (const f of ["experience_band", "department", "salary_max", "posted_before"]) {
      expect(CODE, `${f} is documented or added but never bound`).toContain(f);
    }
    expect(CODE).toMatch(/qb\.ilike\("department", `%\$\{dept\}%`\)/);
  });
});
