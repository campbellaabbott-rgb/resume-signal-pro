// @vitest-environment node
/**
 * R1 INTEGRATION: THE LEDGER APPLIES THE DRAIN AFTER ITS QUEUE BUILD, AND THE
 * PROOF TABLES BEFORE THE GUARD THAT WRITES THEM.
 *
 * R1 (sign-in, recovery, auth mail) left wave 4 for its own reservation,
 * critical-path, on the owner's decision of 2026-10-12. Its two migrations
 * need opposite places in the Lovable message the ledger generates:
 *
 *   - 20261014100000 schedules the ten-second queue drain. Its posts carry the
 *     cron key header, which only the R1 build of the queue function reads
 *     (with the Resend fallback); it waits for that build.
 *   - 20261014110000 creates the proof and clear tables and the three auth
 *     readers. auth-signed-in calls them on every sign-in and
 *     verify-product-purchase reads the proof table; it goes first.
 *
 * Both are read through the ledger's own phase rule from the real policy, as
 * the wave 3 and wave 4 order tests do. The reservation and the two shared
 * files R1 declared are read from the same policy, and each declaration is
 * held to the code it names, so neither can outlive what it describes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { buildIsAtLeast } from "./helpers/fn-build";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const FN_DIR = resolve(ROOT, "supabase/functions");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const R1_MIGRATIONS = readdirSync(MIG).filter((f) => /^20261014\d{6}_.*\.sql$/.test(f)).sort();
const R1_FUNCTIONS = ["auth-email-hook", "process-email-queue", "resend-webhook", "auth-signed-in", "verify-product-purchase"];

type Row = { fn: string; want: string | null; have: string | null; state: string };
let L: typeof import("../../scripts/deploy-ledger.mjs");
const realFetch = globalThis.fetch;

function rowsWith(live: Record<string, string> = {}): Row[] {
  return readdirSync(FN_DIR).filter((d) => d !== "_shared").flatMap((fn) => {
    let src = "";
    try { src = readFileSync(join(FN_DIR, fn, "index.ts"), "utf8"); } catch { return []; }
    const want = L.buildOf(fn, src);
    const have = live[fn] ?? null;
    const state = !want ? "no-marker" : have === want ? "live" : have ? "deploy" : "deploy (no live header)";
    return [{ fn, want, have, state }];
  });
}

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
  L = await import("../../scripts/deploy-ledger.mjs");
  vi.unstubAllGlobals();
});
afterAll(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });

describe("R1's two migrations sit where they work", () => {
  it("both exist, inside R1's reserved ranges (mail 100000-104999, sign-in server 110000-114999, spare 120000-129999)", () => {
    expect(R1_MIGRATIONS.map((f) => f.slice(0, 14))).toEqual(expect.arrayContaining(["20261014100000", "20261014110000"]));
    for (const f of R1_MIGRATIONS) {
      const n = Number(f.slice(8, 14));
      expect((n >= 100000 && n <= 104999) || (n >= 110000 && n <= 114999) || (n >= 120000 && n <= 129999), f).toBe(true);
    }
  });

  it("with nothing of R1 live: the proofs go before the functions, the drain after the queue build", () => {
    const p = L.migrationPhases(R1_MIGRATIONS, POLICY, rowsWith());
    expect(p.errors).toEqual([]);
    const proofs = p.pre.find((m) => m.file.startsWith("20261014110000"));
    expect(proofs, "110000 is not in the step before the functions").toBeDefined();
    expect(proofs!.note).toMatch(/before auth-signed-in and verify-product-purchase/);
    const drain = p.afterFunctions.find((m) => m.file.startsWith("20261014100000"));
    expect(drain, "100000 does not wait for the queue build").toBeDefined();
    expect(drain!.note).toMatch(/once process-email-queue answers process-email-queue\.\d{4}-\d{2}-\d{2}\.\d+ or later/);
    expect(p.pre.some((m) => m.file.startsWith("20261014100000"))).toBe(false);
  });

  it("once the queue build serves, the drain needs no wait", () => {
    const queue = rowsWith().find((r) => r.fn === "process-email-queue")!;
    const p = L.migrationPhases(R1_MIGRATIONS, POLICY, rowsWith({ "process-email-queue": queue.want! }));
    expect(p.errors).toEqual([]);
    expect(p.pre.find((m) => m.file.startsWith("20261014100000"))?.note).toMatch(/process-email-queue already answers/);
  });

  it("the rule the drain waits for is a build the queue function carries and sends, and the drain's own header says the same", () => {
    const rule = POLICY.migrationOrder["20261014100000"];
    const m = /^fn:process-email-queue@(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(rule?.after ?? "");
    expect(m, "the drain's after-rule names no process-email-queue build").not.toBeNull();
    const queue = readFileSync(join(FN_DIR, "process-email-queue/index.ts"), "utf8");
    expect(buildIsAtLeast(L.buildOf("process-email-queue", queue), "process-email-queue", m![1], Number(m![2]))).toBe(true);
    expect(codeOf(queue)).toMatch(/'x-fn-build': FN_BUILD/);
    expect(codeOf(queue)).toMatch(/import \{ isScheduledCaller \} from "\.\.\/_shared\/email-cron\.ts"/);
    expect(codeOf(queue)).toMatch(/!\(await isScheduledCaller\(req\.headers, supabase, supabaseServiceKey\)\)/);
    expect(codeOf(readFileSync(join(FN_DIR, "_shared/email-cron.ts"), "utf8"))).toContain('h.get("x-email-cron")');
    const sql = readFileSync(join(MIG, R1_MIGRATIONS.find((f) => f.startsWith("20261014100000"))!), "utf8");
    expect(sql).toMatch(/APPLY ORDER: after process-email-queue\.2026-10-14\.1 serves/);
    expect(codeOf(sql)).toMatch(/x-email-cron/);
  });

  it("the guard and the purchase verifier really read what 110000 creates", () => {
    const sql = codeOf(readFileSync(join(MIG, R1_MIGRATIONS.find((f) => f.startsWith("20261014110000"))!), "utf8"));
    for (const name of ["account_mailbox_proofs", "account_password_clears", "auth_changed_since", "auth_sign_in_addresses", "auth_user_has_password"]) {
      expect(sql, name).toContain(name);
    }
    const guard = codeOf(readFileSync(join(FN_DIR, "_shared/mailbox-guard.ts"), "utf8"));
    for (const call of ['admin.rpc("auth_changed_since"', 'admin.rpc("auth_sign_in_addresses"', 'admin.rpc("auth_user_has_password"', 'admin.from("account_password_clears")', 'admin.from("account_mailbox_proofs")']) {
      expect(guard, call).toContain(call);
    }
    expect(codeOf(readFileSync(join(FN_DIR, "auth-signed-in/index.ts"), "utf8"))).toMatch(/from "\.\.\/_shared\/mailbox-guard\.ts"/);
    expect(codeOf(readFileSync(join(FN_DIR, "_shared/mailbox-proof.ts"), "utf8"))).toContain('.from("account_mailbox_proofs")');
    expect(codeOf(readFileSync(join(FN_DIR, "verify-product-purchase/index.ts"), "utf8"))).toMatch(/import \{[^}]*hasMailboxProof[^}]*\} from "\.\.\/_shared\/mailbox-proof\.ts"/);
  });
});

describe("the critical-path reservation", () => {
  it("names R1's branches, migrations and build day, and deploys after the wave 3 closeout and before company profiles", () => {
    const r = POLICY.reservations["critical-path"];
    expect(r).toMatchObject({ branches: ["r1/"], migrations: "20261014*", fnBuildDate: "2026-10-14", deployOrder: 1.5 });
    expect(r.deployOrder).toBeGreaterThan(POLICY.reservations.wave3.deployOrder);
    expect(r.deployOrder).toBeLessThan(POLICY.reservations["company-profiles"].deployOrder);
    expect(L.workstreamOf(POLICY, "origin/r1/mail")).toBe("critical-path");
    expect(L.workstreamOf(POLICY, "r1/integration")).toBe("critical-path");
    expect(POLICY.reservations.next.migrations).toMatch(/^20261015\* and later/);
  });

  it("every function R1 changed carries a build of R1's day or later, and sends it", () => {
    for (const fn of R1_FUNCTIONS) {
      const src = readFileSync(join(FN_DIR, fn, "index.ts"), "utf8");
      expect(buildIsAtLeast(L.buildOf(fn, src), fn, "2026-10-14", 1), fn).toBe(true);
      expect(codeOf(src), `${fn} never sends its build`).toMatch(/["']x-fn-build["']\s*:\s*FN_BUILD/);
      expect(codeOf(src), `${fn} does not expose its build to a browser`).toMatch(/["']Access-Control-Expose-Headers["']\s*:\s*["'][^"']*x-fn-build/);
    }
  });
});

describe("the two shared files R1 declared are R1's where it says, and the code behind each runs", () => {
  it("supabase/config.toml: owned by critical-path, and the resend-webhook block opens a function that checks its own signature", () => {
    expect(L.sharedOwner(POLICY.sharedFiles, "supabase/config.toml")).toBe("critical-path");
    const toml = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
    expect(toml).toMatch(/\n {2}\[functions\.resend-webhook\]\n {4}verify_jwt = false\n/);
    expect(toml).not.toMatch(/\[functions\.auth-signed-in\]/);
    expect(toml).toMatch(/\[functions\.process-email-queue\]\n {4}verify_jwt = true/);
    const hook = codeOf(readFileSync(join(FN_DIR, "resend-webhook/index.ts"), "utf8"));
    expect(hook).toMatch(/svix-signature/i);
    expect(hook).toMatch(/RESEND_WEBHOOK_SECRET/);
  });

  it("index.html: owned by critical-path, whose part is the first child of <head>: the classic stash script", () => {
    expect(L.sharedOwner(POLICY.sharedFiles, "index.html")).toBe("critical-path");
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    const head = /<head>\s*(<[^>]+>)/.exec(html);
    expect(head?.[1]).toBe("<script>");
    const first = codeOf(html.slice(html.indexOf("<script>") + "<script>".length, html.indexOf("</script>")));
    expect(first).toContain('K = "rb_url_stash"');
    expect(first).toContain("W.setItem(K, JSON.stringify(o))");
    expect(first).toContain("history.replaceState(");
    expect(existsSync(resolve(ROOT, "src/lib/auth-fragment.ts"))).toBe(true);
  });
});
