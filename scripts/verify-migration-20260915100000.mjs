// Runs 20260915100000 (mcp_anon_rate + mcp_anon_check) in pglite and proves:
//   * a call counts one against the address bucket and one against the global
//     bucket, and is allowed while both are at or under their caps;
//   * the address cap refuses the (cap+1)th call from one address and the row
//     is NOT incremented past the cap -- the write that crossed is the last;
//   * the global cap trips even when no address is over its own cap (many
//     addresses, each well under its cap, together exhaust the day), and a
//     globally refused call is given back to the address that made it;
//   * a refusal leaves both counts where they were: no increment beyond the
//     one that crossed, on either bucket;
//   * a bucket at its cap yesterday does not bind today (day rollover resets);
//   * rows older than seven days are removed by the call; younger rows stay;
//   * a cap below one admits nothing and writes nothing;
//   * the address is never stored -- only the bucket name the caller passed;
//   * anon, authenticated and a PUBLIC-only role cannot execute the function or
//     read the table; service_role can (with a positive control proving the
//     privilege probe can see a grant);
//   * exactly one signature exists in the catalog;
//   * the file is idempotent: a second run applies cleanly and changes nothing.
// Usage: node scripts/verify-migration-20260915100000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = "20260915100000_a_shared_egress_makes_a_per_address_bucket_a_global_one_so_both_exist.sql";
const sql = readFileSync(`supabase/migrations/${MIG}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const db = new PGlite();
const rows = async (q, params) => (await db.query(q, params)).rows;
const one = async (q, params) => (await rows(q, params))[0];
const call = (ip, globalCap, ipCap) => one(`SELECT * FROM public.mcp_anon_check($1, $2, $3)`, [ip, globalCap, ipCap]);
const bucket = async (name) => (await one(`SELECT calls FROM public.mcp_anon_rate r WHERE r.day = (now() AT TIME ZONE 'UTC')::date AND r.bucket = $1`, [name]))?.calls ?? null;
const fnPriv = (role) => one(`SELECT has_function_privilege($1, 'public.mcp_anon_check(text, integer, integer)', 'EXECUTE') AS ok`, [role]).then((r) => r.ok);
const tblPriv = (role, p) => one(`SELECT has_table_privilege($1, 'public.mcp_anon_rate', $2) AS ok`, [role, p]).then((r) => r.ok);

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE nobody_probe;`);

// ---- 1. apply ------------------------------------------------------------------
let threw = "";
try { await db.exec(sql); } catch (e) { threw = String(e?.message ?? e); }
check("the migration applies", threw === "", threw);

// ---- 2. the arithmetic of one address --------------------------------------------
{
  const a = await call("aaaaaaaaaaaaaaaa", 100, 3);
  check("first call is allowed and counts one on both buckets", a.allowed === true && a.ip_used === 1 && a.global_used === 1 && a.ip_cap === 3 && a.global_cap === 100, JSON.stringify(a));
  const b = await call("aaaaaaaaaaaaaaaa", 100, 3);
  const c = await call("aaaaaaaaaaaaaaaa", 100, 3);
  check("the third call (== cap) is still allowed", b.allowed === true && c.allowed === true && c.ip_used === 3 && c.global_used === 3, JSON.stringify(c));
  const d = await call("aaaaaaaaaaaaaaaa", 100, 3);
  check("the fourth call from the same address is refused", d.allowed === false, JSON.stringify(d));
  check("the refused call did not increment the address bucket past the cap", d.ip_used === 3 && (await bucket("ip:aaaaaaaaaaaaaaaa")) === 3);
  check("the refused call did not touch the global bucket", d.global_used === 3 && (await bucket("global")) === 3);
  const e = await call("aaaaaaaaaaaaaaaa", 100, 3);
  check("a fifth call is refused again with the same counts (no drift on repeated refusals)", e.allowed === false && e.ip_used === 3 && e.global_used === 3);
  check("the reply names the caps it was given", e.ip_cap === 3 && e.global_cap === 100);
}

// ---- 3. another address is independent -----------------------------------------
{
  const f = await call("bbbbbbbbbbbbbbbb", 100, 3);
  check("a second address starts at one and is allowed while the first is capped", f.allowed === true && f.ip_used === 1 && f.global_used === 4, JSON.stringify(f));
}

// ---- 4. the global cap trips with no address over its own cap ------------------
{
  // Fresh caps: global 6. Already spent today: 4 (three from a, one from b).
  const g1 = await call("cccccccccccccccc", 6, 3);
  const g2 = await call("dddddddddddddddd", 6, 3);
  check("two more addresses are allowed up to the global cap", g1.allowed === true && g2.allowed === true && g2.global_used === 6, JSON.stringify(g2));
  const g3 = await call("eeeeeeeeeeeeeeee", 6, 3);
  check("TEETH: a fresh address under its own cap is refused when the world is at its cap", g3.allowed === false && g3.global_used === 6, JSON.stringify(g3));
  check("the global bucket was not incremented past its cap", (await bucket("global")) === 6);
  check("the globally refused call was given back to its address (its bucket reads zero, not one)", g3.ip_used === 0 && (await bucket("ip:eeeeeeeeeeeeeeee")) === 0);
  const g4 = await call("eeeeeeeeeeeeeeee", 6, 3);
  check("and it stays refused with the same figures", g4.allowed === false && g4.global_used === 6 && g4.ip_used === 0);
  // The same instant with a higher global cap admits it: the cap is the
  // caller's parameter, and the refusal above was the global bucket's.
  const g5 = await call("eeeeeeeeeeeeeeee", 1000, 3);
  check("a higher global cap admits the same address at once", g5.allowed === true && g5.ip_used === 1 && g5.global_used === 7, JSON.stringify(g5));
}

// ---- 5. day rollover resets ---------------------------------------------------
{
  await db.exec(`INSERT INTO public.mcp_anon_rate (day, bucket, calls) VALUES ((now() AT TIME ZONE 'UTC')::date - 1, 'ip:ffffffffffffffff', 3), ((now() AT TIME ZONE 'UTC')::date - 1, 'global', 999999)`);
  const h = await call("ffffffffffffffff", 1000, 3);
  check("an address and a world at cap YESTERDAY do not bind today", h.allowed === true && h.ip_used === 1, JSON.stringify(h));
  const y = await one(`SELECT calls FROM public.mcp_anon_rate r WHERE r.day = (now() AT TIME ZONE 'UTC')::date - 1 AND r.bucket = 'ip:ffffffffffffffff'`);
  check("yesterday's row is untouched by today's call", y?.calls === 3);
}

// ---- 6. retention -----------------------------------------------------------------
{
  await db.exec(`INSERT INTO public.mcp_anon_rate (day, bucket, calls) VALUES ((now() AT TIME ZONE 'UTC')::date - 8, 'global', 5), ((now() AT TIME ZONE 'UTC')::date - 7, 'global', 4), ((now() AT TIME ZONE 'UTC')::date - 6, 'ip:0000000000000000', 2)`);
  await call("gggggggggggggggg", 1000, 3);
  const old = await one(`SELECT count(*)::int AS n FROM public.mcp_anon_rate r WHERE r.day < (now() AT TIME ZONE 'UTC')::date - 7`);
  const kept7 = await one(`SELECT count(*)::int AS n FROM public.mcp_anon_rate r WHERE r.day = (now() AT TIME ZONE 'UTC')::date - 7`);
  const kept6 = await one(`SELECT count(*)::int AS n FROM public.mcp_anon_rate r WHERE r.day = (now() AT TIME ZONE 'UTC')::date - 6`);
  check("rows older than seven days are removed by the call", old.n === 0);
  check("rows exactly seven and six days old are kept", kept7.n === 1 && kept6.n === 1);
}

// ---- 7. a cap below one admits nothing and writes nothing -----------------------
{
  const before = await one(`SELECT count(*)::int AS n FROM public.mcp_anon_rate`);
  const z1 = await call("hhhhhhhhhhhhhhhh", 0, 3);
  const z2 = await call("hhhhhhhhhhhhhhhh", 100, 0);
  const z3 = await call("hhhhhhhhhhhhhhhh", null, 3);
  const after = await one(`SELECT count(*)::int AS n FROM public.mcp_anon_rate`);
  check("a zero or null cap refuses", z1.allowed === false && z2.allowed === false && z3.allowed === false);
  check("and writes no row", before.n === after.n && (await bucket("ip:hhhhhhhhhhhhhhhh")) === null);
}

// ---- 8. an empty hash lands in the shared unknown bucket, never the address --------
{
  const u = await call("", 1000, 3);
  const u2 = await call("   ", 1000, 3);
  check("an empty or blank hash counts in the 'ip:unknown' bucket", u.allowed === true && u2.ip_used === 2 && (await bucket("ip:unknown")) === 2);
  const names = (await rows(`SELECT bucket FROM public.mcp_anon_rate`)).map((r) => r.bucket);
  check("every bucket is 'global' or 'ip:' plus what the caller passed -- no address is derived here", names.every((b) => b === "global" || b.startsWith("ip:")));
}

// ---- 9. grants ----------------------------------------------------------------------
{
  // Positive control: a plainly created function IS executable by anon in
  // this harness, so a false below is a real revoke and not a blind probe.
  await db.exec(`CREATE FUNCTION public.zz_probe_control() RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
  const ctl = (await one(`SELECT has_function_privilege('anon', 'public.zz_probe_control()', 'EXECUTE') AS ok`)).ok;
  check("CONTROL: an unrevoked function reads as executable by anon", ctl === true);
  await db.exec(`DROP FUNCTION public.zz_probe_control();`);
  for (const role of ["anon", "authenticated", "nobody_probe"]) {
    check(`${role} cannot execute mcp_anon_check`, (await fnPriv(role)) === false);
    check(`${role} holds no SELECT on mcp_anon_rate`, (await tblPriv(role, "SELECT")) === false);
    check(`${role} holds no INSERT on mcp_anon_rate`, (await tblPriv(role, "INSERT")) === false);
  }
  check("service_role can execute mcp_anon_check", (await fnPriv("service_role")) === true);
  check("service_role holds ALL on mcp_anon_rate", (await Promise.all(["SELECT", "INSERT", "UPDATE", "DELETE"].map((p) => tblPriv("service_role", p)))).every(Boolean));
  const rls = await one(`SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.mcp_anon_rate')`);
  check("RLS is on for mcp_anon_rate", rls.relrowsecurity === true);
  const pol = await rows(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mcp_anon_rate'`);
  check("no policy exists on mcp_anon_rate (RLS on with no policy denies every client role)", pol.length === 0);
  const def = await one(`SELECT prosecdef FROM pg_proc WHERE proname = 'mcp_anon_check'`);
  check("the function is SECURITY DEFINER (the table is RLS-on; an invoker would count nothing)", def.prosecdef === true);
}

// ---- 10. one signature ------------------------------------------------------------
{
  const sigs = await rows(`SELECT pg_get_function_identity_arguments(p.oid) AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'mcp_anon_check'`);
  check("exactly one mcp_anon_check exists in the catalog", sigs.length === 1 && sigs[0].sig === "p_ip_hash text, p_global_cap integer, p_ip_cap integer", JSON.stringify(sigs));
}

// ---- 11. idempotent ---------------------------------------------------------------
{
  const before = await one(`SELECT count(*)::int AS n, coalesce(sum(calls), 0)::int AS s FROM public.mcp_anon_rate`);
  threw = "";
  try { await db.exec(sql); } catch (e) { threw = String(e?.message ?? e); }
  check("a second run applies cleanly", threw === "", threw);
  const after = await one(`SELECT count(*)::int AS n, coalesce(sum(calls), 0)::int AS s FROM public.mcp_anon_rate`);
  check("a second run keeps every row and every count", before.n === after.n && before.s === after.s);
  const sigs = await rows(`SELECT 1 FROM pg_proc WHERE proname = 'mcp_anon_check'`);
  check("a second run leaves one signature", sigs.length === 1);
  check("a second run leaves anon with nothing", (await fnPriv("anon")) === false && (await tblPriv("anon", "SELECT")) === false);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
