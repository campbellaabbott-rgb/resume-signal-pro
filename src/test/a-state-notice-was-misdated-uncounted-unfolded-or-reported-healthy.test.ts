// @vitest-environment node
/**
 * A STATE NOTICE WAS MISDATED, UNCOUNTED, UNFOLDED, OR ITS FEED REPORTED
 * HEALTHY WHILE NOTHING WAS READ (sweep S8-025, S8-106, S8-107, S8-109).
 *
 * The shipped layoff-filings handler runs one WARN slice (cursor 3: IA, MD,
 * OR, WA, IL, NY, MA, OH) with only its network and database faked, over rows
 * copied from Big Local News' raw files of 2026-10-10 (dates moved to recent
 * days so the retention window holds them):
 *
 *  S8-025  Illinois lists "Notification Date(s)" newest first. The first date
 *          was taken as the notice, so UnityPoint's May notice was dated
 *          August, and every appended re-notification minted a new active
 *          filing id. The notice is the EARLIEST date; a re-read with one more
 *          date prepended is the same filing.
 *  S8-106  Oregon's header is "Laid Off" / "Layoff Type"; the map's guessed
 *          candidates matched neither, so every notice stored workers NULL and
 *          the 50-worker bar hid all of them. And one notice is split across
 *          lines by WARN# (9591: 9 + 60 + 2 + 11 + 5 = 87).
 *  S8-107  A file the map refused stored its ETag, so the next night's 304
 *          marked the feed ok and erased the header note.
 *  S8-109  Massachusetts' "*Updated* Revvity" was never read as an amendment:
 *          the update stayed a second active filing under "updated revvity".
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000 });

const SECRET = "test-layoff-cron-secret-0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LAYOFF_CRON_SECRET: SECRET };

const day = (n: number) => { const d = new Date(Date.now() - n * 86_400_000); return { mdy: `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`, iso: d.toISOString().slice(0, 10) }; };
const D60 = day(60), D45 = day(45), D20 = day(20), D10 = day(10), D5 = day(5);
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csv = (header: string[], rows: string[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

// Oregon, as the raw file spells it (WARN# 9591 split in five; Medford whole).
const OR_CSV = csv(["WARN#", "Company Name", "Location", "Layoff Date", "Laid Off", "Layoff Type", "Received Date"], [
  ["9637", "Medford Delivery Facility", "Medford", `${D5.iso} 00:00:00`, "170", "Permanent closure", `${D10.iso} 00:00:00`],
  ["9591", "Tualatin Oregon Facility", "Tualatin", `${D5.iso} 00:00:00`, "9", "Permanent closure", `${D20.iso} 00:00:00`],
  ["9591", "Tualatin Oregon Facility", "Tualatin", `${D5.iso} 00:00:00`, "60", "Permanent closure", `${D20.iso} 00:00:00`],
  ["9591", "Tualatin Oregon Facility", "Tualatin", `${D10.iso} 00:00:00`, "2", "Permanent closure", `${D20.iso} 00:00:00`],
  ["9591", "Tualatin Oregon Facility", "Tualatin", `${D5.iso} 00:00:00`, "11", "Permanent closure", `${D20.iso} 00:00:00`],
  ["9591", "Tualatin Oregon Facility", "Tualatin", `${D5.iso} 00:00:00`, "5", "Permanent closure", `${D20.iso} 00:00:00`],
]);
const IL_HEADER = ["Location Name", "Location Address", "Location City", "County", "Reason", "WARN Notice", "Expected Layoff", "Revised Layoff", "Initial Date Reported", "Notification Date(s)"];
const ilCsv = (dates: string) => csv(IL_HEADER, [["UnityPoint Health - Peoria", "221 NE Glen Oak Ave", "Peoria", "Peoria County", "Layoff", "True", "120", "", `${D60.iso} 00:00:00`, dates]]);
const MA_CSV = csv(["RECEIVED", "EMPLOYER", "CITY/TOWN", "REGION", "DATE(S) OF LAYOFFS", "# EMPLOYEES IMPACTED"], [
  [D45.mdy, "Revvity", "Waltham", "Boston", D10.mdy, "53"],
  [D20.mdy, "*Updated* Revvity", "Waltham", "Boston", D5.mdy, "61"],
]);
// Iowa: a header the (unverified) map does not recognise.
const IA_CSV = csv(["Some Column", "Another"], [["a", "b"]]);

let files: Record<string, { body: string; etag: string }> = {};
const sentIfNoneMatch: Record<string, string | null> = {};
let health: Record<string, Record<string, unknown>> = {};
let upserted: Array<Record<string, unknown>> = [];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  g.fetch = async (url: string, init?: RequestInit) => {
    const m = /\/raw\/([a-z]{2})\.csv$/.exec(String(url));
    const f = m ? files[m[1]] : undefined;
    if (!f) return new Response("not here", { status: 404 });
    const h = new Headers(init?.headers);
    sentIfNoneMatch[m![1]] = h.get("If-None-Match");
    if (h.get("If-None-Match") === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } });
    return new Response(f.body, { status: 200, headers: { etag: f.etag, "content-type": "text/csv" } });
  };
  const db = new ProxyDb();
  const eqOf = (q: Query, col: string) => q.calls.find(([mm, a]) => mm === "eq" && a[0] === col)?.[1][1];
  db.answer = (q) => {
    if (q.table === "layoff_feed_health") {
      const up = q.calls.find(([mm]) => mm === "upsert");
      if (up) {
        const row = up[1][0] as Record<string, unknown>;
        const k = `${row.feed}:${row.state}`;
        health[k] = { ...(health[k] ?? {}), ...row };
        return { data: null, error: null };
      }
      const k = `${eqOf(q, "feed")}:${eqOf(q, "state")}`;
      return { data: health[k] ?? null, error: null };
    }
    if (q.rpc === "layoff_filings_upsert") {
      const rows = (q.calls[0][1][0] as { p_rows: Array<Record<string, unknown>> }).p_rows;
      upserted.push(...rows);
      return { data: [{ lu_inserted: rows.length, lu_updated: 0, lu_refused: 0 }], error: null };
    }
    return undefined;
  };
  g.__layoffDb = db;
  handler = await loadEdgeHandler("layoff-filings", {
    "https://deno.land/std@0.190.0/http/server.ts": "export const serve = (h) => { globalThis.__edgeHandler = h; };",
    "https://esm.sh/xlsx@0.18.5": "export const read = () => ({ Sheets: {}, SheetNames: [] }); export const utils = { sheet_to_json: () => [] };",
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__layoffDb;",
  });
}, 60_000);

beforeEach(() => {
  files = {
    or: { body: OR_CSV, etag: 'W/"or-1"' },
    il: { body: ilCsv(`${D20.mdy}, ${D60.mdy}`), etag: 'W/"il-1"' },
    ma: { body: MA_CSV, etag: 'W/"ma-1"' },
    ia: { body: IA_CSV, etag: 'W/"ia-1"' },
  };
  health = {};
  upserted = [];
});

const slice = async () => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", {
    method: "POST", headers: { "content-type": "application/json", "x-layoff-cron": SECRET }, body: JSON.stringify({ action: "warn", cursor: 3 }),
  }));
  return res.json() as Promise<Record<string, unknown>>;
};
const rowsOf = (state: string) => upserted.filter((r) => r.state === state);

describe("a state notice read by its state map", () => {
  it("S8-106: Oregon's notices carry their worker counts, and a notice split by WARN# is one notice", async () => {
    await slice();
    const or = rowsOf("OR");
    const tualatin = or.filter((r) => String(r.filer_raw).startsWith("Tualatin"));
    expect(tualatin.length, "WARN# 9591's five lines stayed five notices").toBe(1);
    expect(tualatin[0].workers, "the split notice's count is its lines summed").toBe(87);
    expect(or.find((r) => String(r.filer_raw).startsWith("Medford"))?.workers).toBe(170);
    expect(tualatin[0].effective_date, "the earliest layoff date of the notice").toBe(D10.iso);
  });

  it("S8-025: an Illinois notice is dated by its earliest notification, and a prepended re-notification is the same filing", async () => {
    await slice();
    const [first] = rowsOf("IL");
    expect(first.event_date, "dated by the newest re-notification").toBe(D60.iso);
    upserted = [];
    files.il = { body: ilCsv(`${D10.mdy}, ${D20.mdy}, ${D60.mdy}`), etag: 'W/"il-2"' };
    await slice();
    const [again] = rowsOf("IL");
    expect(again.filing_id, "an appended date minted a second active filing").toBe(first.filing_id);
    expect(again.event_date).toBe(D60.iso);
  });

  it("S8-109: a Massachusetts '*Updated*' notice folds onto its original", async () => {
    await slice();
    const ma = rowsOf("MA");
    const update = ma.find((r) => r.workers === 61)!;
    const original = ma.find((r) => r.workers === 53)!;
    expect(update.filer_raw, "the affix stayed in the employer's name").toBe("Revvity");
    expect(update.status).toBe("active");
    expect(original.status, "the original stayed active beside its own update").toBe("superseded");
    expect(update.supersedes_id).toBe(original.filing_id);
  });

  it("S8-107: a refused file stores no validator, so the next night reads it again and the refusal stays on record", async () => {
    await slice();
    const first = health["bln_raw:IA"];
    expect(String(first.note)).toMatch(/^header_mismatch/);
    expect(first.etag ?? null, "a refusal stored the file's ETag").toBeNull();
    await slice();
    expect(sentIfNoneMatch.ia, "the refused file was asked for conditionally").toBeNull();
    expect(String(health["bln_raw:IA"].note), "the next night's 304 erased the refusal").toMatch(/^header_mismatch/);
    // A row written by the old build (a refusal that DID store its ETag) is
    // read again without the conditional header, never trusted to a 304.
    health["bln_raw:IA"] = { ...health["bln_raw:IA"], etag: 'W/"ia-1"' };
    await slice();
    expect(sentIfNoneMatch.ia).toBeNull();
    expect(String(health["bln_raw:IA"].note)).toMatch(/^header_mismatch/);
  });

  it("positive control: an ok file stores its validator and is asked for conditionally next time", async () => {
    await slice();
    expect(health["bln_raw:OR"].etag).toBe('W/"or-1"');
    await slice();
    expect(sentIfNoneMatch.or).toBe('W/"or-1"');
    expect(health["bln_raw:OR"].note ?? null).toBeNull();
  });
});
