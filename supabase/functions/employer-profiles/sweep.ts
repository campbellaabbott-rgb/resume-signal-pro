/**
 * THE PERK SWEEP: READ EACH SERVING POSTING ONCE, STORE WHAT IT SAYS.
 *
 * One call (every minute, from pg_cron) takes the sweep lease, then loops:
 * ask employer_perk_sweep_take for up to the rest of the batch (postings with
 * no row under this extractor version, boards in open-roles order), read each
 * one with the frozen extractor, and hand each board's rows to
 * employer_perk_store in one transaction. It stops at the batch (300 to
 * start), at the wall budget (20 s), when the queue has nothing pending, or
 * when the owner's pause switch is on -- re-read between batches. Writes are
 * best-effort: a board whose store fails keeps its cursor and is read again
 * next call, and the call goes on with the next board.
 *
 * The extraction is timed on its own (msPerPosting in the answer and the run
 * row), because the batch may be raised only once that is measured under
 * 3 ms in Deno: the prototype measured 0.54 ms mean on one machine and
 * 2.58 ms on another, against a 2-second CPU cap per request.
 */
import { EXTRACTOR_VERSION, PERK_BIT, ptoDaysOf, readPosting } from "../_shared/perks-extract.ts";

export const SWEEP_LEASE = "sweep";
export const LEASE_SECONDS = 90;
/** How long one take may walk the queue before it answers. */
export const TAKE_BUDGET_MS = 3000;

// deno-lint-ignore no-explicit-any
type Client = any;

/** A row employer_perk_sweep_take answers. */
export interface TakenRow {
  company_token: string;
  posting_id: string;
  source: string;
  country: string | null;
  agency: boolean | null;
  title: string | null;
  body: string | null;
  /** md5 of the title and description the take handed out; echoed to the store so a changed text is read again (S12-188). */
  text_hash?: string | null;
}

export interface BoardBatch {
  token: string;
  rows: TakenRow[];
  /** The take reached the end of this board's pending postings. */
  done: boolean;
}

/**
 * A take's rows grouped by board, in the order the take walked them. The take
 * moves to the next board only once a board answers fewer postings than were
 * still wanted, so every board but the last is finished; the last is finished
 * when the whole take answered fewer than it was asked for.
 */
export function boardsOf(rows: TakenRow[], asked: number): BoardBatch[] {
  const order: string[] = [];
  const by = new Map<string, TakenRow[]>();
  for (const r of rows) {
    if (!by.has(r.company_token)) {
      by.set(r.company_token, []);
      order.push(r.company_token);
    }
    by.get(r.company_token)!.push(r);
  }
  return order.map((token, i) => ({ token, rows: by.get(token)!, done: i < order.length - 1 || rows.length < asked }));
}

/** The first 16 hex of a line's SHA-256: the key employer_perk_lines stores it under. */
export async function lineHash(line: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(line));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface StoredRow {
  posting_id: string;
  company_token: string;
  source: string;
  country: string | null;
  readable: boolean;
  /** Written in English: only English postings are counted until other languages are judged. */
  english: boolean;
  franchise: boolean;
  agency: boolean;
  y: number;
  q: number;
  n: number;
  quote_line_hash: Array<string | null> | null;
  extractor_version: number;
  /** The text the read was made from (the take's md5); null where the take sent none. */
  text_hash: string | null;
}

/** One quoted line as employer_perk_store takes it; a leave line also carries the days it states. */
export interface StoredLine {
  h: string;
  line: string;
  pto_days?: number | null;
  pto_plus_holidays?: boolean;
}

/** One board's postings, read: the rows and the distinct quoted lines employer_perk_store takes, and the time the reading took. */
export async function encodeBoard(
  batch: BoardBatch,
  memo: Map<string, string> = new Map(),
): Promise<{ rows: StoredRow[]; lines: StoredLine[]; extractMs: number }> {
  const t0 = performance.now();
  const reads = batch.rows.map((r) => ({ r, read: readPosting(r.title ?? "", r.body) }));
  const extractMs = performance.now() - t0;
  const lines = new Map<string, StoredLine>();
  const rows: StoredRow[] = [];
  for (const { r, read } of reads) {
    const hashes: Array<string | null> = [];
    for (const [bit, quote] of read.quotes.entries()) {
      if (!quote) { hashes.push(null); continue; }
      let h = memo.get(quote);
      if (!h) { h = await lineHash(quote); memo.set(quote, h); }
      const entry = lines.get(h) ?? { h, line: quote };
      // The days a leave line states, read from the line itself, so the
      // reader never tags a line above the statutory minimum as "may be the
      // legal minimum".
      if (bit === PERK_BIT.pto && entry.pto_days === undefined) {
        const d = ptoDaysOf(quote);
        entry.pto_days = d.days;
        entry.pto_plus_holidays = d.plusPublicHolidays;
      }
      lines.set(h, entry);
      hashes.push(h);
    }
    rows.push({
      posting_id: r.posting_id,
      company_token: r.company_token,
      source: r.source,
      country: r.country,
      readable: read.readable,
      english: read.english,
      franchise: read.franchise,
      agency: r.agency === true,
      y: read.y,
      q: read.q,
      n: read.n,
      quote_line_hash: read.readable ? hashes : null,
      extractor_version: EXTRACTOR_VERSION,
      text_hash: typeof r.text_hash === "string" && /^[0-9a-f]{32}$/.test(r.text_hash) ? r.text_hash : null,
    });
  }
  return { rows, lines: [...lines.values()], extractMs };
}

export interface SweepConfig {
  sweep_paused: boolean;
  sweep_batch: number;
  sweep_wall_ms: number;
}

/** The owner's switches; null when they cannot be read (the sweep then does nothing). */
export async function readConfig(client: Client): Promise<SweepConfig | null> {
  try {
    const { data, error } = await client
      .from("employer_profile_config")
      .select("sweep_paused,sweep_batch,sweep_wall_ms")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return null;
    return {
      sweep_paused: data.sweep_paused === true,
      sweep_batch: Math.max(1, Math.min(2000, Number(data.sweep_batch) || 300)),
      sweep_wall_ms: Math.max(1000, Math.min(50000, Number(data.sweep_wall_ms) || 20000)),
    };
  } catch {
    return null;
  }
}

export type StoppedBy = "batch" | "wall" | "empty" | "paused" | "lease_held" | "error";

export interface SweepResult {
  ok: boolean;
  build: string;
  extractorVersion: number;
  stoppedBy: StoppedBy;
  boards: number;
  postings: number;
  stored: number;
  refused: number;
  lines: number;
  storeErrors: number;
  extractMs: number;
  msPerPosting: number | null;
  wallMs: number;
  note: string | null;
}

const message = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 300);

export async function runSweep(
  client: Client,
  opts: { build: string; holder?: string; now?: () => number },
): Promise<SweepResult> {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const holder = opts.holder ?? crypto.randomUUID();
  const res: SweepResult = {
    ok: true, build: opts.build, extractorVersion: EXTRACTOR_VERSION, stoppedBy: "empty", boards: 0, postings: 0,
    stored: 0, refused: 0, lines: 0, storeErrors: 0, extractMs: 0, msPerPosting: null, wallMs: 0, note: null,
  };

  const lease = await client.rpc("employer_profile_lease_take", { p_name: SWEEP_LEASE, p_holder: holder, p_seconds: LEASE_SECONDS });
  if (lease.error) return { ...res, ok: false, stoppedBy: "error", note: `lease: ${message(lease.error)}`, wallMs: now() - t0 };
  if (lease.data !== true) return { ...res, stoppedBy: "lease_held", wallMs: now() - t0 };

  try {
    let cfg = await readConfig(client);
    if (!cfg) {
      res.ok = false;
      res.stoppedBy = "error";
      res.note = "employer_profile_config could not be read; nothing was swept";
      return res;
    }
    let left = cfg.sweep_batch;
    const memo = new Map<string, string>();
    for (;;) {
      if (cfg.sweep_paused) { res.stoppedBy = "paused"; break; }
      if (left <= 0) { res.stoppedBy = "batch"; break; }
      if (now() - t0 >= cfg.sweep_wall_ms) { res.stoppedBy = "wall"; break; }

      const asked = left;
      const take = await client.rpc("employer_perk_sweep_take", { p_limit: asked, p_version: EXTRACTOR_VERSION, p_budget_ms: TAKE_BUDGET_MS });
      if (take.error) {
        res.ok = false;
        res.stoppedBy = "error";
        res.note = `take: ${message(take.error)}`;
        break;
      }
      const rows: TakenRow[] = Array.isArray(take.data) ? take.data : [];
      if (!rows.length) { res.stoppedBy = "empty"; break; }
      res.postings += rows.length;
      left -= rows.length;

      for (const board of boardsOf(rows, asked)) {
        const enc = await encodeBoard(board, memo);
        res.extractMs += enc.extractMs;
        try {
          const st = await client.rpc("employer_perk_store", {
            p_token: board.token,
            p_rows: enc.rows,
            p_lines: enc.lines,
            p_cursor: board.rows[board.rows.length - 1].posting_id,
            p_done: board.done,
            p_version: EXTRACTOR_VERSION,
          });
          if (st.error) throw st.error;
          res.boards++;
          res.stored += Number(st.data?.stored ?? 0);
          res.refused += Number(st.data?.refused ?? 0);
          res.lines += Number(st.data?.lines ?? 0);
        } catch (e) {
          res.storeErrors++;
          if (!res.note) res.note = `store ${board.token}: ${message(e)}`;
          console.warn(`[employer-profiles] store failed for ${board.token}: ${message(e)}`);
        }
      }
      cfg = (await readConfig(client)) ?? cfg;
    }
    return res;
  } catch (e) {
    res.ok = false;
    res.stoppedBy = "error";
    res.note = message(e);
    return res;
  } finally {
    res.wallMs = now() - t0;
    res.msPerPosting = res.postings ? Math.round((res.extractMs / res.postings) * 1000) / 1000 : null;
    res.extractMs = Math.round(res.extractMs);
    try {
      await client.rpc("employer_profile_lease_release", { p_name: SWEEP_LEASE, p_holder: holder });
    } catch (e) {
      console.warn(`[employer-profiles] lease release failed (it expires on its own): ${message(e)}`);
    }
    try {
      const { error } = await client.from("employer_profile_runs").insert({
        kind: "sweep", build: opts.build, started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
        ok: res.ok, boards: res.boards, postings_read: res.postings, postings_written: res.stored, lines_written: res.lines,
        extract_ms: res.extractMs, note: `stopped=${res.stoppedBy} msPerPosting=${res.msPerPosting ?? "-"} storeErrors=${res.storeErrors}${res.note ? ` ${res.note}` : ""}`.slice(0, 500),
      });
      if (error) console.warn(`[employer-profiles] run row not written: ${message(error)}`);
    } catch (e) {
      console.warn(`[employer-profiles] run row threw: ${message(e)}`);
    }
  }
}
