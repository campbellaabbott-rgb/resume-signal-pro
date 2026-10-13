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
import { type Deps, followUpToken, followUpValid, handle, SERVER_SURFACE_EXCLUDED_SOURCES, SITE_PER_NETWORK_HOUR, siteInput, WIDEN_PER_NETWORK_HOUR } from "./handler.ts";
import { CANDIDATES_DEADLINE_MS, clearRingCache } from "./pipeline.ts";

const SERVICE = "service_test_key_0123456789abcdef0123456789abcdef";
const BUILD = "resume-match.2026-10-16.1";

type Call = { kind: "rpc" | "select" | "write"; name: string; args: unknown };

interface FakeOpts {
  candidates?: (args: Record<string, unknown>, n: number) => unknown[] | Promise<unknown[]>;
  ring?: unknown[];
  anon?: { data: unknown; error: unknown } | (() => Promise<never>);
  limit?: { data: unknown; error: unknown };
  descriptions?: Record<string, string>;
}

function fakeClient(o: FakeOpts = {}) {
  const calls: Call[] = [];
  let candidateCalls = 0;
  const thenable = <T>(p: Promise<T>) => Object.assign(p, { abortSignal: () => p });
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ kind: "rpc", name, args });
      if (name === "job_board_anon_check") {
        if (typeof o.anon === "function") return thenable(o.anon());
        return thenable(Promise.resolve(o.anon ?? { data: [{ is_allowed: true, used_today: 1, cap_today: 10000 }], error: null }));
      }
      if (name === "check_rate_limit") return thenable(Promise.resolve(o.limit ?? { data: true, error: null }));
      if (name === "metro_ring") return thenable(Promise.resolve({ data: o.ring ?? [], error: null }));
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
  assertEquals(f.calls.filter((c) => c.name === "check_rate_limit" || c.name === "job_board_anon_check").length, 0, "the service role is metered by its own surface");

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
  assertEquals(order.slice(0, 2), ["job_board_anon_check", "check_rate_limit"]);
  const limit = f.calls.find((c) => c.name === "check_rate_limit")!.args as Record<string, unknown>;
  assertEquals([limit.p_function, limit.p_max_requests, limit.p_window_minutes], ["resume-match", SITE_PER_NETWORK_HOUR, 60]);
  assertMatch(String(body.followUp), /^v1\.\d+\.[0-9a-f]{32}$/);

  const g = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  await handle(post({ ...cashier(), widen: 2, followUp: body.followUp }), deps(g.client));
  const w = g.calls.find((c) => c.name === "check_rate_limit")!.args as Record<string, unknown>;
  assertEquals([w.p_function, w.p_max_requests], ["resume-match-widen", WIDEN_PER_NETWORK_HOUR]);

  const h = fakeClient({ ring: COLUMBUS_RING, candidates: () => [] });
  await handle(post({ ...cashier({ roles: ["Barista"] }), widen: 2, followUp: body.followUp }), deps(h.client));
  assertEquals((h.calls.find((c) => c.name === "check_rate_limit")!.args as Record<string, unknown>).p_function, "resume-match", "a token for another search is a new search");
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
  assertEquals(blocked.calls.filter((c) => c.name === "check_rate_limit" || c.name === "match_candidates").length, 0, "refused before any work");
});

Deno.test("a follow-up token is bound to its search and expires", async () => {
  const input = siteInput(cashier().profile);
  const now = Date.UTC(2026, 9, 16);
  const t = await followUpToken(SERVICE, input, now);
  assert(await followUpValid(SERVICE, t, input, now + 60_000));
  assert(!(await followUpValid(SERVICE, t, input, now + 31 * 60_000)), "expired after 30 minutes");
  assert(!(await followUpValid(SERVICE, t, siteInput(cashier({ radiusKm: 80 }).profile), now)), "another search");
  assert(!(await followUpValid(SERVICE, t.replace(/.$/, (c) => (c === "0" ? "1" : "0")), input, now)), "tampered");
  assert(!(await followUpValid("", t, input, now)));
  assert(!(await followUpValid(SERVICE, 42, input, now)));
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
    for (const line of [...r.requirements.must, ...r.requirements.nice]) assert(line.length <= 160, `quote of ${line.length}`);
  }
  assert(body.basis.walked <= 6, `walked ${body.basis.walked}`);
  assertEquals(body.rows.filter((r: { postingTerms: unknown }) => r.postingTerms === "pending").length >= 1, true);
  assertMatch(body.footer, /not a prediction of whether you will be hired/);
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
    },
  }), deps(f.client, logs));
  assertEquals(res.status, 200);
  const body = await res.json();
  const bad: string[] = [];
  const everywhere = [CANARY.former, "Zephyrine", "ts/sci", "work_visa", "17.25", "19.75", '"NZ"', `"${CANARY.licence}"`];
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
