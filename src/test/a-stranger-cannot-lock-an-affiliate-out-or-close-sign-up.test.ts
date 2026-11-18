// @vitest-environment node
/**
 * A STRANGER CANNOT LOCK AN AFFILIATE OUT OR CLOSE SIGN-UP (S14X-092).
 *
 * WHAT WAS WRONG. login_affiliate charged a budget of twenty attempts an hour
 * against each EMAIL from every address together, and charged it on every
 * attempt, the right password included. Twenty wrong passwords from anyone
 * locked the real affiliate out for the hour, again every hour. And
 * register_affiliate allowed fifty sign-ups a day across the whole site: one
 * script closed the program to everyone each morning.
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's,
 * request.headers set per call as PostgREST sets them):
 *   - only FAILED attempts are charged against an email, ten an hour from one
 *     address and two hundred from all addresses together, and the bucket is
 *     read before the password is checked, so the owner signing in from their
 *     own address after a stranger's twenty guesses still gets in;
 *   - one address still gets at most ten wrong guesses an hour at one email;
 *   - sign-up is capped per network (ten a day per /24 or /48) under a high
 *     global ceiling, so seventeen busy networks leave the eighteenth open;
 *   - the budget reader the sign-in uses is closed to the client roles.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAffiliateDb, fromAddress, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let db: PGlite;
beforeAll(async () => { db = await bootAffiliateDb({ round: true }); }, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

const login = async (ip: string, email: string, password: string) => {
  await fromAddress(db, ip);
  return (await one<{ j: { success: boolean; error?: string } }>(db, "SELECT public.login_affiliate($1, $2) AS j", [email, password])).j;
};
const register = async (ip: string, email: string) => {
  await fromAddress(db, ip);
  return (await one<{ j: { success: boolean; error?: string } }>(db, "SELECT public.register_affiliate($1, 'correct horse 1') AS j", [email])).j;
};

describe("a stranger's wrong passwords do not lock the owner out", () => {
  it("twenty wrong passwords from 198.51.100.1 leave the owner signing in from 203.0.113.5", async () => {
    expect((await register("203.0.113.5", "victim@example.com")).success).toBe(true);
    for (let i = 0; i < 20; i++) await login("198.51.100.1", "victim@example.com", `wrong guess ${i}`);
    const j = await login("203.0.113.5", "victim@example.com", "correct horse 1");
    expect(j, "the affiliate was locked out by a stranger's guesses").toMatchObject({ success: true });
  });

  it("a correct sign-in is never charged: twenty-five in an hour all succeed", async () => {
    expect((await register("203.0.113.6", "often@example.com")).success).toBe(true);
    for (let i = 0; i < 25; i++) {
      expect((await login(`203.0.113.${(i % 15) + 20}`, "often@example.com", "correct horse 1")).success, `sign-in ${i + 1}`).toBe(true);
    }
  });

  it("one address gets at most ten wrong guesses an hour at one email, and then not the eleventh either", async () => {
    expect((await register("203.0.113.7", "target@example.com")).success).toBe(true);
    const answers: string[] = [];
    for (let i = 0; i < 12; i++) answers.push(String((await login("198.51.100.77", "target@example.com", `guess ${i}`)).error));
    expect(answers.slice(0, 10).every((e) => /Invalid email or password/.test(e))).toBe(true);
    expect(answers[10]).toMatch(/Too many/);
    expect((await login("198.51.100.77", "target@example.com", "correct horse 1")).success,
      "a guesser that runs out of tries may not then test the right password").toBe(false);
  });
});

describe("sign-up is capped per network, not for the whole site", () => {
  it("seventeen networks of three sign-ups each leave an eighteenth network able to register", async () => {
    for (let n = 0; n < 17; n++) {
      for (let k = 0; k < 3; k++) {
        await register(`10.${n}.0.${k + 1}`, `n${n}-k${k}@example.com`);
      }
    }
    expect(await register("192.0.2.10", "eighteenth@example.com"), "fifty sign-ups closed the program to everyone").toMatchObject({ success: true });
  });

  it("one network gets ten sign-ups a day, whichever of its addresses it uses", async () => {
    const out: boolean[] = [];
    for (let k = 0; k < 12; k++) out.push((await register(`172.16.5.${k + 1}`, `same-net-${k}@example.com`)).success);
    expect(out.filter(Boolean)).toHaveLength(10);
    expect(out[10]).toBe(false);
  });
});

describe("the budget reader is closed", () => {
  it("client_write_budget_left runs for the service role only", async () => {
    const [acl] = await q<Record<string, boolean>>(db, `SELECT
      has_function_privilege('anon', 'public.client_write_budget_left(text,integer,integer,integer)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.client_write_budget_left(text,integer,integer,integer)', 'EXECUTE') AS auth,
      has_function_privilege('service_role', 'public.client_write_budget_left(text,integer,integer,integer)', 'EXECUTE') AS svc,
      has_function_privilege('anon', 'public.login_affiliate(text,text)', 'EXECUTE') AS anon_login,
      has_function_privilege('anon', 'public.register_affiliate(text,text)', 'EXECUTE') AS anon_register`);
    expect(acl).toEqual({ anon: false, auth: false, svc: true, anon_login: true, anon_register: true });
  });
});
