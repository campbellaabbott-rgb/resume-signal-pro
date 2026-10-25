// THE ONLY FILE IN THE BENCH THAT TOUCHES PRODUCTION: job-board `list` and
// `detail`, read-only, with the anon key and `x-rb-budget: probe`. No other
// action is sent (the function refuses to build one), nothing else is called
// (no job-fit, no parser, no model endpoint), and résumé text never leaves
// this machine.
//
// EVERY RUN SPENDS FROM A NAMED, SEPARATELY BUDGETED LEDGER (owner decision 8:
// the AFTER benchmark gets its own budget). MATCH_LEDGER names it and
// MATCH_PROBE_CAP caps the live calls summed over every run that ever used that
// ledger (cache/ledger-<name>.jsonl). There is no default ledger: a run that
// names none refuses to go live. Successful answers are cached in cache/board/,
// so a re-run costs nothing; MATCH_OFFLINE=1 never goes live at all.
// Paced: one call at a time, at least MATCH_PACE_MS (1,500) apart.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, ROOT } from "./paths.ts";

const PACE_MS = Number(process.env.MATCH_PACE_MS ?? 1500);
const ACTIONS = new Set(["list", "detail"]);
mkdirSync(join(CACHE, "board"), { recursive: true });

export function ledger(): { name: string; file: string; cap: number } | null {
  const name = process.env.MATCH_LEDGER;
  if (!name) return null;
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(name)) throw new Error(`MATCH_LEDGER must be a short lower-case name, got ${name}`);
  const cap = Number(process.env.MATCH_PROBE_CAP);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("MATCH_PROBE_CAP must name the ledger's budget (the AFTER benchmark's is about 900 detail calls)");
  return { name, file: join(CACHE, `ledger-${name}.jsonl`), cap };
}

export function probesUsed(file: string): number {
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
}

function env(): { url: string; anon: string } {
  const raw = readFileSync(join(ROOT, ".env"), "utf8");
  const get = (k: string) => (raw.match(new RegExp(`${k}="?([^"\\n]+)"?`)) ?? [])[1] ?? "";
  const url = get("VITE_SUPABASE_URL");
  const anon = get("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anon) throw new Error(".env carries no VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY");
  return { url, anon };
}

let last = 0;
async function pace() {
  const wait = last + PACE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

const key = (o: unknown) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 20);

export type LiveResult<T> = { data: T | null; status: number; ms: number; cached: boolean; build: string | null; at?: string };

/** job-board POST, cached. A miss offline (or with no ledger) returns null and costs nothing. */
export async function board<T = any>(body: Record<string, unknown>, opts: { offline?: boolean } = {}): Promise<LiveResult<T>> {
  if (!ACTIONS.has(String(body.action))) throw new Error(`the bench sends only job-board list and detail, not ${String(body.action)}`);
  const file = join(CACHE, "board", `${String(body.action)}-${key(body)}.json`);
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return { data: c.data, status: c.status, ms: c.ms, cached: true, build: c.build ?? null, at: c.at };
  }
  const L = ledger();
  if (opts.offline || process.env.MATCH_OFFLINE === "1" || !L) return { data: null, status: 0, ms: 0, cached: true, build: null };
  if (probesUsed(L.file) >= L.cap) throw new Error(`ledger ${L.name}: its cap of ${L.cap} live calls is spent`);
  const { url, anon } = env();
  await pace();
  const t0 = Date.now();
  let status = 0;
  let data: any = null;
  let build: string | null = null;
  try {
    const res = await fetch(`${url}/functions/v1/job-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}`, "x-rb-budget": "probe" },
      body: JSON.stringify(body),
    });
    status = res.status;
    build = res.headers.get("x-fn-build");
    data = await res.json().catch(() => null);
  } catch (e) {
    data = { error: String(e) };
  }
  const ms = Date.now() - t0;
  const at = new Date().toISOString();
  appendFileSync(L.file, JSON.stringify({ at, action: body.action, q: body.q ?? body.id ?? null, status, ms, build }) + "\n");
  if (status === 200) writeFileSync(file, JSON.stringify({ data, status, ms, build, at }));
  return { data, status, ms, cached: false, build, at };
}
