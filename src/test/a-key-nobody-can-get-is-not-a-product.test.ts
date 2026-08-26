import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * AN API NOBODY CAN TRY IS AN API NOBODY BECOMES A CUSTOMER OF.
 *
 * public-api shipped working and unusable: a key existed only if someone wrote
 * SQL. The page meanwhile said "no self-serve keys until there's a customer to
 * justify it", which has the causation backwards.
 *
 * This pins the three things that go wrong with self-serve credentials:
 *   1. storing the raw secret,
 *   2. limiting issuance by IP, which divides one allowance among everyone
 *      behind a shared egress — the defect already recorded against parse-pdf's
 *      per-IP ceiling on this platform,
 *   3. copy that keeps describing the old world after the code moved, which is
 *      this repo's documented "claim drift" failure.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/api-key-request/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const PAGE = readFileSync(resolve(ROOT, "src/pages/DataApi.tsx"), "utf8");
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .filter((x) => readFileSync(resolve(dir, x), "utf8").includes("FUNCTION public.api_key_issue(")).sort().pop();
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();
// SQL comments stripped for the NEGATIVE assertions below. The migration's own
// header explains why the ceiling is not per-IP, and a bare /\bip\b/ over the
// raw file matches that explanation — a guard that fails on its own
// documentation is the same trap this repo strips JS comments for.
const MIG_CODE = MIG.split("\n").map((l) => (/^\s*--/.test(l) ? "" : l)).join("\n");

describe("a key nobody can get is not a product", () => {
  it("issues from a CSPRNG with a recognisable prefix", () => {
    expect(CODE).toMatch(/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    // A visible vendor prefix is what makes a leaked key identifiable as ours
    // in a log or a public repo.
    expect(CODE).toMatch(/"rb_live_"/);
  });

  it("stores only the hash — the raw key never reaches the database", () => {
    expect(CODE).toMatch(/p_key_hash: await sha256Hex\(raw\)/);
    expect(CODE, "the raw key is passed to the issue RPC").not.toMatch(/p_key_raw|p_secret/);
    expect(MIG, "the issue function takes a raw secret").not.toMatch(/p_key_raw|p_secret/);
  });

  it("the ceiling is per ADDRESS, never per IP", () => {
    // Shared egress (an office, a university, mobile CGNAT) would divide one
    // allowance among everyone behind it.
    expect(MIG).toMatch(/lower\((?:ak\.)?owner_email\) = v_email AND (?:ak\.)?created_at > now\(\) - interval '24 hours'/);
    expect(MIG_CODE, "issuance counts IPs").not.toMatch(/\bip\b|inet|x-forwarded-for/i);
    expect(CODE, "the function reads the caller IP").not.toMatch(/x-forwarded-for|cf-connecting-ip/i);
  });

  it("asking again rotates rather than accumulating live credentials", () => {
    expect(MIG).toMatch(/UPDATE public\.api_keys(?: ak)?\s*\n\s*SET revoked_at = now\(\)/);
    expect(CODE).toMatch(/rotated/);
  });

  it("the issue function is service-role only", () => {
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.api_key_issue\(text, text, text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.api_key_issue\(text, text, text, text\) TO service_role;/);
  });

  it("a slow mail provider cannot refuse a key that was already created", () => {
    // The key is valid the moment the row exists; failing the response on the
    // email would deny a developer the credential they just created.
    expect(CODE).toMatch(/let emailed = false;/);
    expect(CODE).toMatch(/emailed,/);
  });

  it("the page no longer claims there are no self-serve keys", () => {
    // Claim drift: copy goes false when the thing it describes moves. This
    // exact sentence was true this morning and is false now.
    expect(PAGE_CODE, "the page still says self-serve keys do not exist")
      .not.toMatch(/No self-serve keys yet/);
    expect(PAGE_CODE).toMatch(/api-key-request/);
  });

  it("the documented base URL cannot drift from the deployed project", () => {
    // Hardcoding the project ref in copy is how docs end up pointing at a
    // project that is not the one serving them.
    expect(PAGE_CODE).toMatch(/const API_BASE = `\$\{import\.meta\.env\.VITE_SUPABASE_URL\}\/functions\/v1\/public-api`/);
  });

  it("the free-tier numbers shown come from the response, not from copy", () => {
    // If the tier changes in SQL, the page must change with it rather than
    // keep advertising the old allowance.
    expect(PAGE_CODE).toMatch(/issued\.limits\.perMinute/);
    expect(PAGE_CODE).toMatch(/issued\.limits\.perDay/);
  });

  it("the page states the fences to the people most likely to resell the data", () => {
    expect(PAGE_CODE).toMatch(/already withdrawn/);
    expect(PAGE_CODE).toMatch(/30-day freshness window/);
  });
});
