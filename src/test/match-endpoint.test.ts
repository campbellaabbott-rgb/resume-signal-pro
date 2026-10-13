// @vitest-environment node
/**
 * RESUME-MATCH, END TO END: the shipped index.ts against the shipped migrations.
 *
 * Each rule of the door and the pipeline is run with a request and read off
 * the response: the build stamp; place, occupation and level gates counted
 * with their basis; "requirements not read" capping a row at Good; the USAJOBS
 * note; the description gates applying only to readers who declared them;
 * résumé text refused from the site and accepted only from the service role;
 * the server surfaces withholding what /v1 may not redistribute; 30 calls an
 * hour per network, follow-ups not counted, a limiter that cannot answer being
 * a 503; the board's blocked networks refused; the requirements cache filled
 * and then read; at most six uncached term walks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addPostings, bootMatchDb } from "./fixtures/match-bench/db";
import { bootEndpoint, columbusCashier, type Endpoint } from "./fixtures/match-bench/endpoint";
import { networkBucket } from "../../supabase/functions/_shared/network-bucket";
import { USAJOBS_NOTE, REQUIREMENTS_NOT_READ, FOOTER } from "../../supabase/functions/_shared/match-tiers";
import { buildIsAtLeast } from "./helpers/fn-build";
import { clearRingCache } from "../../supabase/functions/resume-match/pipeline";
import { SERVICE_KEY } from "./fixtures/match-bench/endpoint";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const DESC_W1 = [
  "Join our store team as a Cashier at our Westerville location.",
  "Requirements",
  "- High school diploma or GED required",
  "- Must be able to work weekends and holidays",
  "- 1+ years of cash handling experience preferred",
  "We are unable to sponsor employment visas for this position.",
].join("\n");
const DESC_W2 = "Front End Cashier. Greet customers, ring up purchases accurately and keep the checkout lanes tidy. No experience required; we train you. Flexible part-time schedules with evening and weekend shifts available. Employee discount and paid time off.";

let db: PGlite;
let ep: Endpoint;

beforeAll(async () => {
  db = await bootMatchDb();
  await addPostings(db, [
    { id: "w1", title: "Cashier", location: "Westerville, OH", country: "US", company: "Kroger", description: DESC_W1 },
    { id: "w2", title: "Front End Cashier", location: "Dublin, OH", country: "US", company: "Giant Eagle", description: DESC_W2 },
    { id: "w3", title: "Cashier", location: "Grove City, OH", country: "US", company: "Meijer" },
    { id: "fed", title: "Cashier", location: "Columbus, OH", country: "US", source: "usajobs", company: "Defense Commissary Agency" },
    { id: "ga", title: "Cashier", location: "Columbus, GA", country: "US", company: "Publix" },
    { id: "null-oh", title: "Cashier", location: "Columbus, OH", country: null, company: "Target" },
    { id: "null-noplace", title: "Cashier", location: "Columbus Campus", country: null, company: "OSU Dining" },
    { id: "mgr", title: "Store Manager - Cashier Operations", location: "Gahanna, OH", country: "US", company: "Aldi" },
    { id: "old18", title: "Cashier", location: "Gahanna, OH", country: "US", company: "Costco", min_years: 18 },
  ]);
  ep = await bootEndpoint(db);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  clearRingCache();
  await db.exec("DELETE FROM public.rate_limits; DELETE FROM public.match_test_blocked;");
  ep.client.rpcFaults.clear();
});

describe("the build and the shape", () => {
  it("the preflight and every answer name the build", async () => {
    const pre = await ep.handler(new Request("https://harness.supabase.co/functions/v1/resume-match", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(buildIsAtLeast(pre.headers.get("x-fn-build"), "resume-match", "2026-10-16", 1)).toBe(true);
    const r = await ep.post(columbusCashier());
    expect(r.status).toBe(200);
    expect(buildIsAtLeast(r.headers.get("x-fn-build"), "resume-match", "2026-10-16", 1)).toBe(true);
    expect(r.body.build).toBe(r.headers.get("x-fn-build"));
    expect(Object.keys(r.body.phaseMs).sort()).toEqual(["anon", "candidates", "requirements", "ring", "terms", "total"]);
    expect(typeof r.body.cpuMs).toBe("number");
    expect(r.body.footer).toBe(FOOTER);
    expect(r.body.family).toEqual({ key: "cashier", label: "Cashier or retail associate" });
  });
});

describe("places, occupations and requirements", () => {
  it("the ring is read from geo_places; Columbus, GA and a placeless row are set aside and counted with their basis", async () => {
    const r = (await ep.post(columbusCashier())).body;
    expect(r.searched.ringSource).toBe("geonames");
    expect(r.searched.places).toEqual(expect.arrayContaining(["Columbus", "Westerville", "Dublin", "Grove City"]));
    const shown = r.rows.map((x: { id: string }) => x.id).sort();
    expect(shown).toEqual(["fed", "null-oh", "old18", "w1", "w2", "w3"]);
    expect(r.setAside.beyond_commute).toMatchObject({ count: 1, basis: `of the ${r.basis.found} postings we found` });
    expect(r.setAside.place_not_stated.count).toBe(1);
    expect(r.setAside.different_occupation.count).toBe(1);
    expect(r.setAsideRows.map((x: { id: string }) => x.id).sort()).toEqual(["ga", "mgr", "null-noplace"]);
    expect(r.summary).toMatch(/^Set aside: /);
  });

  it("a row whose requirements were not read is never Strong and says so; a USAJOBS row carries the reviewed note", async () => {
    const r = (await ep.post(columbusCashier())).body;
    const by = (id: string) => r.rows.find((x: { id: string }) => x.id === id);
    for (const id of ["w3", "fed", "old18", "null-oh"]) {
      expect(by(id).requirements).toBe("not read");
      expect(by(id).tier).not.toBe("strong");
      expect(by(id).gaps).toContain(REQUIREMENTS_NOT_READ);
    }
    expect(by("fed").sourceNote).toBe(USAJOBS_NOTE);
    expect(by("w3").sourceNote).toBeNull();
    expect(by("w1").requirements.noSponsorship).toMatch(/unable to sponsor/);
    expect(by("w1").requirements.degree).toMatchObject({ level: "high_school", must: true });
    expect(by("w2").tier).toBe("strong");
    for (const row of r.rows) {
      if (row.requirements === "not read") continue;
      for (const q of [...row.requirements.must, ...row.requirements.nice]) expect(q.length).toBeLessThanOrEqual(160);
    }
  });

  it("a stored minimum of 16 or more is unknown, not a bar", async () => {
    const r = (await ep.post(columbusCashier())).body;
    const old = r.rows.find((x: { id: string }) => x.id === "old18");
    expect(old.facets.minYears).toBeNull();
    expect(old.gaps.join(" ")).not.toMatch(/18/);
  });

  it("'says it won't sponsor' sets a row aside only for a reader who declared they need sponsorship, counted over the rows read", async () => {
    const plain = (await ep.post(columbusCashier())).body;
    expect(plain.setAside.no_sponsorship).toBeUndefined();
    const needs = (await ep.post(columbusCashier({ workAuth: { status: "student_visa", needsSponsorship: true } }), { ip: "198.51.100.4" })).body;
    expect(needs.rows.map((x: { id: string }) => x.id)).not.toContain("w1");
    expect(needs.setAside.no_sponsorship).toMatchObject({ count: 1, basis: `of the ${needs.basis.read} postings we read` });
  });

  it("thin results widen once automatically and name the step", async () => {
    const r = (await ep.post(columbusCashier())).body;
    expect(r.thin).toBe(true);
    expect(r.steps.map((s: { step: number }) => s.step)).toEqual([0, 1]);
    expect(r.steps[1].label).toBe("any word order");
    expect(r.notes.join(" ")).toMatch(/in your Columbus commute area\. We also tried: any word order/);
    expect(typeof r.followUp).toBe("string");
    expect(r.nextWiden).toBe(2);
  });

  it("an unplaceable city searches the city alone and says so", async () => {
    const r = (await ep.post(columbusCashier({ home: { city: "Zqxjvkw", region: "OH", country: "US" } }), { ip: "198.51.100.77" })).body;
    expect(r.searched.ringSource).toBe("city-only");
    expect(r.notes.join(" ")).toMatch(/Only Zqxjvkw itself was searched/);
  });
});

describe("the requirements cache and the walk budget", () => {
  it("what was read is cached (posting facts only) and the next call reads the cache, not the descriptions", async () => {
    await ep.post(columbusCashier());
    const cached = (await db.query<{ posting_id: string; extractor_version: string }>(`SELECT posting_id, extractor_version FROM public.job_posting_requirements ORDER BY 1`)).rows;
    expect(cached.map((c) => c.posting_id)).toEqual(["w1", "w2"]);
    const before = (await db.query<{ read_at: string }>(`SELECT read_at::text FROM public.job_posting_requirements WHERE posting_id = 'w1'`)).rows[0].read_at;
    // Record which ids the description read asks for.
    const asked: string[][] = [];
    const from = ep.client.from.bind(ep.client);
    ep.client.from = ((table: string) => {
      const q = from(table);
      if (table !== "job_board_postings") return q;
      const inner = q.in.bind(q);
      (q as unknown as { in: (c: string, v: string[]) => unknown }).in = (c: string, v: string[]) => { asked.push([...v]); return inner(c, v); };
      return q;
    }) as typeof ep.client.from;
    try {
      const again = (await ep.post(columbusCashier(), { ip: "198.51.100.5" })).body;
      expect(again.basis.read).toBe(2);
    } finally {
      ep.client.from = from;
    }
    // Rows with no stored description are asked for again (cheap, and a description stored later is then read);
    // the cached ones are not.
    expect(asked.flat()).not.toContain("w1");
    expect(asked.flat()).not.toContain("w2");
    const after = (await db.query<{ read_at: string }>(`SELECT read_at::text FROM public.job_posting_requirements WHERE posting_id = 'w1'`)).rows[0].read_at;
    expect(after, "a cached row is not re-extracted or rewritten").toBe(before);
  });

  it("at most six uncached postings are walked for keywords in one call; the rest say pending", async () => {
    const long = (n: number) => `Grocery Cashier ${n}. ` + "Operate the register, handle cash and card payments, answer customer questions, keep the front end clean and stocked. ".repeat(20);
    await addPostings(db, Array.from({ length: 9 }, (_, i) => ({ id: `walk-${i}`, title: "Grocery Cashier", location: "Gahanna, OH", country: "US", company: `Store ${i}`, description: long(i) })));
    const r = (await ep.post(columbusCashier(), { ip: "198.51.100.6" })).body;
    expect(r.basis.walked).toBeLessThanOrEqual(6);
    expect(r.basis.pending).toBeGreaterThan(0);
    expect(r.rows.some((x: { postingTerms: unknown }) => x.postingTerms === "pending")).toBe(true);
    expect(r.notes.join(" ")).toMatch(/keywords pending/);
  });
});

describe("who may call, with what", () => {
  const resume = "Jordan Example\nColumbus, OH | jordan@example.com | 614-555-0100\nCashier\n\nEXPERIENCE\nCashier - Corner Market, Columbus, OH | 2023 - Present\n- Ran the register and balanced the drawer.\n";

  it("résumé text from the site is refused; the server surfaces answer only the service role", async () => {
    expect((await ep.post({ ...columbusCashier(), resumeText: resume })).status).toBe(400);
    expect((await ep.post({ action: "match", surface: "mcp", resumeText: resume })).status).toBe(403);
    expect((await ep.post({ action: "match", surface: "v1", resumeText: resume })).status).toBe(403);
  });

  it("mcp from the service role reads the résumé on the server and withholds usajobs and smartrecruiters", async () => {
    const r = await ep.post({ action: "match", surface: "mcp", resumeText: resume }, { service: true });
    expect(r.status).toBe(200);
    expect(r.body.searched.excludedSources).toEqual(["usajobs", "smartrecruiters"]);
    expect(r.body.rows.map((x: { id: string }) => x.id)).not.toContain("fed");
    expect(r.body.rows.length).toBeGreaterThan(0);
    expect(r.body.followUp).toBeNull();
  });

  it("bad input is a 400 naming the field; no occupation is a 422 asking for one", async () => {
    const bad = await ep.post(columbusCashier({ radiusKm: 55 }));
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("profile.radiusKm");
    expect((await ep.post(columbusCashier({ roles: ["x".repeat(121)] }))).status).toBe(400);
    expect((await ep.post(columbusCashier({ canWorkIn: Array(21).fill("US") }))).status).toBe(400);
    const none = await ep.post(columbusCashier({ roles: [] }));
    expect(none.status).toBe(422);
    expect(none.body.message).toBe("Type your target role");
    expect((await ep.post({ action: "nope" })).status).toBe(400);
  });
});

describe("abuse: the board's meter, 30 an hour per network, follow-ups apart", () => {
  const seed = async (ip: string, fn: string, n: number) => {
    const bucket = await networkBucket(new Headers({ "x-forwarded-for": ip }), SERVICE_KEY, "resume-match");
    await db.query(`INSERT INTO public.rate_limits (ip_address, function_name, request_count, window_start) VALUES ($1, $2, $3, now())
      ON CONFLICT (ip_address, function_name) DO UPDATE SET request_count = excluded.request_count, window_start = now()`, [bucket, fn, n]);
  };

  it("the 31st call in an hour from one network is a 429 with the limit; another address in the same /24 shares it", async () => {
    await seed("192.0.2.10", "resume-match", 30);
    const r = await ep.post(columbusCashier(), { ip: "192.0.2.10" });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "rate_limited", limit: 30, scope: "network" });
    expect(r.headers.get("retry-after")).toBe("3600");
    expect((await ep.post(columbusCashier(), { ip: "192.0.2.77" })).status).toBe(429);
    expect((await ep.post(columbusCashier(), { ip: "192.0.3.10" })).status).toBe(200);
  });

  it("a widening follow-up carrying the first page's token is not counted against the 30; without it, it is", async () => {
    const first = (await ep.post(columbusCashier(), { ip: "192.0.2.200" })).body;
    await seed("192.0.2.200", "resume-match", 30);
    const follow = await ep.post({ ...columbusCashier(), widen: 2, followUp: first.followUp }, { ip: "192.0.2.200" });
    expect(follow.status).toBe(200);
    expect(follow.body.steps.map((s: { step: number }) => s.step)).toEqual([2]);
    expect((await ep.post({ ...columbusCashier(), widen: 2 }, { ip: "192.0.2.200" })).status).toBe(429);
    const forged = await ep.post({ ...columbusCashier(), widen: 2, followUp: first.followUp.replace(/.$/, (c: string) => (c === "0" ? "1" : "0")) }, { ip: "192.0.2.200" });
    expect(forged.status).toBe(429);
    const otherSearch = await ep.post({ ...columbusCashier({ radiusKm: 80 }), widen: 2, followUp: first.followUp }, { ip: "192.0.2.200" });
    expect(otherSearch.status, "a token is for the search it was issued for").toBe(429);
  });

  it("a limiter that cannot answer is a 503, never a pass", async () => {
    ep.client.rpcFaults.set("check_rate_limit", { code: "57014", message: "canceling statement" });
    const r = await ep.post(columbusCashier(), { ip: "192.0.2.50" });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("limiter_unavailable");
    ep.client.rpcFaults.clear();
    ep.client.rpcFaults.set("job_board_anon_check", { code: "PGRST202", message: "not found" });
    expect((await ep.post(columbusCashier(), { ip: "192.0.2.51" })).status).toBe(503);
  });

  it("a network the board refuses is refused here before any work", async () => {
    await db.query(`INSERT INTO public.match_test_blocked (bucket) VALUES ('192.0.2.0/24')`);
    ep.client.calls = [];
    const r = await ep.post(columbusCashier(), { ip: "192.0.2.99" });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "board_budget", code: "network" });
    expect(ep.client.calls.some((c) => c.kind === "rpc" && c.name === "match_candidates")).toBe(false);
  });

  it("the service role is not metered here (its surfaces carry their own allowance)", async () => {
    ep.client.calls = [];
    await ep.post({ action: "match", surface: "v1", resumeText: "Pat Example\nColumbus, OH | pat@example.com\nCashier\n\nEXPERIENCE\nCashier - Market | 2022 - Present\n- Register and returns, balanced drawers daily." }, { service: true });
    expect(ep.client.calls.some((c) => c.name === "check_rate_limit" || c.name === "job_board_anon_check")).toBe(false);
  });
});
