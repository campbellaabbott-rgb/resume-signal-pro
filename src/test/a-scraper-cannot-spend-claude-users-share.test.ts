// @vitest-environment node
/**
 * A SCRAPER CANNOT SPEND CLAUDE USERS' SHARE, AND NOBODY HOLDS THE DATABASE
 * FOR A MINUTE.
 *
 * Until wave 4 the keyless MCP allowance was one global row of 2,000 a day
 * (mcp_anon_check, 20260915100000): any caller on any network could spend it
 * for every Claude and ChatGPT seeker, and nothing bounded a minute at all
 * while MCP reads skip job-board's own per-address budget. The owner's figures
 * (2026-10-11): 20,000 a day split Claude 10,000 / ChatGPT 6,000 / other
 * 4,000, with 60 a minute overall and 30 / 20 / 15 per share, and a separate
 * forms pool of 5,000 a day at 20 a minute.
 *
 * mcp_anon_check_v2 (20261011102000) is RUN here in pglite: each share is its
 * own row, the minute rows refuse a burst, a refusal at any step hands back
 * what earlier steps counted, the forms pool never touches the overall day,
 * and a refund gives a call back at most p_max times a day and never a minute.
 * The adoption reader keeps counting addresses, not shares.
 *
 * The review of 9fe3bc0d found the forms pool was one share and one minute row
 * for every caller, so a scraper outside both platforms could refuse every
 * Claude and ChatGPT user's apply_myself. A forms call now counts against its
 * platform's part of the pool ('global:forms:<platform>', its own minute) and
 * the pool's own day and minute as the overall row ('global:forms').
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";

const V2 = "20261011102000_a_hosts_users_can_spend_only_their_hosts_share_of_the_day.sql";
const READER = "20261011102100_the_adoption_reader_counts_addresses_not_shares_minutes_or_forms.sql";

type Decision = {
  allowed: boolean; refused_by: string | null;
  bucket_used: number; bucket_cap: number; share_used: number; share_cap: number;
  overall_used: number; overall_cap: number; minute_used: number; minute_cap: number;
};

let db: PGlite;
const today = () => new Date().toISOString().slice(0, 10);
const check = async (
  bucket: string, bucketCap: number, share: string, shareCap: number,
  overallCap: number | null = 20000, minuteCap: number | null = null, overallMinuteCap: number | null = null,
  overallBucket = "global",
): Promise<Decision> =>
  (await db.query<Decision>(
    "SELECT * FROM public.mcp_anon_check_v2($1, $2, $3, $4, $5, $6, $7, $8)",
    [bucket, bucketCap, share, shareCap, overallCap, minuteCap, overallMinuteCap, overallBucket],
  )).rows[0];
const refund = async (bucket: string, share: string, overall: boolean, max = 5, overallBucket = "global") =>
  (await db.query<{ ok: boolean }>("SELECT public.mcp_anon_refund($1, $2, $3, $4, $5) AS ok", [bucket, share, overall, max, overallBucket])).rows[0].ok;
/** Calls on today's rows whose name matches a Postgres regular expression. */
const rowsMatching = async (re: string) =>
  (await db.query<{ calls: number }>("SELECT calls FROM public.mcp_anon_rate WHERE day = $1::date AND bucket ~ $2", [today(), re])).rows.reduce((n, r) => n + r.calls, 0);
/** A forms call as agent-mcp makes it: the platform's part of the pool, and the pool as the overall row. */
const formsCheck = (bucket: string, platform: "claude" | "chatgpt" | "other", bucketCap = 100) => {
  const shares = { claude: 2000, chatgpt: 2000, other: 1000 } as const;
  const minutes = { claude: 10, chatgpt: 6, other: 4 } as const;
  return check(`f:${bucket}`, bucketCap, `global:forms:${platform}`, shares[platform], 5000, minutes[platform], 20, "global:forms");
};
const callsIn = async (bucket: string) =>
  (await db.query<{ calls: number }>("SELECT calls FROM public.mcp_anon_rate WHERE day = $1::date AND bucket = $2", [today(), bucket])).rows[0]?.calls ?? 0;
const seed = (bucket: string, calls: number, day = today()) =>
  db.query("INSERT INTO public.mcp_anon_rate (day, bucket, calls) VALUES ($1::date, $2, $3) ON CONFLICT (day, bucket) DO UPDATE SET calls = excluded.calls", [day, bucket, calls]);
const minuteRows = async (prefix: string) =>
  (await db.query<{ calls: number }>("SELECT calls FROM public.mcp_anon_rate WHERE day = $1::date AND bucket LIKE $2", [today(), `${prefix}%`])).rows.reduce((n, r) => n + r.calls, 0);

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  // Supabase grants every new public table to the client roles; the meter's
  // table must take that away by name.
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec(migration("20260915100000_a_shared_egress_makes_a_per_address_bucket_a_global_one_so_both_exist.sql"));
  await db.exec(`
    CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), name text, key_prefix text);
    CREATE TABLE public.api_usage (day date, key_id uuid, endpoint text, calls integer);
    CREATE TABLE public.agent_passes (purchased_at timestamptz, activated_at timestamptz, activated_via text, applications_used integer, applications_total integer);
    CREATE TABLE public.job_board_search_events (at timestamptz, caller text, results integer);
  `);
  await db.exec(migration("20260917200000_a_channel_cannot_be_judged_until_someone_can_read_it.sql"));
  await db.exec(migration("20261009123000_the_adoption_reader_counts_addresses_not_a_hosts_own_buckets.sql"));
  await db.exec(migration(V2));
  await db.exec(migration(READER));
}, 120_000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("DELETE FROM public.mcp_anon_rate"); });

describe("each host's share is its own row", () => {
  it("a scraper that spends the 'other' share leaves Claude's share answering", async () => {
    await seed("global:other", 4000);
    const scraper = await check("aaaaaaaaaaaaaaaa", 100, "global:other", 4000);
    expect(scraper).toMatchObject({ allowed: false, refused_by: "share", share_used: 4000 });
    const claude = await check("host:claude", 10000, "global:claude", 10000);
    expect(claude).toMatchObject({ allowed: true, refused_by: null, share_used: 1, bucket_used: 1, overall_used: 1 });
    // The refused call was charged to nobody: its bucket was given back and
    // the overall day only counts Claude's one call.
    expect(await callsIn("ip:aaaaaaaaaaaaaaaa")).toBe(0);
    expect(await callsIn("global")).toBe(1);
  });

  it("one call counts once on its bucket, its share and the overall day, and the share remembers its cap", async () => {
    const d = await check("u:chatgpt:0123456789abcdef", 200, "global:chatgpt", 6000);
    expect(d).toMatchObject({ allowed: true, bucket_used: 1, bucket_cap: 200, share_used: 1, share_cap: 6000, overall_used: 1, overall_cap: 20000 });
    expect(await callsIn("ip:u:chatgpt:0123456789abcdef")).toBe(1);
    const share = (await db.query<{ cap: number }>("SELECT cap FROM public.mcp_anon_rate WHERE day = $1::date AND bucket = 'global:chatgpt'", [today()])).rows[0];
    expect(share.cap).toBe(6000);
  });

  it("the overall day binds every share, and the refusal hands back the bucket and the share", async () => {
    await seed("global", 20000);
    const d = await check("host:claude", 10000, "global:claude", 10000);
    expect(d).toMatchObject({ allowed: false, refused_by: "overall", overall_used: 20000 });
    expect(await callsIn("ip:host:claude")).toBe(0);
    expect(await callsIn("global:claude")).toBe(0);
  });

  it("a caller's own bucket refuses before its share is touched", async () => {
    await seed("ip:bbbbbbbbbbbbbbbb", 100);
    const d = await check("bbbbbbbbbbbbbbbb", 100, "global:other", 4000);
    expect(d).toMatchObject({ allowed: false, refused_by: "bucket", bucket_used: 100, share_used: 0 });
    expect(await callsIn("global:other")).toBe(0);
    expect(await callsIn("global")).toBe(0);
  });

  it("a caller cannot name the overall row or a minute row as its share", async () => {
    for (const share of ["global", "min:global:0000"]) {
      const d = await check("cccccccccccccccc", 100, share, 1_000_000);
      expect(d.allowed, share).toBe(false);
      expect(d.refused_by).toBe("cap");
    }
    expect(await callsIn("global")).toBe(0);
  });
});

describe("a script cannot hold the database for a minute", () => {
  it("a share's minute refuses the call past its cap and charges nothing for it", async () => {
    for (let i = 0; i < 3; i++) expect((await check(`d${i}`.padEnd(16, "d"), 100, "global:other", 4000, 20000, 3, 60)).allowed).toBe(true);
    const burst = await check("eeeeeeeeeeeeeeee", 100, "global:other", 4000, 20000, 3, 60);
    expect(burst).toMatchObject({ allowed: false, refused_by: "minute", minute_used: 3, minute_cap: 3 });
    expect(await callsIn("ip:eeeeeeeeeeeeeeee")).toBe(0);
    expect(await callsIn("global:other")).toBe(3);
    // Another share's minute is its own.
    expect((await check("host:claude", 10000, "global:claude", 10000, 20000, 3, 60)).allowed).toBe(true);
  });

  it("the overall minute binds across shares and gives back the share's minute it took", async () => {
    expect((await check("host:claude", 10000, "global:claude", 10000, 20000, 30, 2)).allowed).toBe(true);
    expect((await check("ffffffffffffffff", 100, "global:other", 4000, 20000, 15, 2)).allowed).toBe(true);
    const third = await check("host:chatgpt", 2000, "global:chatgpt", 6000, 20000, 20, 2);
    expect(third).toMatchObject({ allowed: false, refused_by: "overall_minute", minute_used: 2, minute_cap: 2 });
    expect(await minuteRows("min:global:chatgpt:")).toBe(0);
    expect(await callsIn("ip:host:chatgpt")).toBe(0);
  });

  it("the first call of a minute removes yesterday's minute rows, refund counters and per-person rows, and keeps addresses", async () => {
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    for (const b of ["min:global:claude:1200", "refund:ip:aaaa", "ip:u:chatgpt:abcd", "ip:f:u:chatgpt:abcd", "ip:aaaaaaaaaaaaaaaa"]) await seed(b, 3, yesterday);
    await check("host:claude", 10000, "global:claude", 10000, 20000, 30, 60);
    const left = (await db.query<{ bucket: string }>("SELECT bucket FROM public.mcp_anon_rate WHERE day = $1::date ORDER BY bucket", [yesterday])).rows.map((r) => r.bucket);
    expect(left).toEqual(["ip:aaaaaaaaaaaaaaaa"]);
  });
});

describe("the forms pool is a pool of its own, split by platform", () => {
  it("a forms call counts on its platform's part, the pool's day and the pool's minute, never the lookups' day or minute", async () => {
    const d = await formsCheck("host:claude", "claude", 2000);
    expect(d).toMatchObject({ allowed: true, share_used: 1, share_cap: 2000, overall_used: 1, overall_cap: 5000 });
    expect(await callsIn("global")).toBe(0);
    expect(await callsIn("global:forms")).toBe(1);
    expect(await callsIn("global:forms:claude")).toBe(1);
    expect(await rowsMatching("^min:global:forms:claude:[0-9]{4}$")).toBe(1);
    expect(await rowsMatching("^min:global:forms:[0-9]{4}$")).toBe(1);
    expect(await rowsMatching("^min:global:[0-9]{4}$")).toBe(0);
  });

  it("a spent lookups day does not stop a forms call", async () => {
    await seed("global", 20000);
    expect((await formsCheck("aaaaaaaaaaaaaaaa", "other")).allowed).toBe(true);
  });

  it("a scraper that spends the 'other' part of the pool for the day leaves Claude's and ChatGPT's parts answering", async () => {
    await seed("global:forms:other", 1000);
    const scraper = await formsCheck("bbbbbbbbbbbbbbbb", "other");
    expect(scraper).toMatchObject({ allowed: false, refused_by: "share" });
    expect((await formsCheck("host:claude", "claude", 2000)).allowed).toBe(true);
    expect((await formsCheck("u:chatgpt:abcd", "chatgpt")).allowed).toBe(true);
  });

  it("a scraper that fills the 'other' minute leaves Claude's and ChatGPT's minutes answering", async () => {
    for (let i = 0; i < 4; i++) expect((await formsCheck(`c${i}cccccccccccccc`, "other")).allowed).toBe(true);
    expect(await formsCheck("dddddddddddddddd", "other")).toMatchObject({ allowed: false, refused_by: "minute" });
    expect((await formsCheck("host:claude", "claude", 2000)).allowed).toBe(true);
    expect((await formsCheck("host:chatgpt", "chatgpt", 2000)).allowed).toBe(true);
  });

  it("the pool's own day still binds every platform, and a refusal hands back the platform's part", async () => {
    await seed("global:forms", 5000);
    expect(await formsCheck("host:claude", "claude", 2000)).toMatchObject({ allowed: false, refused_by: "overall" });
    expect(await callsIn("global:forms:claude")).toBe(0);
    expect(await callsIn("ip:f:host:claude")).toBe(0);
  });

  it("only the two overall rows may be named as one, and neither as a share", async () => {
    expect(await check("f:aaaaaaaaaaaaaaaa", 100, "global:forms", 5000, null, 20)).toMatchObject({ allowed: false, refused_by: "cap" });
    expect(await check("f:aaaaaaaaaaaaaaaa", 100, "global:forms:other", 1000, 5000, 4, 20, "global:claude")).toMatchObject({ allowed: false, refused_by: "cap" });
    expect(await check("aaaaaaaaaaaaaaaa", 100, "global:other", 4000, 20000, 15, 60, "global:forms")).toMatchObject({ allowed: true });
  });
});

describe("a refund is for a fault in transit, and it is bounded", () => {
  it("gives one counted call back to its bucket, share and overall day, never its minute", async () => {
    await check("aaaaaaaaaaaaaaaa", 100, "global:other", 4000, 20000, 15, 60);
    expect(await refund("aaaaaaaaaaaaaaaa", "global:other", true)).toBe(true);
    expect(await callsIn("ip:aaaaaaaaaaaaaaaa")).toBe(0);
    expect(await callsIn("global:other")).toBe(0);
    expect(await callsIn("global")).toBe(0);
    expect(await minuteRows("min:global:other:")).toBe(1);
  });

  it("stops at its daily limit per bucket", async () => {
    for (let i = 0; i < 4; i++) await check("aaaaaaaaaaaaaaaa", 100, "global:other", 4000);
    expect(await refund("aaaaaaaaaaaaaaaa", "global:other", true, 2)).toBe(true);
    expect(await refund("aaaaaaaaaaaaaaaa", "global:other", true, 2)).toBe(true);
    expect(await refund("aaaaaaaaaaaaaaaa", "global:other", true, 2)).toBe(false);
    expect(await callsIn("ip:aaaaaaaaaaaaaaaa")).toBe(2);
  });

  it("cannot give back a call that was never counted, or a forms call to the lookups' day", async () => {
    expect(await refund("neverseen0000000", "global:other", true)).toBe(false);
    await seed("global", 5);
    await formsCheck("aaaaaaaaaaaaaaaa", "other");
    expect(await refund("f:aaaaaaaaaaaaaaaa", "global:forms:other", true, 5, "global:forms")).toBe(true);
    expect(await callsIn("global")).toBe(5);
    expect(await callsIn("global:forms")).toBe(0);
    expect(await callsIn("global:forms:other")).toBe(0);
    expect(await refund("f:aaaaaaaaaaaaaaaa", "global:forms", true, 5, "global:forms"), "the pool is never a share").toBe(false);
  });
});

describe("who may call it, and what the reader counts", () => {
  it("only the service role runs either function; the table stays closed to the client roles", async () => {
    for (const old of ["public.mcp_anon_check_v2(text, integer, text, integer, integer, integer, integer)", "public.mcp_anon_refund(text, text, boolean, integer)"]) {
      expect((await db.query<{ p: string | null }>("SELECT to_regprocedure($1)::text AS p", [old])).rows[0].p, `the unreleased shape ${old} is dropped`).toBeNull();
    }
    for (const sig of ["public.mcp_anon_check_v2(text, integer, text, integer, integer, integer, integer, text)", "public.mcp_anon_refund(text, text, boolean, integer, text)"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig]);
        expect(r.rows[0].ok, `${role} on ${sig}`).toBe(false);
      }
      expect((await db.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok", [sig])).rows[0].ok).toBe(true);
    }
    for (const role of ["anon", "authenticated"]) {
      expect((await db.query<{ ok: boolean }>("SELECT has_table_privilege($1, 'public.mcp_anon_rate', 'SELECT') AS ok", [role])).rows[0].ok).toBe(false);
    }
  });

  it("the adoption reader counts an address row and never a share, minute, refund or forms row", async () => {
    await seed("global", 40);
    await seed("ip:aaaaaaaaaaaaaaaa", 7);
    await seed("global:claude", 30);
    await seed("min:global:claude:1200", 30);
    await seed("refund:ip:aaaaaaaaaaaaaaaa", 1);
    await seed("ip:f:aaaaaaaaaaaaaaaa", 50);
    await seed("ip:host:claude", 30);
    const { rows } = await db.query<{ unkeyed_calls: number; unkeyed_addresses: number; unkeyed_address_calls_max: number }>(
      "SELECT unkeyed_calls, unkeyed_addresses, unkeyed_address_calls_max FROM public.agent_adoption_metrics(1)",
    );
    expect(rows[0]).toEqual({ unkeyed_calls: 40, unkeyed_addresses: 1, unkeyed_address_calls_max: 7 });
  });

  it("runs again cleanly, both self-checks included, and leaves no self-check row behind", async () => {
    await db.exec(migration(V2));
    await db.exec(migration(READER));
    const left = await db.query("SELECT bucket FROM public.mcp_anon_rate WHERE bucket LIKE '%selfcheck%'");
    expect(left.rows).toEqual([]);
  });
});
