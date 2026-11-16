// @vitest-environment node
/**
 * EVERY KEY THE DIFF LOOP PATCHES IS A KEY THE CORRECTIONS RPC LANDS.
 *
 * WHAT WAS WRONG. job-board .102 (9f246c61) taught its diff loop two more
 * patch keys: closes_at (XR-1, so an announcement the agency extended moves its
 * date) and department (S14X-216, so a department stored entity-encoded
 * heals). A stored row is corrected only through apply_posting_corrections,
 * and its last definition, 20260906210500, hand-listed fourteen columns and
 * ignored every other key while still counting the row as matched. On PGlite
 * a {closes_at} and a {department} patch returned 2, the count the edge reads
 * as success, and changed nothing. So an extended USAJOBS announcement was
 * still closed on its old date and came back as a new row with its first-seen
 * date reset, the ~18,500 rows stored before .102 never gained closes_at,
 * entity departments never healed, every visit re-sent the same no-op
 * UPDATEs, and the deploy notes said the opposite. It is the sixth arrival of
 * the class 20260906210500's own header counts five of: a key the edge sends
 * and the RPC was never taught.
 *
 * HOW THIS READS. The keys come from the code with its comments gone: every
 * put("x", ...) and every patch.x = in the loop that builds `corrections`, and
 * the keys townRefilePatches returns (the loop pushes them onto the same
 * array), read by running it. The arms come from the LAST definition of
 * apply_posting_corrections in stamp order (a later file wins on a replay),
 * comments gone: `x = CASE WHEN patch.p ? 'x'`. A way of writing a patch key
 * this guard cannot read (patch[...] outside put, Object.assign onto the
 * patch, another push onto corrections) fails it instead of passing unread.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { townRefilePatches } from "../../supabase/functions/job-board/normalize";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const IDX = codeOf(read("supabase/functions/job-board/index.ts"));

const DEFINES = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.apply_posting_corrections\s*\(/gi;

/** The definition a fresh replay ends with: the last file by stamp, and the last definition in it. */
const lastDefinition = (): { file: string; body: string } => {
  const definers = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => new RegExp(DEFINES.source, "i").test(sqlCodeOf(readFileSync(resolve(MIG, f), "utf8"))));
  const file = definers.at(-1) ?? "";
  const sql = file ? sqlCodeOf(readFileSync(resolve(MIG, file), "utf8")) : "";
  const at = [...sql.matchAll(DEFINES)].at(-1)?.index ?? -1;
  if (at < 0) return { file, body: "" };
  const end = sql.indexOf("$$;", at);
  return { file, body: end > at ? sql.slice(at, end) : "" };
};

/** The loop that builds the corrections array, up to the RPC call that sends it. */
const LOOP = (() => {
  const a = IDX.indexOf("const corrections: Array<Record<string, unknown>> = [];");
  const b = IDX.indexOf('client.rpc("apply_posting_corrections"', a);
  return a >= 0 && b > a ? IDX.slice(a, b) : "";
})();

const loopKeys = (): string[] => [
  ...[...LOOP.matchAll(/\bput\(\s*"(\w+)"/g)].map((m) => m[1]),
  ...[...LOOP.matchAll(/\bpatch\.(\w+)\s*=(?!=)/g)].map((m) => m[1]),
];

/** townRefilePatches run on rows that make it write every key it can: a country, a state and the pay re-read. */
const townKeys = (): string[] => {
  const rows = [
    { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1", location: "NY - Greece", country: "GR", region_code: null, title: "Pharmacy Technician", salary: "17.500 - 22.750 per hour" },
  ];
  return [...new Set(townRefilePatches(rows, new Set<string>(), "workday", true).flatMap((p) => Object.keys(p)))].filter((k) => k !== "id");
};

describe("the diff loop's patch keys are read from the code, all of them", () => {
  it("finds the loop and the RPC call that sends it", () => {
    expect(LOOP, "the corrections loop or its apply_posting_corrections call moved; this guard reads nothing").not.toBe("");
  });

  it("a patch key is written only by put(\"x\") or patch.x =, so no key escapes the read", () => {
    const dynamic = [...LOOP.matchAll(/\bpatch\[([^\]]*)\]\s*=(?!=)/g)].map((m) => m[1].trim());
    expect(dynamic, "patch[...] = is written only inside put, by its own key").toEqual(["k"]);
    expect(LOOP).toMatch(/const put = \(k: string, next: unknown, cur: unknown, allowNull: boolean\) => \{/);
    expect(LOOP, "Object.assign onto the patch writes keys this guard cannot read").not.toMatch(/Object\.assign\(\s*patch\b/);
    const pushes = [...LOOP.matchAll(/\bcorrections\.push\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(pushes, "a new source of corrections: read its keys here too").toEqual(["{ id, ...patch }", "p"]);
    expect(LOOP).toMatch(/for \(const p of townRefilePatches\(existingRows, rowsById, s\.source, !regionColUnknown\)\)/);
  });

  it("reads the keys it was written for, so a broken read cannot pass empty", () => {
    expect(loopKeys()).toEqual(expect.arrayContaining([
      "title", "location", "apply_url", "country", "region_code", "work_mode", "employment_type", "salary",
      "salary_min_annual", "salary_max_annual", "salary_period", "salary_currency", "remote", "agency", "closes_at", "department",
    ]));
    expect(townKeys()).toEqual(expect.arrayContaining(["country", "region_code", "salary_min_annual", "salary_max_annual", "salary_period", "salary_currency"]));
  });
});

describe("the last definition of apply_posting_corrections lands every one of them", () => {
  const { file, body } = lastDefinition();

  it(`is found (${file || "no file"})`, () => {
    expect(file).toMatch(/^\d{14}_/);
    expect(body).toMatch(/UPDATE public\.job_board_postings t SET/);
  });

  it("has a key-presence arm, falling back to the stored value, for every key the diff loop or the town re-file patches", () => {
    const keys = [...new Set([...loopKeys(), ...townKeys()])].sort();
    const missing = keys.filter((k) => !new RegExp(`\\b${k}\\s*=\\s*CASE WHEN patch\\.p \\? '${k}'`).test(body) || !new RegExp(`\\bt\\.${k}\\b`).test(body));
    expect(missing, `job-board patches these keys and ${file} has no key-presence arm for them, so the RPC drops them and still counts the row`).toEqual([]);
  });
});
