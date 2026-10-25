// resume-match's door and budgets, in Deno, against a recording client.
//
// (Named *_test.ts, Deno's other test suffix, so vitest never sweeps it into
// the npm run; scripts/deno-tests.sh runs it. The pglite tests in
// src/test/match-endpoint.test.ts run the same handler against a real
// Postgres; this file pins what a recording client can see best: every
// statement sent, every write, every log line.)
//
// THE CANARY. Nothing about the reader is logged, written or forwarded: a
// canary résumé (mcp, service role) and canary profile values (site: city,
// work authorisation, licence, years, former job) are fed in, and none may
// appear in a log line or a write, and none but the reader's own city and
// titles (the fields that say what was searched) may appear in the answer.
//
// Run: deno test --allow-env --allow-read supabase/functions/resume-match/

import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type Deps, followUpToken, followUpValid, handle, RATE_RPC, SERVER_SURFACE_EXCLUDED_SOURCES, SITE_PER_NETWORK_HOUR, siteInput, TOKEN_USE_PREFIX,
  WIDEN_PER_NETWORK_HOUR,
} from "./handler.ts";
import { CANDIDATES_DEADLINE_MS, clearRingCache, RING_DEADLINE_MS } from "./pipeline.ts";

const SERVICE = "service_test_key_0123456789abcdef0123456789abcdef";
const BUILD = "resume-match.2026-10-16.1";

type Call = { kind: "rpc" | "select" | "write"; name: string; args: unknown };

interface FakeOpts {
  candidates?: (args: Record<string, unknown>, n: number) => unknown[] | Promise<unknown[]>;
  ring?: unknown[];
  ringDelayMs?: number;
  anon?: { data: unknown; error: unknown } | (() => Promise<never>);
  limit?: { data: unknown; error: unknown };
  /** Answers for the first limiter calls, in order; then `limit`. */
  limitSeq?: Array<{ data: unknown; error: unknown }>;
  descriptions?: Record<string, string>;
  /** Rows job_posting_requirements already holds. */
  cached?: Array<{ posting_id: string; requirements: unknown; posting_terms: string[] | null; description_chars: number }>;
}

function fakeClient(o: FakeOpts = {}) {
  const calls: Call[] = [];
  let candidateCalls = 0;
  let limitCalls = 0;
  const thenable = <T>(p: Promise<T>) => Object.assign(p, { abortSignal: () => p });
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ kind: "rpc", name, args });
      if (name === "job_board_anon_check") {
        if (typeof o.anon === "function") return thenable(o.anon());
        return thenable(Promise.resolve(o.anon ?? { data: [{ is_allowed: true, used_today: 1, cap_today: 10000 }], error: null }));
      }
      if (name === RATE_RPC) return thenable(Promise.resolve(o.limitSeq?.[limitCalls++] ?? o.limit ?? { data: true, error: null }));
      if (name === "metro_ring") {
        const answer = { data: o.ring ?? [], error: null };
        return thenable(o.ringDelayMs ? new Promise((res) => setTimeout(() => res(answer), o.ringDelayMs)) : Promise.resolve(answer));
      }
      if (name === "match_candidates") {
        const n = candidateCalls++;
        return thenable(Promise.resolve(o.candidates ? o.candidates(args, n) : []).then((data) => ({ data, error: null })));
      }
      return thenable(Promise.resolve({ data: null, error: { code: "42883", message: "unknown rpc" } }));
    },
    from(table: string) {
      const q: Record<string, unknown> = {};
      const sel = (cols: string) => {
        const chain = {
          eq: () => chain,
          in: (_c: string, ids: string[]) => {
            calls.push({ kind: "select", name: table, args: { cols, ids } });
            if (table === "job_board_postings") {
              const data = ids.filter((id) => o.descriptions?.[id]).map((id) => ({ id, description: o.descriptions![id], min_years: null }));
              return thenable(Promise.resolve({ data, error: null }));
            }
            if (table === "job_posting_requirements") return thenable(Promise.resolve({ data: (o.cached ?? []).filter((c) => ids.includes(c.posting_id)), error: null }));
            return thenable(Promise.resolve({ data: [], error: null }));
          },
        };
        return chain;
      };
      q.select = sel;
      q.upsert = (rows: unknown) => { calls.push({ kind: "write", name: table, args: rows }); return thenable(Promise.resolve({ data: null, error: null })); };
      q.insert = (rows: unknown) => { calls.push({ kind: "write", name: table, args: rows }); return thenable(Promise.resolve({ data: null, error: null })); };
      q.update = (rows: unknown) => { calls.push({ kind: "write", name: table, args: rows }); return thenable(Promise.resolve({ data: null, error: null })); };
      return q;
    },
  };
  return { client, calls, candidateCalls: () => candidateCalls };
}

function deps(client: unknown, logs: string[] = []): Deps {
  return {
    build: BUILD,
    client: () => client as ReturnType<Deps["client"]>,
    serviceKey: () => SERVICE,
    clock: () => performance.now(),
    now: () => Date.UTC(2026, 9, 16, 12),
    order: () => "rank",
    log: (l) => logs.push(l),
  };
}

const post = (body: unknown, opts: { service?: boolean; ip?: string } = {}) =>
  new Request("https://x.supabase.co/functions/v1/resume-match", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.service ? SERVICE : "anon-jwt"}`, "x-forwarded-for": opts.ip ?? "198.51.100.7" },
    body: JSON.stringify(body),
  });

const cand = (id: string, over: Record<string, unknown> = {}) => ({
  id, source: "greenhouse", company_token: `co${id}`, company: `Company ${id}`, title: "Cashier", location: "Columbus, OH", country: "US",
  remote: false, work_mode: null, employment_type: null, posted_at: "2026-10-14T00:00:00Z", salary: null, salary_min_annual: null,
  salary_max_annual: null, salary_period: null, salary_currency: null, experience_band: null, min_years: null, agency: false,
  lane: "ring", title_rank: 0.5, siblings: 1, ...over,
});
const COLUMBUS_RING = [{ name: "Columbus", region: "OH", region_name: "Ohio", country: "US", km: 0, population: 900000, center: true }];
const cashier = (over: Record<string, unknown> = {}) => ({
  action: "match",
  profile: { roles: ["Cashier"], home: { city: "Columbus", region: "OH", country: "US" }, canWorkIn: ["US"], radiusKm: 40, level: "entry", ...over },
});

Deno.test("the preflight answers 204 and index.ts stamps every answer with this build", async () => {
  const res = await handle(new Request("https://x/functions/v1/resume-match", { method: "OPTIONS" }), deps(fakeClient().client));
  assertEquals(res.status, 204);
  assertMatch(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assertMatch(src, /const FN_BUILD = "resume-match\.2026-10-16\.\d+";/);
  assertMatch(src, /Deno\.serve\(stamped\(FN_BUILD,/);
  assertEquals((await handle(new Request("https://x", { method: "GET" }), deps(fakeClient().client))).status, 405);
});

Deno.test("résumé text is refused from the site and from anyone without the service-role key", async () => {
  const f = fakeClient();
  const text = "Cashier with five years at a grocery store in Columbus, Ohio. Cash handling, customer service, stocking shelves and opening shifts.";
  const a = await handle(post({ action: "match", resumeText: text }), deps(f.client));
  assertEquals(a.status, 400);
  assertEquals((await a.json()).error, "resume_text_refused");
  const b = await handle(post({ action: "match", resumeText: text, surface: "mcp" }), deps(f.client));
  assertEquals(b.status, 403);
  const c = await handle(post({ action: "match", resumeText: text, surface: "site" }, { service: true }), deps(f.client));
  assertEquals(c.status, 400, "even the service role may not send text on the site surface");
  assertEquals(f.calls.length, 0, "nothing was asked of the database");
});

Deno.test("the mcp and v1 surfaces withhold the sources /v1 may not redistribute; the site withholds nothing", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: () => [cand("1")] });
  const text = "Retail Cashier\nColumbus, OH\n\nEXPERIENCE\nCashier, Kroger, Columbus, OH, 2019 - 2024\nCash handling and customer service on a busy front end.";
  const r = await handle(post({ action: "match", resumeText: text, surface: "mcp" }, { service: true }), deps(f.client));
  assertEquals(r.status, 200);
  const mc = f.calls.filter((c) => c.name === "match_candidates");
  assert(mc.length >= 1);
  for (const c of mc) assertEquals((c.args as Record<string, unknown>).p_exclude_sources, [...SERVER_SURFACE_EXCLUDED_SOURCES]);
  assertEquals(f.calls.filter((c) => c.name === RATE_RPC || c.name === "job_board_anon_check").length, 0, "the service role is metered by its own surface");

  const g = fakeClient({ ring: COLUMBUS_RING, candidates: () => [cand("1")] });
  await handle(post(cashier()), deps(g.client));
  for (const c of g.calls.filter((c) => c.name === "match_candidates")) assertEquals((c.args as Record<string, unknown>).p_exclude_sources, null);
});

Deno.test("the board's meter comes first, then 30 an hour per network; a follow-up for the same search spends a separate allowance", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  const first = await handle(post(cashier()), deps(f.client));
  const body = await first.json();
  const order = f.calls.filter((c) => c.kind === "rpc").map((c) => c.name);
  assertEquals(order.slice(0, 2), ["job_board_anon_check", RATE_RPC]);
  const limit = f.calls.find((c) => c.name === RATE_RPC)!.args as Record<string, unknown>;
  assertEquals([limit.p_function, limit.p_max, limit.p_window_minutes], ["resume-match", SITE_PER_NETWORK_HOUR, 60]);
  assertMatch(String(body.followUp), /^v2\.\d+\.2\.[0-9a-f]{32}$/);

  // A follow-up spends its token once (one take of 1 in 30 minutes), then the widening allowance.
  const g = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  await handle(post({ ...cashier(), widen: 2, followUp: body.followUp }), deps(g.client));
  const takes = g.calls.filter((c) => c.name === RATE_RPC).map((c) => c.args as Record<string, unknown>);
  assertEquals(takes.length, 2);
  assertMatch(String(takes[0].p_function), new RegExp(`^${TOKEN_USE_PREFIX}[0-9a-f]{16}$`));
  assertEquals([takes[0].p_max, takes[0].p_window_minutes], [1, 30]);
  assertEquals([takes[1].p_function, takes[1].p_max], ["resume-match-widen", WIDEN_PER_NETWORK_HOUR]);

  // A spent token counts against the 30 like a new search.
  const spent = fakeClient({ ring: COLUMBUS_RING, candidates: () => [], limitSeq: [{ data: false, error: null }] });
  await handle(post({ ...cashier(), widen: 2, followUp: body.followUp }), deps(spent.client));
  assertEquals((spent.calls.filter((c) => c.name === RATE_RPC)[1].args as Record<string, unknown>).p_function, "resume-match");

  const h = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  await handle(post({ ...cashier({ roles: ["Barista"] }), widen: 2, followUp: body.followUp }), deps(h.client));
  assertEquals((h.calls.find((c) => c.name === RATE_RPC)!.args as Record<string, unknown>).p_function, "resume-match", "a token for another search is a new search");
  const k = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  await handle(post({ ...cashier(), widen: 5, followUp: body.followUp }), deps(k.client));
  assertEquals(k.calls.filter((c) => c.name === RATE_RPC).map((c) => (c.args as Record<string, unknown>).p_function), ["resume-match"], "a token for step 2 does not pay for step 5");
});

Deno.test("a full hour is a 429 naming the shared network allowance; a limiter that cannot answer is a 503, never a pass", async () => {
  const full = fakeClient({ limit: { data: false, error: null } });
  const r = await handle(post(cashier()), deps(full.client));
  assertEquals(r.status, 429);
  assertEquals(r.headers.get("retry-after"), "3600");
  const b = await r.json();
  assertEquals([b.limit, b.window, b.scope], [SITE_PER_NETWORK_HOUR, "1h", "network"]);
  assertEquals(full.calls.filter((c) => c.name === "match_candidates").length, 0);

  for (const broken of [
    fakeClient({ limit: { data: null, error: { message: "down" } } }),
    fakeClient({ limit: { data: "yes", error: null } }),
    fakeClient({ anon: { data: null, error: { message: "down" } } }),
    fakeClient({ anon: () => Promise.reject(new Error("socket")) }),
  ]) {
    const x = await handle(post(cashier()), deps(broken.client));
    assertEquals(x.status, 503);
    assertEquals(broken.calls.filter((c) => c.name === "match_candidates").length, 0);
  }

  const blocked = fakeClient({ anon: { data: [{ is_allowed: false, network_rule: true, cap_today: 0, used_today: 0 }], error: null } });
  assertEquals((await handle(post(cashier()), deps(blocked.client))).status, 429);
  assertEquals(blocked.calls.filter((c) => c.name === RATE_RPC || c.name === "match_candidates").length, 0, "refused before any work");
});

Deno.test("a follow-up token is bound to its search and its step, and expires", async () => {
  const input = siteInput(cashier().profile);
  const now = Date.UTC(2026, 9, 16);
  const t = await followUpToken(SERVICE, input, now, 2);
  assert(await followUpValid(SERVICE, t, input, now + 60_000, 2));
  assert(!(await followUpValid(SERVICE, t, input, now + 60_000, 3)), "another step");
  assert(!(await followUpValid(SERVICE, t.replace(/^v2\.(\d+)\.2\./, "v2.$1.3."), input, now, 3)), "a step rewritten in the token");
  assert(!(await followUpValid(SERVICE, t, input, now + 31 * 60_000, 2)), "expired after 30 minutes");
  assert(!(await followUpValid(SERVICE, t, siteInput(cashier({ radiusKm: 80 }).profile), now, 2)), "another search");
  assert(!(await followUpValid(SERVICE, t.replace(/.$/, (c) => (c === "0" ? "1" : "0")), input, now, 2)), "tampered");
  assert(!(await followUpValid("", t, input, now, 2)));
  assert(!(await followUpValid(SERVICE, 42, input, now, 2)));
});

Deno.test("a reader's own words never become query syntax, and a fallback never widens to any word order", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  const twenty = ["CA", "GB", "DE", "FR", "IE", "NL", "ES", "IT", "PT", "PL", "US", "SE", "NO", "DK", "FI", "BE", "AT", "CH", "AU", "NZ"];
  await handle(post({ action: "match", profile: { roles: ["-zzz"], home: { city: "Columbus", region: "OH", country: "US" }, canWorkIn: twenty, relocate: "country", remote: true } }), deps(f.client));
  const mc = f.calls.filter((c) => c.name === "match_candidates").map((c) => c.args as Record<string, unknown>);
  assertEquals(mc.length, 1, "no any-word-order statement for a reader's own words");
  assertEquals(mc[0].p_q_en, '"zzz"');
  assertEquals((mc[0].p_countries as string[])[0], "US", "the home country first: the country lane reads three");
  const g = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  await handle(post({ action: "match", profile: { roles: ["worker or staff or team or crew"], home: { city: "Columbus", region: "OH", country: "US" } }, widen: 1 }), deps(g.client));
  assertEquals((g.calls.find((c) => c.name === "match_candidates")!.args as Record<string, unknown>).p_q_en, '"worker staff team crew"');
});

Deno.test("widening step 5 places the reader's own region and says 'elsewhere in'", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: () => [cand("cle", { location: "Cleveland, OH", lane: "region" })] });
  const body = await (await handle(post({ ...cashier(), widen: 5 }), deps(f.client))).json();
  const args = f.calls.find((c) => c.name === "match_candidates")!.args as Record<string, unknown>;
  assertEquals(args.p_regions, ["Ohio", ", OH"]);
  assertEquals(args.p_ring, []);
  const row = body.rows.find((r: { id: string }) => r.id === "cle");
  assert(row, "the Cleveland row is shown, not set aside as beyond the commute");
  assertEquals(row.placeLine, "elsewhere in Ohio");
  assert(row.gaps.includes("found by a wider search"));
});

Deno.test("a missed ring deadline falls back to the city and the request goes on: requirements are still read", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, ringDelayMs: RING_DEADLINE_MS + 150, candidates: (_a, n) => (n === 0 ? [cand("r1")] : []), descriptions: { r1: "Cashier at a busy neighbourhood store. Requirements:\n- Cash handling experience required.\n- Customer service skills and a friendly manner with every guest at the front end, weekends included." } });
  const body = await (await handle(post(cashier()), deps(f.client))).json();
  assertEquals(body.deadlineMissed, "ring");
  assertEquals(body.searched.ringSource, "city-only");
  assert(f.calls.some((c) => c.kind === "select" && c.name === "job_board_postings"), "the descriptions were read");
  assertEquals(body.rows.find((r: { id: string }) => r.id === "r1").requirements, "read");
  await new Promise((r) => setTimeout(r, 200));
});

Deno.test("one automatic widening step at most, and an explicit step runs alone", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  const r = await (await handle(post(cashier()), deps(f.client))).json();
  assertEquals(f.candidateCalls(), 2, "the exact search, then any word order");
  assertEquals(r.steps.map((s: { step: number }) => s.step), [0, 1]);
  assertEquals(r.thin, true);

  const g = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  const w = await (await handle(post({ ...cashier(), widen: 4 }), deps(g.client))).json();
  assertEquals(g.candidateCalls(), 1, "80 km, once");
  assertEquals(w.searched.radiusKm, 80);
});

Deno.test("after a missed deadline no further statement runs in that request", async () => {
  clearRingCache();
  const f = fakeClient({
    ring: COLUMBUS_RING,
    candidates: () => new Promise((res) => setTimeout(() => res([cand("late")]), CANDIDATES_DEADLINE_MS + 150)),
  });
  const res = await handle(post(cashier()), deps(f.client));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.deadlineMissed, "candidates");
  assertEquals(f.candidateCalls(), 1, "no widening statement joined the one still running");
  assertEquals(f.calls.filter((c) => c.kind === "select").length, 0, "no requirements read either");
  await new Promise((r) => setTimeout(r, 200));
});

Deno.test("an unread row is never Strong; quotes are at most 160 characters; at most six uncached keyword walks", async () => {
  clearRingCache();
  const long = "Requirements:\n- " + "Must hold a current state food handler card and be able to lift 50 pounds repeatedly during a shift, ".repeat(4) + "\n- Cash handling experience required.\n";
  const descriptions: Record<string, string> = {};
  for (let i = 0; i < 9; i++) descriptions[`r${i}`] = `Cashier at a busy store. ${long} Customer service, POS systems, inventory and merchandising duties across the front end.`;
  const rows = [...Array.from({ length: 9 }, (_, i) => cand(`r${i}`)), cand("unread")];
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: (_a, n) => (n === 0 ? rows : []), descriptions });
  const body = await (await handle(post(cashier()), deps(f.client))).json();
  const unread = body.rows.find((r: { id: string }) => r.id === "unread");
  assertEquals(unread.requirements, "not read");
  assert(unread.tier !== "strong");
  assert(unread.gaps.includes("requirements not read"));
  for (const r of body.rows) {
    if (r.requirements === "not read") continue;
    for (const line of [...r.facets.requirements.must, ...r.facets.requirements.nice]) assert(line.length <= 160, `quote of ${line.length}`);
  }
  assert(body.basis.walked <= 6, `walked ${body.basis.walked}`);
  assertEquals(body.rows.filter((r: { postingTerms: unknown }) => r.postingTerms === "pending").length >= 1, true);
  assertMatch(body.footer, /not a prediction of whether you will be hired/);
});

// ---------------------------------------------------------------------------
// The fixer's round (review of rm/integration 7af55e52): each failed on that commit.
// ---------------------------------------------------------------------------

const READABLE = (n: number) => `Cashier ${n} at a busy neighbourhood store. Requirements:\n- Cash handling experience required.\n- Customer service skills and a friendly manner with every guest at the front end, weekends included.`;

Deno.test("the notes say true things: commute-area rows counted alone, no home city said, pending counts only what will fill", async () => {
  clearRingCache();
  const remote = [cand("rm1", { location: "Remote - US", lane: "remote", remote: true }), cand("rm2", { location: "Remote - US", lane: "remote", remote: true })];
  const f = fakeClient({ ring: [], candidates: (_a, n) => (n === 0 ? [...remote, cand("ring1")] : []) });
  const body = await (await handle(post(cashier({ remote: true })), deps(f.client))).json();
  const thin = body.notes.find((x: string) => /We also tried/.test(x));
  assertEquals(thin, "1 in Columbus; 2 remote. We also tried: any word order.", "only the city was searched, and two rows are remote");

  const g = fakeClient({ ring: [], candidates: () => [cand("x1", { location: "Remote - US", lane: "remote", remote: true })] });
  const noHome = await (await handle(post({ action: "match", profile: { roles: ["Cashier"], canWorkIn: ["US"], remote: true } }), deps(g.client))).json();
  assert(noHome.notes.includes("No home city was given, so no commute area was searched."), JSON.stringify(noHome.notes));

  // Two rows read, one with no readable description: the unreadable one never fills, so it is not pending.
  const h = fakeClient({ ring: COLUMBUS_RING, candidates: (_a, n) => (n === 0 ? [cand("p1"), cand("p2")] : []), descriptions: { p1: READABLE(1) } });
  const pend = await (await handle(post(cashier()), deps(h.client))).json();
  assertEquals(pend.basis.pending, 0, "p1 was walked; p2 has no description to walk");
  assert(!pend.notes.some((x: string) => /keywords pending/.test(x)));
});

Deno.test("countries the reader never named are 'the country your résumé says you live in', not 'where you said'", async () => {
  clearRingCache();
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: (_a, n) => (n === 0 ? [cand("gb", { location: "London", country: "GB" }), cand("oh")] : []) });
  const text = "Retail Cashier\nColumbus, OH\n\nEXPERIENCE\nCashier, Kroger, Columbus, OH, 2019 - 2024\nCash handling and customer service on a busy front end.";
  const body = await (await handle(post({ action: "match", resumeText: text, surface: "mcp" }, { service: true }), deps(f.client))).json();
  assertMatch(body.footer, /the country your résumé says you live in/);
  assertEquals(body.setAside.outside_countries?.label, "Outside the country your résumé says you live in");
  const said = await (await handle(post({ action: "match", resumeText: text, surface: "mcp", overrides: { canWorkIn: ["US"] } }, { service: true }), deps(fakeClient({ ring: COLUMBUS_RING, candidates: () => [] }).client))).json();
  assertMatch(said.footer, /where you said you can work/);
});

Deno.test("every step's deadline is what is left of 2.5 s: late in the request the descriptions are not read, and the cache write goes after the answer", async () => {
  clearRingCache();
  let now = 0;
  const f = fakeClient({ ring: COLUMBUS_RING, candidates: (_a, n) => { if (n === 0) now = 1_750; return n === 0 ? [cand("late1")] : []; }, descriptions: { late1: READABLE(1) } });
  const d = { ...deps(f.client), clock: () => now };
  const body = await (await handle(post(cashier()), d)).json();
  assertEquals(f.calls.filter((c) => c.kind === "select").length, 0, "1.75 s in, 750 ms left: no description read starts");
  assert(body.notes.some((x: string) => /requirements not read: the page answered before/.test(x)));

  const bg: Promise<unknown>[] = [];
  const g = fakeClient({ ring: COLUMBUS_RING, candidates: (_a, n) => (n === 0 ? [cand("w1")] : []), descriptions: { w1: READABLE(1) } });
  await handle(post(cashier()), { ...deps(g.client), background: (p) => { bg.push(p); } });
  assertEquals(bg.length, 1, "the requirement cache write ran after the answer");
  await Promise.all(bg);
  assertEquals(g.calls.filter((c) => c.kind === "write").length, 1);
});

Deno.test("a cached row whose terms are pending is fetched only to be walked, never to wait again", async () => {
  clearRingCache();
  const reqs = { version: "x", minYears: null, minYearsQuote: null, licence: null, noSponsorship: null, citizenshipRequired: null, citizenOrResident: null, activeClearance: null, clearanceObtainable: null, degree: null, languages: [], shift: null, driving: null, credentials: [], must: [], nice: [] };
  const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const f = fakeClient({
    ring: COLUMBUS_RING, candidates: (_a, n) => (n === 0 ? ids.map((id) => cand(id)) : []),
    cached: ids.map((id) => ({ posting_id: id, requirements: reqs, posting_terms: null, description_chars: 6_000 })),
    descriptions: Object.fromEntries(ids.map((id, i) => [id, READABLE(i)])),
  });
  await handle(post(cashier()), deps(f.client));
  const fetched = f.calls.filter((c) => c.kind === "select" && c.name === "job_board_postings").flatMap((c) => (c.args as { ids: string[] }).ids);
  assert(fetched.length <= 6, `fetched ${fetched.length} descriptions to walk at most 6`);
});

// ---------------------------------------------------------------------------
// The canary
// ---------------------------------------------------------------------------

const CANARY = {
  city: "Quorvale",
  former: "Zephyrine Glassblower",
  licence: "QZ",
  sentence: "Canary sentence zx41 audited eleven thousand quorvale widgets for Brinkleford Holdings",
};
const CANARY_RESUME = [
  "Jordan Canary",
  "Retail Cashier",
  `${CANARY.city}, OH | jordan.canary@example.com | 555-0142`,
  "",
  "SUMMARY",
  CANARY.sentence + ".",
  "Requires sponsorship for US roles. Licensed RN in " + CANARY.licence + ".",
  "",
  "EXPERIENCE",
  `Cashier, Brinkleford Holdings, ${CANARY.city}, OH, 2019 - 2024`,
  "Handled cash, returns and opening shifts for a front end of twelve lanes.",
].join("\n");

function leaks(where: string, s: string, needles: string[]): string[] {
  return needles.filter((n) => s.toLowerCase().includes(n.toLowerCase())).map((n) => `${where}: ${n}`);
}

Deno.test("canary: profile values and résumé text reach no log line, no write and no echo in the answer", async () => {
  clearRingCache();
  assertEquals(leaks("positive control", `[resume-match] city=${CANARY.city}`, [CANARY.city]).length, 1);
  const descriptions = { c1: "Cashier wanted. Requirements:\n- Cash handling experience required.\n- Customer service skills.\nWe are an equal opportunity employer and offer weekly pay." };
  const make = () => fakeClient({ ring: [], candidates: (_a, n) => (n === 0 ? [cand("c1", { location: `${CANARY.city}, OH` })] : []), descriptions });

  // site: canary city, work authorisation, licence, years, former job
  const logs: string[] = [];
  const f = make();
  const res = await handle(post({
    action: "match",
    profile: {
      roles: ["Cashier"], home: { city: CANARY.city, region: "OH", country: "US" }, canWorkIn: ["US"], level: "mid",
      years: { low: 17.25, high: 19.75 }, former: CANARY.former, careerChanger: true,
      licences: [{ kind: "rn", jurisdiction: CANARY.licence, compact: true }],
      workAuth: { status: "work_visa", needsSponsorship: true, citizenOf: ["NZ"], clearance: "ts/sci" },
      // Spec 14: the reader's answers to requirement lines are profile values too (device only; never read here).
      answers: { "Canary line qx9": "no" },
    },
  }), deps(f.client, logs));
  assertEquals(res.status, 200);
  const body = await res.json();
  const bad: string[] = [];
  const everywhere = [CANARY.former, "Zephyrine", "ts/sci", "work_visa", "17.25", "19.75", '"NZ"', `"${CANARY.licence}"`, "qx9"];
  for (const l of logs) bad.push(...leaks("log", l, [...everywhere, CANARY.city]));
  for (const w of f.calls.filter((c) => c.kind === "write")) bad.push(...leaks(`write ${w.name}`, JSON.stringify(w.args), [...everywhere, CANARY.city]));
  // Only the fields that say what was searched may name the reader's own city.
  const { searched, notes, rows, ...rest } = body;
  bad.push(...leaks("answer", JSON.stringify(rest), [...everywhere, CANARY.city]));
  bad.push(...leaks("answer.searched", JSON.stringify({ ...searched, places: [] }), everywhere));
  bad.push(...leaks("answer.notes", JSON.stringify(notes), everywhere));
  for (const r of rows) {
    const { placeLine: _p, location: _l, facets, ...card } = r;
    bad.push(...leaks("answer.row", JSON.stringify(card), everywhere));
    bad.push(...leaks("answer.row.facets", JSON.stringify({ ...facets, place: null }), everywhere));
  }
  assertEquals(bad, []);

  // mcp: the canary résumé, read on the server and dropped
  const logs2: string[] = [];
  const g = make();
  const res2 = await handle(post({ action: "match", resumeText: CANARY_RESUME, surface: "mcp" }, { service: true }), deps(g.client, logs2));
  assertEquals(res2.status, 200);
  const body2 = await res2.text();
  const resumeNeedles = ["zx41", "Brinkleford", "jordan.canary", "555-0142", "Jordan Canary", "eleven thousand"];
  const bad2: string[] = [];
  for (const l of logs2) bad2.push(...leaks("log", l, [...resumeNeedles, CANARY.city, CANARY.licence + "."]));
  for (const w of g.calls.filter((c) => c.kind === "write")) bad2.push(...leaks(`write ${w.name}`, JSON.stringify(w.args), [...resumeNeedles, CANARY.city]));
  for (const c of g.calls.filter((c) => c.kind === "rpc" && c.name !== "metro_ring" && c.name !== "match_candidates")) bad2.push(...leaks(`rpc ${c.name}`, JSON.stringify(c.args), resumeNeedles));
  const flat = CANARY_RESUME.replace(/\s+/g, " ");
  for (let i = 0; i + 30 <= flat.length; i += 5) {
    const run = flat.slice(i, i + 30);
    if (body2.includes(run)) bad2.push(`answer carries résumé text: "${run}"`);
  }
  bad2.push(...leaks("answer", body2, resumeNeedles));
  assertEquals(bad2, []);
});
