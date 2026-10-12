/**
 * THE GREENHOUSE HOST RULE IS ONE RULE IN TWO FILES.
 *
 * An EU Greenhouse tenant (token `eu~…`) answers only on the EU host; asking
 * the US host reads every EU posting as "no public form". job-board keeps the
 * rule in normalize.ts; apply_myself's form reader (_shared/application-form.ts)
 * must not import job-board's files, so _shared/greenhouse-api.ts carries a
 * copy. Until job-board imports it from _shared (wave 4, D6), the two
 * functions are held byte-identical here, and both are run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { greenhouseApi } from "../../supabase/functions/_shared/greenhouse-api.ts";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
/** One top-level function's text, from `export function name(` to its closing brace at column zero. */
function fnText(src: string, name: string): string {
  const a = src.indexOf(`export function ${name}(`);
  if (a < 0) throw new Error(`${name} is not declared — RE-ANCHOR this guard`);
  const b = src.indexOf("\n}\n", a);
  return src.slice(a, b + 2);
}

describe("the greenhouse host rule", () => {
  it("is byte-identical in job-board/normalize.ts and _shared/greenhouse-api.ts", () => {
    const board = fnText(read("supabase/functions/job-board/normalize.ts"), "greenhouseApi");
    const shared = fnText(read("supabase/functions/_shared/greenhouse-api.ts"), "greenhouseApi");
    expect(shared).toBe(board);
  });

  it("routes an EU tenant to the EU host and everyone else to the US host", () => {
    expect(greenhouseApi("eu~acme")).toEqual({ host: "boards.eu.greenhouse.io", token: "acme" });
    expect(greenhouseApi("acme")).toEqual({ host: "boards-api.greenhouse.io", token: "acme" });
  });

  it("teeth: a copy that drifts by one character is caught", () => {
    const shared = fnText(read("supabase/functions/_shared/greenhouse-api.ts"), "greenhouseApi");
    const drifted = shared.replace("boards.eu.greenhouse.io", "boards-api.eu.greenhouse.io");
    expect(drifted).not.toBe(shared);
    expect(drifted).not.toBe(fnText(read("supabase/functions/job-board/normalize.ts"), "greenhouseApi"));
  });
});
