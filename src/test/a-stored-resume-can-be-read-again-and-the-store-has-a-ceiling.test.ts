// @vitest-environment node
/**
 * A STORED RÉSUMÉ CAN BE READ AGAIN, AND THE STORE HAS A CEILING.
 *
 * Migration 20261005123000, applied to a real Postgres (pglite) on top of the
 * write budget the census created (its own CREATE statements, read out of
 * 20261004110000, so a change there is a change here):
 *   - get_temp_resume reads without deleting (defect sweep 1.27): the webhook,
 *     the retry sweep and the success page can all read the same session, so
 *     a delivery that failed once can be generated again; an expired row is
 *     invisible; a malformed id returns nothing;
 *   - store_temp_resume, open to the publishable key because the homepage
 *     pre-stores every scanned résumé, is bounded on its WRITER first, so no
 *     one writer can refuse everybody's checkout (review of claude/w1-scan-ai:
 *     a shared 1,000-an-hour budget and a 5,000-row ceiling let ~34 rotating
 *     addresses refuse every buyer for a day): 30 rows an hour per address
 *     (the platform's address: a forged first forwarded hop changes nothing),
 *     120 an hour and 150 unexpired rows per network (IPv4 /24, IPv6 /48);
 *     only past 8,000 unexpired rows does everyone share a limit, and even
 *     then a wider network (/16, /32) holding fewer than 5 rows still
 *     stores, until 10,000. A refusal answers NULL, and malformed input still
 *     raises the messages callers know;
 *   - without the census's budget functions the file refuses to apply,
 *     rather than applying cleanly and failing every store with 42883.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { splitStatements } from "./helpers/function-acl";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const read = (prefix: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(prefix))!), "utf8");
const MIGRATION = read("20261005123000_");
const CENSUS = read("20261004110000_");

/** The census's own definitions of the write budget and the address it keys on. */
function budgetDdl(): string {
  const wanted = [
    /^CREATE OR REPLACE FUNCTION public\.request_client_address\(\)/i,
    /^CREATE TABLE IF NOT EXISTS public\.client_write_budget/i,
    /^CREATE OR REPLACE FUNCTION public\.client_write_allowed\(/i,
  ];
  const picked = splitStatements(CENSUS).filter((s) => wanted.some((re) => re.test(s.trim())));
  if (picked.length !== 3) throw new Error(`expected the census's 3 budget statements, found ${picked.length}`);
  return picked.map((s) => `${s};`).join("\n");
}

let pg: PGlite;
const asAnon = async <T,>(headers: Record<string, string>, sql: string, params: unknown[] = []) => {
  await pg.exec("SET ROLE anon");
  try {
    await pg.query("SELECT set_config('request.headers', $1, false)", [JSON.stringify(headers)]);
    return (await pg.query<T>(sql, params)).rows;
  } finally {
    await pg.exec("RESET ROLE");
  }
};
const store = (ip: string, text = "Jane Doe, senior engineer. ".repeat(4)) =>
  asAnon<{ id: string | null }>({ "cf-connecting-ip": ip }, "SELECT public.store_temp_resume(p_resume => $1) AS id", [text]).then((r) => r[0].id);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await pg.exec(`
    CREATE TABLE public.temp_resume_storage (
      session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      resume_text text NOT NULL,
      linkedin_text text,
      job_description_text text,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'));
    ALTER TABLE public.temp_resume_storage ENABLE ROW LEVEL SECURITY;
    -- The 2025-12-20 definitions, open to the publishable key as production holds them.
    CREATE FUNCTION public.get_temp_resume(p_session_id text)
      RETURNS TABLE(resume_text text, linkedin_text text, job_description_text text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
    DECLARE v_uuid uuid;
    BEGIN
      IF p_session_id IS NULL OR p_session_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN; END IF;
      v_uuid := p_session_id::uuid;
      RETURN QUERY DELETE FROM temp_resume_storage WHERE session_id = v_uuid AND expires_at > NOW()
        RETURNING temp_resume_storage.resume_text, temp_resume_storage.linkedin_text, temp_resume_storage.job_description_text;
    END $f$;
    CREATE FUNCTION public.store_temp_resume(p_resume text, p_linkedin text DEFAULT NULL, p_job_description text DEFAULT NULL)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
    DECLARE v_id uuid;
    BEGIN
      IF p_resume IS NULL OR length(p_resume) < 50 THEN RAISE EXCEPTION 'Invalid resume text'; END IF;
      INSERT INTO temp_resume_storage (resume_text, linkedin_text, job_description_text) VALUES (p_resume, p_linkedin, p_job_description) RETURNING session_id INTO v_id;
      RETURN v_id;
    END $f$;
    GRANT EXECUTE ON FUNCTION public.get_temp_resume(text) TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.store_temp_resume(text, text, text) TO anon, authenticated, service_role;
  `);
  await pg.exec(budgetDdl());
  await pg.exec(`BEGIN;\n${MIGRATION}\nCOMMIT;`);
}, 120_000);

afterAll(async () => { await pg?.close(); });

describe("get_temp_resume reads without consuming", () => {
  it("the webhook, the retry sweep and the success page all find the same résumé", async () => {
    const id = await store("203.0.113.1");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    for (let reader = 0; reader < 3; reader++) {
      const rows = await asAnon<{ resume_text: string }>({}, "SELECT * FROM public.get_temp_resume($1)", [id]);
      expect(rows.map((r) => r.resume_text.slice(0, 8)), `read ${reader + 1}`).toEqual(["Jane Doe"]);
    }
  });

  it("an expired row and a malformed id return nothing", async () => {
    const id = await store("203.0.113.2");
    await pg.query("UPDATE public.temp_resume_storage SET expires_at = now() - interval '1 second' WHERE session_id = $1", [id]);
    expect(await asAnon({}, "SELECT * FROM public.get_temp_resume($1)", [id])).toEqual([]);
    expect(await asAnon({}, "SELECT * FROM public.get_temp_resume('not-a-uuid')")).toEqual([]);
  });
});

describe("store_temp_resume is bounded", () => {
  it("malformed input still raises the message callers know", async () => {
    await expect(asAnon({ "cf-connecting-ip": "203.0.113.3" }, "SELECT public.store_temp_resume(p_resume => 'short')")).rejects.toThrow(/Invalid resume text/);
  });

  it("one address gets 30 an hour; a forged first forwarded hop is the same address", async () => {
    const ids: Array<string | null> = [];
    for (let i = 0; i < 32; i++) {
      // The client writes the first hop; the platform appends the last one.
      ids.push((await asAnon<{ id: string | null }>(
        { "x-forwarded-for": `10.0.${i}.1, 198.51.100.9` },
        "SELECT public.store_temp_resume(p_resume => $1) AS id", ["Jane Doe, senior engineer. ".repeat(4)]))[0].id);
    }
    expect(ids.slice(0, 30).every((x) => typeof x === "string")).toBe(true);
    expect(ids.slice(30)).toEqual([null, null]);
    // Another address is unaffected.
    expect(await store("198.51.100.10")).toMatch(/^[0-9a-f-]{36}$/);
  });

  const reset = async () => {
    await pg.exec("DELETE FROM public.client_write_budget; DELETE FROM public.temp_resume_storage;");
  };
  const netOf = async (id: string | null) =>
    (await pg.query<{ n: string | null }>("SELECT writer_net AS n FROM public.temp_resume_storage WHERE session_id = $1", [id])).rows[0]?.n;
  const md5 = async (t: string) => (await pg.query<{ h: string }>("SELECT md5($1) AS h", [t])).rows[0].h;
  const fill = (n: number, net: string, wide: string) =>
    pg.query("INSERT INTO public.temp_resume_storage (resume_text, writer_net, writer_wide) SELECT 'filler', md5($1), md5($2) FROM generate_series(1, $3::int)", [net, wide, n]);

  it("names the writer's network on the row, as an md5 of an IPv4 /24 or an IPv6 /48", async () => {
    await reset();
    expect(await netOf(await store("192.0.2.200"))).toBe(await md5("192.0.2.0/24"));
    expect(await netOf(await store("2001:db8:1:2::5"))).toBe(await md5("2001:db8:1::/48"));
    // Not an address: the shared bucket, never an error.
    expect(await netOf(await store("not-an-address"))).toBe("no-network");
  });

  it("one network gets 120 an hour across its addresses; the next network is untouched", async () => {
    await reset();
    const ids: Array<string | null> = [];
    for (let i = 0; i < 122; i++) ids.push(await store(`192.0.2.${10 + (i % 5)}`)); // 5 addresses, each under 30
    expect(ids.slice(0, 120).every((x) => typeof x === "string")).toBe(true);
    expect(ids.slice(120)).toEqual([null, null]);
    expect(await store("192.0.3.10")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a network holding 150 unexpired rows is refused from every address in it, and refuses nobody else", async () => {
    await reset();
    await fill(150, "192.0.2.0/24", "192.0.0.0/16");
    expect(await store("192.0.2.99")).toBeNull();
    expect(await store("198.51.100.20")).toMatch(/^[0-9a-f-]{36}$/);
    // Rows expire with the 24-hour clock, and the network may store again.
    await pg.exec("UPDATE public.temp_resume_storage SET expires_at = now() - interval '1 second' WHERE resume_text = 'filler' AND session_id IN (SELECT session_id FROM public.temp_resume_storage WHERE resume_text = 'filler' LIMIT 1)");
    expect(await store("192.0.2.99")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a rotating pool that fills 8,000 rows still leaves every fresh network room; only 10,000 refuses all", async () => {
    await reset();
    // 54 networks of filler, each at its 150, is what 8,000 takes.
    for (let n = 0; n < 53; n++) await fill(150, `10.${n}.0.0/24`, `10.${n}.0.0/16`);
    await fill(8000 - 53 * 150, "10.99.0.0/24", "10.99.0.0/16");
    // A filler network is still held to its own 150.
    expect(await store("10.5.0.9")).toBeNull();
    expect(await store("203.0.113.9"), "a visitor from a fresh network was refused").toMatch(/^[0-9a-f-]{36}$/);
    // A wider network (here a filler's /16) holding 5 rows is out of room.
    expect(await store("10.0.7.7")).toBeNull();
    for (let i = 0; i < 4; i++) expect(await store(`203.0.${114 + i}.1`)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store("203.0.200.1"), "a /16 already holding 5 rows past the soft ceiling").toBeNull();
    await fill(10000 - (await pg.query<{ c: number }>("SELECT count(*)::int AS c FROM public.temp_resume_storage WHERE expires_at > now()")).rows[0].c, "10.100.0.0/24", "10.100.0.0/16");
    expect(await store("198.18.0.1")).toBeNull();
  });
});

describe("the file needs the census it builds on", () => {
  it("refuses to apply without request_client_address and client_write_allowed", async () => {
    const bare = new PGlite();
    try {
      await bare.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
      await bare.exec(`CREATE TABLE public.temp_resume_storage (session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_text text NOT NULL,
        linkedin_text text, job_description_text text, created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'));`);
      await expect(bare.exec(`BEGIN;\n${MIGRATION}\nCOMMIT;`)).rejects.toThrow(/apply 20261004110000/);
    } finally {
      await bare.close();
    }
  });
});
