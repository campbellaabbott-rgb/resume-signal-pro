// Job board aggregator, DB-backed. Postings come from each company's
// OFFICIAL public job-board API (Greenhouse / Lever / Ashby); a refresh
// pass normalizes them into public.job_board_postings, where list queries
// run in SQL. "Apply" always points at the company's own posting page.
//
//   POST { action: "list", q?, location?, remote?, category?, companies?, limit?, offset? }
//   POST { action: "detail", id }      // full description text for the fit scan
//   POST { action: "refresh" }         // fan-out -> upsert -> prune; cron + SWR call this
//
// Freshness model: pg_cron hits refresh every 10 minutes; list also fires a
// background refresh (EdgeRuntime.waitUntil) when data is older than the
// TTL, so the board self-heals even if cron dies. Postings that vanish from
// a company's feed are pruned on the next successful pass — dead listings
// never linger. A refresh lock in job_board_meta stops stampedes.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HOT_TOKENS, JOB_SOURCES, LIGHT_DESC_TOKENS, type JobSource } from "./sources.ts";
import {
  htmlToText,
  normalizeAshby,
  normalizeBambooHR,
  normalizeGreenhouse,
  normalizeLever,
  normalizeSmartRecruiters,
  normalizeWorkable,
  type JobPosting,
} from "./normalize.ts";
import { categorize, CATEGORIZE_VERSION, JOB_CATEGORIES } from "./categories.ts";
import { computeFit } from "../_shared/fit-score.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STALE_MS = 12 * 60_000; // SWR threshold — cron target is 10 min
const LOCK_MS = 5 * 60_000; // min gap between refresh passes
const FETCH_TIMEOUT_MS = 8_000;
// Refresh budget: a single edge invocation cannot afford the CPU of
// converting the whole corpus's HTML to text (WORKER_RESOURCE_LIMIT, seen
// live twice). So refresh is CURSOR-SLICED: each call processes one slice of
// boards and advances a cursor in job_board_meta; the 10-minute cron and
// read-triggered SWR calls walk the full list continuously. Facets swap in
// when a cycle completes; until then the previous complete cycle serves.
const CONCURRENCY = 4;
const HOT_CONCURRENCY = 2; // hot boards are giants — two multi-MB parses at once is the memory ceiling
// Slice sizes are calibrated to the per-invocation compute budget. Hot
// slices are UNIFORMLY giant boards (that's what makes them hot), so they
// must be much smaller than the old mixed slices: the first tiered deploy
// died mid-slice at HOT=30 (one upsert chunk of carvana landed, then the
// worker hit the ceiling and the cron retried the same slice forever).
const HOT_SLICE = 10;
const COLD_SLICE = 60; // cold boards are small (that's why they're cold) — bigger slices keep full-tail rotation inside the hour
const SLICE_LOCK_MS = 3 * 60_000; // min gap between slices
const DESC_CAP = 14_000; // matches the scanner's own input bounds

const db = (): SupabaseClient =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const waitUntil = (p: Promise<unknown>) => {
  const guarded = p.catch((e) => console.warn("[JOB-BOARD] background task failed:", e));
  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(guarded);
  } catch {
    /* fire-and-forget fallback */
  }
};

// ── board fetching ─────────────────────────────────────────────────────────

const listUrl = (s: JobSource) =>
  s.source === "greenhouse"
    // content=true costs a bigger payload but delivers every description in
    // ONE call — fit-ranking coverage for GH boards, plus real departments.
    ? `https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs${LIGHT_DESC_TOKENS.has(s.token) ? "" : "?content=true"}`
    : s.source === "lever"
      ? `https://api.lever.co/v0/postings/${s.token}?mode=json`
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}?includeCompensation=true`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100`
          : s.source === "workable"
            ? `https://apply.workable.com/api/v1/widget/accounts/${s.token}?details=false`
            : `https://${s.token}.bamboohr.com/careers/list`;

// SmartRecruiters paginates; Bosch alone lists ~4.7k postings. The slim SR
// payloads are CPU-cheap (no description work), so the cap is generous —
// with sliced refresh, one giant board dominating a slice is fine.
const SR_CAP = 3000;
async function fetchSmartRecruiters(s: JobSource): Promise<{ content: unknown[] }> {
  const first = await fetchWithTimeout(listUrl(s));
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const page1 = await first.json();
  const total = Math.min(Number(page1.totalFound) || 0, SR_CAP);
  const content: unknown[] = [...(page1.content ?? [])];
  for (let offset = 100; offset < total; offset += 100) {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100&offset=${offset}`);
    if (!res.ok) break; // partial page set is fine — prune guard keys off success of THIS board overall
    const page = await res.json();
    content.push(...(page.content ?? []));
  }
  return { content };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" } });
  } finally {
    clearTimeout(t);
  }
}

/** Fetch + normalize one board. Returns null on failure (caller decides). */
async function fetchBoard(s: JobSource): Promise<{ jobs: JobPosting[]; raw: unknown } | null> {
  try {
    const raw = s.source === "smartrecruiters" ? await fetchSmartRecruiters(s) : await (async () => {
      const res = await fetchWithTimeout(listUrl(s));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    })();
    const jobs =
      s.source === "greenhouse"
        ? normalizeGreenhouse(raw, s.name, s.token)
        : s.source === "lever"
          ? normalizeLever(raw, s.name, s.token)
          : s.source === "ashby"
            ? normalizeAshby(raw, s.name, s.token)
            : s.source === "smartrecruiters"
              ? normalizeSmartRecruiters(raw, s.name, s.token)
              : s.source === "workable"
                ? normalizeWorkable(raw, s.name, s.token)
                : normalizeBambooHR(raw, s.name, s.token);
    return { jobs, raw };
  } catch (e) {
    console.warn(`[JOB-BOARD] board ${s.source}:${s.token} failed:`, String(e).slice(0, 100));
    return null;
  }
}

// ── refresh: fan-out → upsert → prune (only successful boards) ─────────────

// Two-tier cadence: HOT boards (heaviest inventory) re-verify on every
// chain pass (~10 min); the long tail rotates through a fixed budget of
// cold slices per pass, so a full tail rotation is bounded regardless of
// how many boards the catalog grows to. Pass length is therefore FIXED:
// ceil(hot/HOT_SLICE) hot hops + COLD_SLICES_PER_PASS cold hops.
// Hot boards interleaved round-robin by vendor: Greenhouse giants fetch as
// multi-MB JSON (content=true), and a slice whose first concurrent fetches
// are ALL Greenhouse blew the isolate's memory ceiling instantly (the
// 13:04 + 13:20 WORKER_RESOURCE_LIMITs — carvana froze at one 250-row
// chunk). Spreading vendors bounds concurrent heavy parses.
const interleaveByVendor = (list: JobSource[]): JobSource[] => {
  const buckets = new Map<string, JobSource[]>();
  for (const s of list) {
    if (!buckets.has(s.source)) buckets.set(s.source, []);
    buckets.get(s.source)!.push(s);
  }
  const out: JobSource[] = [];
  const qs = [...buckets.values()];
  for (let i = 0; out.length < list.length; i++) {
    for (const q of qs) if (q[i]) out.push(q[i]);
  }
  return out;
};
const HOT_SIZE = 120;
const FALLBACK_HOT_LIST = interleaveByVendor(JOB_SOURCES.filter((s) => HOT_TOKENS.has(s.token)));
const FALLBACK_COLD_LIST = JOB_SOURCES.filter((s) => !HOT_TOKENS.has(s.token));

// Self-tuning tiers: each completed pass writes the current top boards by
// live posting count (meta k=hot_tokens), so a board that grows gets hot
// cadence automatically instead of drifting from the static snapshot the
// catalog shipped with. The static HOT_TOKENS set stays as the fallback
// for a fresh deploy or a glitched meta row.
async function tierLists(client: SupabaseClient): Promise<{ hotList: JobSource[]; coldList: JobSource[] }> {
  const { data } = await client.from("job_board_meta").select("v").eq("k", "hot_tokens").maybeSingle();
  const tokens = (data?.v as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(tokens) || tokens.length < 50) {
    return { hotList: FALLBACK_HOT_LIST, coldList: FALLBACK_COLD_LIST };
  }
  const hot = new Set(tokens.filter((x): x is string => typeof x === "string"));
  return {
    hotList: interleaveByVendor(JOB_SOURCES.filter((s) => hot.has(s.token))),
    coldList: JOB_SOURCES.filter((s) => !hot.has(s.token)),
  };
}
const COLD_SLICES_PER_PASS = 8;
const CHAIN_CAP = Math.ceil(HOT_SIZE / HOT_SLICE) + COLD_SLICES_PER_PASS + 4; // pass length + stall headroom

// force=true bypasses the slice lock, so it must not be reachable from the
// open internet (the function serves anonymous traffic): chain hops carry a
// secret derived from the service-role key, and refresh demotes force to a
// lock-guarded run when the secret doesn't match.
let chainKeyPromise: Promise<string> | null = null;
function chainKey(): Promise<string> {
  chainKeyPromise ??= (async () => {
    const seed = `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}:board-chain`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  })();
  return chainKeyPromise;
}

function chainNextSlice(hop: number) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
  waitUntil(chainKey().then((key) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "refresh", force: true, chain: hop + 1, chainKey: key }),
  })).then((r) => r.text()).catch(() => {}));
}

// Two-tier refresh: HOT boards (heavy inventory) re-verify on every chain
// pass (~10 min); the long tail rotates through cold slices across passes
// (full rotation bounded by tail size / slices-per-pass). Facets come from
// the get_job_board_facets() RPC at pass end — always DB-true, no
// accumulator bookkeeping.
async function runRefresh(client: SupabaseClient, force = false, chainHop = 0): Promise<{ ok: boolean; detail: string }> {
  const { data: prog } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh_progress").maybeSingle();
  if (!force && prog && Date.now() - new Date(prog.updated_at).getTime() < SLICE_LOCK_MS) {
    return { ok: true, detail: "skipped — a slice ran moments ago" };
  }
  const { hotList: HOT_LIST, coldList: COLD_LIST } = await tierLists(client);
  const pv = (prog?.v ?? {}) as { hot?: number; cold?: number; coldDone?: number; failedAcc?: string[] };
  let hot = Math.max(0, Number(pv.hot) || 0);
  let cold = Math.max(0, Number(pv.cold) || 0) % Math.max(1, COLD_LIST.length);
  let coldDone = Math.max(0, Number(pv.coldDone) || 0);
  // Hop 0 RESUMES a recent incomplete pass rather than resetting: when a
  // slice dies on the resource ceiling, the re-run must move FORWARD, not
  // re-die on the same boards (the 13:04-13:38 wedge re-ran slice 0
  // forever). A completed or stale (>45 min) pass starts fresh.
  if (chainHop === 0) {
    const progAge = prog ? Date.now() - new Date(prog.updated_at).getTime() : Infinity;
    const storedDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;
    if (storedDone || progAge > 45 * 60_000) {
      hot = 0;
      coldDone = 0;
      pv.failedAcc = [];
    }
  }

  const inHotPhase = hot < HOT_LIST.length;
  const baseSlice = inHotPhase
    ? HOT_LIST.slice(hot, hot + HOT_SLICE)
    : COLD_LIST.slice(cold, cold + COLD_SLICE);
  // Feature 3 (demand-driven freshness): boards a user just opened/verified
  // jump the queue. Injected only on COLD slices — hot boards already
  // re-check every pass (~10 min), and cold slices have the compute headroom
  // that hot slices of giants do not. So a takedown on a viewed cold-board
  // job disappears within one pass instead of waiting for its rotation.
  let demandBoards: JobSource[] = [];
  if (!inHotPhase) {
    const sliceTokens = new Set(baseSlice.map((s) => s.token));
    const { data: demandMeta } = await client.from("job_board_meta").select("v").eq("k", "demand").maybeSingle();
    demandBoards = (((demandMeta?.v as { tokens?: Array<{ t: string; at: number }> } | null)?.tokens ?? [])
      .filter((x) => Date.now() - x.at < 20 * 60_000 && !sliceTokens.has(x.t))
      .slice(0, 5)
      .map((x) => JOB_SOURCES.find((s) => s.token === x.t))
      .filter((s): s is JobSource => !!s));
  }
  const slice = [...demandBoards, ...baseSlice];
  const startIso = new Date().toISOString();

  // Cursors advance BEFORE processing (optimistic): if this invocation dies
  // on the resource ceiling, the next attempt continues with the NEXT
  // slice — a died slice's boards go one rotation stale instead of wedging
  // the whole pipeline. Failure accounting is finalized after the slice.
  {
    const nextHot = inHotPhase ? hot + HOT_SLICE : hot;
    const nextCold = inHotPhase ? cold : (cold + slice.length) % Math.max(1, COLD_LIST.length);
    const nextColdDone = inHotPhase ? coldDone : coldDone + 1;
    await client.from("job_board_meta").upsert(
      { k: "refresh_progress", v: { hot: nextHot, cold: nextCold, coldDone: nextColdDone, failedAcc: Array.isArray(pv.failedAcc) ? pv.failedAcc : [] }, updated_at: new Date().toISOString() },
      { onConflict: "k" },
    );
  }

  const queue = [...slice];
  const okTokens: string[] = [];
  const failed: string[] = [];
  let sliceTotal = 0;
  let lastUpsertError: string | null = null;

  await Promise.all(
    Array.from({ length: inHotPhase ? HOT_CONCURRENCY : CONCURRENCY }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        const r = await fetchBoard(s);
        if (!r) {
          failed.push(s.name);
          continue;
        }
        const descs = new Map<string, string>();
        if (s.source === "lever") {
          for (const j of (Array.isArray(r.raw) ? r.raw : []) as Array<{ id: string; descriptionPlain?: string; descriptionBodyPlain?: string }>) {
            const text = ((j.descriptionPlain ?? "") + (j.descriptionBodyPlain ? `\n${j.descriptionBodyPlain}` : "")).trim();
            if (text) descs.set(`lever:${s.token}:${j.id}`, text.slice(0, 4000));
          }
        } else if (s.source === "ashby") {
          for (const j of ((r.raw as { jobs?: Array<{ id: string; descriptionPlain?: string; descriptionHtml?: string }> }).jobs ?? [])) {
            const text = (j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : "")).trim();
            if (text) descs.set(`ashby:${s.token}:${j.id}`, text.slice(0, 4000));
          }
        } else if (s.source === "greenhouse" && !LIGHT_DESC_TOKENS.has(s.token)) {
          for (const j of ((r.raw as { jobs?: Array<{ id: number; content?: string }> }).jobs ?? [])) {
            const text = j.content ? htmlToText(String(j.content).slice(0, 12000)).trim() : "";
            if (text) descs.set(`greenhouse:${s.token}:${j.id}`, text.slice(0, 4000));
          }
        }
        const clean = (x: string | null | undefined) => (x == null ? null : x.replace(/\u0000/g, ""));
        const lightDescs = LIGHT_DESC_TOKENS.has(s.token);
        const rowsById = new Map<string, Record<string, unknown>>();
        for (const j of r.jobs) {
          rowsById.set(j.id, {
            id: j.id,
            source: j.source,
            company_token: j.token,
            company: j.company,
            title: clean(j.title.trim().slice(0, 300)),
            location: clean(j.location.trim().slice(0, 300)),
            remote: j.remote,
            department: clean(j.department?.slice(0, 200) ?? null),
            category: j.category,
            posted_at: j.postedAt,
            apply_url: j.applyUrl,
            salary: clean(j.salary?.slice(0, 200) ?? null),
            // Light boards omit the column so previously stored descriptions
            // survive the upsert instead of being nulled.
            ...(lightDescs ? {} : { description: clean(descs.get(j.id) ?? null) }),
            last_seen: startIso, // set at INSERT only — semantically first_seen; rows are never rewritten
          });
        }
        const rows = [...rowsById.values()];

        // Postings are immutable in practice (companies repost rather than
        // edit), so unchanged rows are never rewritten: insert only ids the
        // DB doesn't have, delete ids the feed no longer serves. The old
        // upsert-everything design rewrote all ~91k rows every pass
        // (~450k dead tuples/hour) — enough table bloat that aggregates
        // started hitting statement timeouts.
        let boardOk = true;
        // Paginated: PostgREST caps responses at 1,000 rows, and the biggest
        // boards hold 3,000+ — a truncated id set would re-insert live rows
        // and never delete old ones.
        const existingIds: string[] = [];
        for (let from = 0; ; from += 1000) {
          const { data: page, error: readErr } = await client
            .from("job_board_postings")
            .select("id")
            .eq("company_token", s.token)
            .order("id")
            .range(from, from + 999);
          if (readErr) {
            boardOk = false;
            lastUpsertError = `${s.token}: ${readErr.message}`;
            break;
          }
          existingIds.push(...(page ?? []).map((r) => r.id as string));
          if (!page || page.length < 1000) break;
        }
        if (!boardOk) {
          failed.push(s.name);
          continue;
        }
        const prefix = `${s.source}:`;
        const existing = new Set(existingIds.filter((id) => id.startsWith(prefix)));
        const liveIds = new Set(rowsById.keys());
        const newRows = rows.filter((r) => !existing.has(r.id as string));
        const vanished = [...existing].filter((id) => !liveIds.has(id));

        for (let i = 0; i < newRows.length; i += 250) {
          const { error } = await client.from("job_board_postings").upsert(newRows.slice(i, i + 250), { onConflict: "id" });
          if (error) {
            boardOk = false;
            lastUpsertError = `${s.token}: ${error.message}`;
            console.warn(`[JOB-BOARD] insert failed for ${s.token}:`, error.message.slice(0, 200));
            break;
          }
        }
        if (!boardOk) {
          failed.push(s.name);
          continue;
        }
        for (let i = 0; i < vanished.length; i += 200) {
          await client.from("job_board_postings").delete().in("id", vanished.slice(i, i + 200));
        }
        okTokens.push(s.token);
        sliceTotal += rows.length;
      }
    }),
  );

  // Advance cursors. Cold advances by the ACTUAL slice length — the tail
  // slice is short, and advancing by a full COLD_SLICE would skip the boards
  // just past the wrap point on every rotation.
  if (inHotPhase) hot += HOT_SLICE;
  else {
    const before = cold;
    cold = (cold + slice.length) % Math.max(1, COLD_LIST.length);
    coldDone += 1;
    // The cold cursor just wrapped past the end → the ENTIRE cold tail has
    // now been re-verified. Stamp it: this is the direct measurement of
    // freshness (max staleness of any cold posting = time since this stamp).
    // The heartbeat alerts if it ever falls behind the SLA.
    if (cold < before) {
      await client.from("job_board_meta").upsert(
        { k: "cold_rotation", v: { completedAt: new Date().toISOString(), coldBoards: COLD_LIST.length }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    }
  }
  const passDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;

  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  await client.from("job_board_meta").upsert(
    { k: "refresh_progress", v: { hot, cold, coldDone, failedAcc }, updated_at: new Date().toISOString() },
    { onConflict: "k" },
  );

  // Feature 2 (consecutive-failure pruning): a feed that stops responding
  // keeps its postings (a transient blip must not wipe a company). But a
  // feed dead for ~6 straight attempts is gone for good — prune its stale
  // postings so they can't rot on the board. okTokens reset the streak.
  {
    const okSet = new Set(okTokens);
    const attempted = slice.map((s) => s.token);
    const failedTokens = attempted.filter((tk) => !okSet.has(tk));
    if (okTokens.length > 0 || failedTokens.length > 0) {
      const { data: bfMeta } = await client.from("job_board_meta").select("v").eq("k", "board_failures").maybeSingle();
      const streaks = { ...((bfMeta?.v as { streaks?: Record<string, number> } | null)?.streaks ?? {}) };
      for (const tk of okTokens) delete streaks[tk];
      const toPrune: string[] = [];
      for (const tk of failedTokens) {
        streaks[tk] = (streaks[tk] ?? 0) + 1;
        if (streaks[tk] >= 6) { toPrune.push(tk); delete streaks[tk]; }
      }
      for (const tk of toPrune) {
        await client.from("job_board_postings").delete().eq("company_token", tk);
        console.warn(`[JOB-BOARD] pruned dead board ${tk} (6 consecutive failures)`);
      }
      await client.from("job_board_meta").upsert({ k: "board_failures", v: { streaks }, updated_at: new Date().toISOString() }, { onConflict: "k" });
    }
  }

  if (passDone) {
    // Facets from the database — always true to what the board serves. If
    // the RPC isn't migrated yet (function published before migration ran),
    // keep the previous meta instead of clobbering it with zeros.
    const { data: facets, error: facetsErr } = await client.rpc("get_job_board_facets");
    const f = (facets ?? {}) as Record<string, unknown>;
    if (facetsErr || !f.total) {
      console.warn("[JOB-BOARD] facets RPC unavailable — previous refresh meta kept:", facetsErr?.message ?? "empty result");
      return { ok: true, detail: `pass complete but facets RPC unavailable (${facetsErr?.message ?? "empty result"}) — run migration 20260712080000` };
    }
    let companies = Array.isArray(f.companiesFacet) ? f.companiesFacet : [];

    // Orphan prune: a board removed from sources.ts is never fetched again, so
    // its postings would linger forever. Diff the DB's live company list
    // (from the facets we just computed) against the source of truth and
    // delete any token no longer aboard — so a removal actually disappears.
    const validTokens = new Set(JOB_SOURCES.map((s) => s.token));
    const orphanTokens = companies
      .map((c) => (c as { token?: string }).token)
      .filter((tk): tk is string => typeof tk === "string" && !validTokens.has(tk));
    if (orphanTokens.length > 0) {
      for (const tk of orphanTokens) {
        await client.from("job_board_postings").delete().eq("company_token", tk);
      }
      console.log(`[JOB-BOARD] orphan-pruned ${orphanTokens.length} removed board(s): ${orphanTokens.slice(0, 8).join(", ")}`);
      companies = companies.filter((c) => !orphanTokens.includes((c as { token?: string }).token ?? ""));
    }

    const v = {
      total: f.total, // includes just-pruned orphans until the next pass recomputes — harmless
      boards: companies.length,
      failedSources: failedAcc,
      companiesFacet: companies,
      categoriesFacet: f.categoriesFacet ?? {},
      refreshedAt: startIso,
    };
    await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
    // Re-rank the hot tier from what the corpus actually holds now.
    const ranked = [...companies]
      .filter((c): c is { token: string; count: number } => typeof (c as { token?: unknown }).token === "string" && typeof (c as { count?: unknown }).count === "number")
      .sort((a, b) => b.count - a.count)
      .slice(0, HOT_SIZE)
      .map((c) => c.token);
    if (ranked.length >= 50) {
      await client.from("job_board_meta").upsert(
        { k: "hot_tokens", v: { tokens: ranked }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
    }
    console.log(`[JOB-BOARD] pass complete: hot ${HOT_LIST.length} boards + ${COLD_SLICES_PER_PASS} cold slices; corpus total ${f.total}`);
    // Categorization rules changed since the corpus was stamped? Sweep the
    // stored "other" rows through the current rules in a fresh invocation
    // (own compute budget). Idempotent: the stamp is written only when the
    // sweep completes, so a died sweep retries after the next pass.
    const { data: catVer } = await client.from("job_board_meta").select("v").eq("k", "category_rules_version").maybeSingle();
    if ((catVer?.v as { version?: number } | null)?.version !== CATEGORIZE_VERSION) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recategorize", chainKey: key }),
      })).then((r) => r.text()).catch(() => {}));
    }
    // Feature 1: refresh the light boards' descriptions daily (they arrive
    // description-less on the refresh path). Only when the last backfill is
    // stale, and never concurrent with recategorize — stagger by requiring
    // the category stamp to be current first.
    else {
      const { data: bf } = await client.from("job_board_meta").select("v, updated_at").eq("k", "desc_backfill").maybeSingle();
      const bfAge = bf ? Date.now() - new Date(bf.updated_at).getTime() : Infinity;
      const bfIncomplete = !!(bf?.v as { incompleteAt?: string } | null)?.incompleteAt;
      // Self-healing override: if meaningful description coverage is still
      // missing on the light boards, run regardless of the stamp — this
      // recovers from a stamp written by an older/buggy sweep without any
      // manual reset. One cheap capped count per pass (indexed).
      const lightTokens = JOB_SOURCES.filter((s) => LIGHT_DESC_TOKENS.has(s.token)).map((s) => s.token);
      let missingCoverage = false;
      if (lightTokens.length > 0 && bfAge > 30 * 60_000) {
        const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).in("company_token", lightTokens).is("description", null);
        missingCoverage = (count ?? 0) > 50;
      }
      // Incomplete sweeps (a board failed) retry within the hour; complete
      // ones wait a day (descriptions persist, so only the delta needs work).
      if (missingCoverage || bfAge > (bfIncomplete ? 60 * 60_000 : 24 * 60 * 60_000)) {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill-desc", chainKey: key, ti: 0, off: 0 }),
        })).then((r) => r.text()).catch(() => {}));
      }
    }
    return { ok: true, detail: `pass complete — corpus ${f.total} postings from ${companies.length} boards; cold rotation at ${cold}/${COLD_LIST.length}${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }

  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop);
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}` };
}

// ── detail: one posting's description (bounded memo, no bulk caching) ─────

const detailCache = new Map<string, { at: number; text: string }>();
const DETAIL_TTL_MS = 60 * 60_000;

// Single-posting liveness against the vendor RIGHT NOW — the moment-of-apply
// freshness check. Uses cheap per-job endpoints where they exist (never the
// 20-36 MB whole-board payload for the light giants); falls back to board
// membership for vendors without one. Returns true=live, false=confirmed gone,
// null=couldn't tell (transient) so callers don't wrongly mark a job closed.
const liveBoardMemo = new Map<string, Set<string>>();
async function checkLive(src: JobSource, externalId: string): Promise<boolean | null> {
  try {
    if (src.source === "greenhouse") {
      const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${src.token}/jobs/${externalId}?questions=false`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    if (src.source === "lever") {
      const res = await fetchWithTimeout(`https://api.lever.co/v0/postings/${src.token}/${externalId}?mode=json`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    if (src.source === "smartrecruiters") {
      const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${src.token}/postings/${externalId}`);
      return res.status === 404 ? false : res.ok ? true : null;
    }
    // ashby / workable / bamboohr have no cheap per-job endpoint — fetch the
    // board once (memoized per request) and check membership.
    const memoKey = `${src.source}:${src.token}`;
    let ids = liveBoardMemo.get(memoKey);
    if (!ids) {
      const r = await fetchBoard(src);
      if (!r) return null;
      // Only ashby / workable / bamboohr reach here (gh/lever/SR return above).
      ids = new Set<string>();
      if (src.source === "ashby") for (const j of ((r.raw as { jobs?: Array<{ id: string }> }).jobs ?? [])) ids.add(String(j.id));
      else for (const j of r.jobs) ids.add(j.id.split(":").slice(2).join(":")); // workable/bamboohr composite ids
      liveBoardMemo.set(memoKey, ids);
    }
    return ids.has(externalId);
  } catch {
    return null; // network hiccup — unknown, never a false "closed"
  }
}

async function getDescription(src: JobSource, id: string, externalId: string): Promise<string | null> {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.text;
  let text: string | null = null;
  if (src.source === "smartrecruiters") {
    const res = await fetchWithTimeout(`https://api.smartrecruiters.com/v1/companies/${src.token}/postings/${externalId}`);
    if (res.ok) {
      const j = await res.json();
      const s = j.jobAd?.sections ?? {};
      const html = [s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text].filter(Boolean).join("\n");
      text = htmlToText(html).slice(0, DESC_CAP) || null;
    }
  } else if (src.source === "workable") {
    const res = await fetchWithTimeout(`https://apply.workable.com/api/v1/widget/accounts/${src.token}?details=true`);
    if (res.ok) {
      const j = await res.json();
      const job = (j.jobs ?? []).find((x: { shortcode: string }) => x.shortcode === externalId);
      if (job?.description) text = htmlToText(String(job.description)).slice(0, DESC_CAP) || null;
    }
  } else if (src.source === "bamboohr") {
    text = null; // detail endpoint is unreliable (observed 500s) — honest null
  } else if (src.source === "greenhouse") {
    const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${src.token}/jobs/${externalId}?questions=false`);
    if (res.ok) {
      const j = await res.json();
      text = htmlToText(String(j.content ?? "")).slice(0, DESC_CAP) || null;
    }
  } else {
    // Lever/Ashby ship descriptions in the board payload — fetch the board,
    // extract the one posting, keep nothing else in memory.
    const r = await fetchBoard(src);
    if (r) {
      if (src.source === "lever") {
        const raw = (Array.isArray(r.raw) ? r.raw : []) as Array<{ id: string; descriptionPlain?: string; descriptionBodyPlain?: string }>;
        const job = raw.find((x) => `lever:${src.token}:${x.id}` === id);
        if (job) text = ((job.descriptionPlain ?? "") + (job.descriptionBodyPlain ? `\n${job.descriptionBodyPlain}` : "")).slice(0, DESC_CAP) || null;
      } else {
        const raw = (r.raw as { jobs?: Array<{ id: string; descriptionPlain?: string; descriptionHtml?: string }> }).jobs ?? [];
        const job = raw.find((x) => `ashby:${src.token}:${x.id}` === id);
        if (job) text = (job.descriptionPlain ?? (job.descriptionHtml ? htmlToText(job.descriptionHtml) : "")).slice(0, DESC_CAP) || null;
      }
    }
  }
  if (text) {
    if (detailCache.size > 300) detailCache.clear();
    detailCache.set(id, { at: Date.now(), text });
  }
  return text;
}

// ── list: SQL reads + SWR background refresh ───────────────────────────────

// PostgREST or() syntax breaks on these — strip rather than reject.
const sanitizeTerm = (t: string) => t.replace(/[,()%\\]/g, "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "list");
  const client = db();

  try {
    if (action === "recategorize") {
      // Maintenance sweep, self-invoked at pass end (chainKey-gated like
      // force-refresh). Re-runs the CURRENT rules over stored "other" rows
      // — the only bucket new rules can rescue — updating rows whose
      // category changes. Pages by id cursor; self-chains past the budget.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "recategorize is a maintenance action" }, 403);
      }
      let cursor = typeof body.cursor === "string" ? body.cursor : "";
      let scanned = 0;
      const changed = new Map<string, string[]>(); // new category -> ids
      const PAGES = 8;
      for (let page = 0; page < PAGES; page++) {
        let q = client
          .from("job_board_postings")
          .select("id,title,department")
          .eq("category", "other")
          .order("id")
          .limit(1000);
        if (cursor) q = q.gt("id", cursor);
        const { data: rows, error } = await q;
        if (error) throw error;
        for (const r of rows ?? []) {
          scanned++;
          const cat = categorize(r.title ?? "", r.department ?? null);
          if (cat !== "other") {
            if (!changed.has(cat)) changed.set(cat, []);
            changed.get(cat)!.push(r.id as string);
          }
        }
        if (!rows || rows.length < 1000) { cursor = ""; break; }
        cursor = rows[rows.length - 1].id as string;
      }
      let updated = 0;
      for (const [cat, ids] of changed) {
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await client.from("job_board_postings").update({ category: cat }).in("id", ids.slice(i, i + 200));
          if (error) throw error;
          updated += Math.min(200, ids.length - i);
        }
      }
      if (cursor) {
        // more pages remain — continue in a fresh invocation
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
        waitUntil(chainKey().then((key) => fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recategorize", chainKey: key, cursor }),
        })).then((r) => r.text()).catch(() => {}));
        return json({ ok: true, scanned, updated, nextCursor: cursor });
      }
      await client.from("job_board_meta").upsert(
        { k: "category_rules_version", v: { version: CATEGORIZE_VERSION, sweptAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      console.log(`[JOB-BOARD] recategorize sweep complete: ${scanned} scanned, ${updated} refiled (rules v${CATEGORIZE_VERSION})`);
      return json({ ok: true, scanned, updated, done: true });
    }

    if (action === "refresh") {
      const hop = Number.isFinite(Number(body.chain)) ? Math.max(0, Number(body.chain)) : 0;
      const force = body.force === true && typeof body.chainKey === "string" && body.chainKey === await chainKey();
      const r = await runRefresh(client, force, force ? hop : 0);
      return json(r, r.ok ? 200 : 502);
    }

    if (action === "list") {
      const { data: meta } = await client.from("job_board_meta").select("v, updated_at").eq("k", "refresh").maybeSingle();

      if (!meta) {
        // First boot (migration just applied, no pass yet): one blocking
        // refresh seeds the table; afterwards this path never runs again.
        const seeded = await runRefresh(client, true);
        if (!seeded.ok) return json({ error: "Job board is initializing — try again shortly" }, 503);
        return await serveList(client, body);
      }
      if (Date.now() - new Date(meta.updated_at).getTime() > STALE_MS) {
        waitUntil(runRefresh(client)); // serve stale, refresh behind the scenes
      }
      return await serveList(client, body, meta);
    }

    if (action === "fit-batch") {
      const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 60) : [];
      if (resumeText.trim().length < 100 || ids.length === 0) {
        return json({ error: "resumeText (100+ chars) and ids are required" }, 400);
      }
      // Deterministic compute, but still rate-limited (it reads 60 rows a call).
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const { data: allowed } = await client.rpc("check_rate_limit", {
        p_function: "job-board-fit", p_ip: clientIp, p_max_requests: 120, p_window_minutes: 1440,
      });
      if (allowed === false) return json({ error: "Daily fit-ranking limit reached.", rateLimited: true }, 429);

      const { data: rows, error } = await client
        .from("job_board_postings")
        .select("id, description")
        .in("id", ids);
      if (error) throw error;
      const fits: Record<string, number | null> = {};
      let scored = 0;
      for (const r of rows ?? []) {
        if (r.description && r.description.length > 150) {
          fits[r.id] = computeFit(r.description, resumeText, 40).pct;
          scored++;
        } else {
          fits[r.id] = null; // no stored description (GH/SR/Workable) — honest null
        }
      }
      return json({ fits, scored, of: ids.length });
    }

    if (action === "backfill-desc") {
      // Feature 1: the four Greenhouse giants fetch WITHOUT content on the
      // refresh path (bulk htmlToText wedged the pipeline — see
      // LIGHT_DESC_TOKENS), so their postings land description-less. This
      // maintenance sweep fills the gaps using Greenhouse's PER-JOB endpoint
      // (tiny payloads) — never the 20-36 MB whole-board content payload,
      // which OOM'd/timed out when re-fetched per slice. It targets only
      // rows still missing a description, so after the initial fill the
      // daily delta is near-zero and transient per-job failures self-heal
      // (the row stays null and is retried next run). chainKey-gated.
      if (typeof body.chainKey !== "string" || body.chainKey !== await chainKey()) {
        return json({ error: "backfill-desc is a maintenance action" }, 403);
      }
      const BOARDS = JOB_SOURCES.filter((s) => LIGHT_DESC_TOKENS.has(s.token));
      const PER_HOP = 50; // small per-job fetches; keeps each invocation light
      let ti = Math.max(0, Number(body.ti) || 0);
      // Touch meta each hop so the 24h staleness trigger can't spawn an
      // overlapping sweep while this one is chaining.
      await client.from("job_board_meta").upsert(
        { k: "desc_backfill", v: { runningTi: ti }, updated_at: new Date().toISOString() },
        { onConflict: "k" },
      );
      if (ti >= BOARDS.length) {
        // How much is still missing? A whole failed board (transient) should
        // retry within the hour; a handful of permanently-broken jobs should
        // not thrash the sweep — settle to the daily cadence for those.
        let remaining = 0;
        for (const b of BOARDS) {
          const { count } = await client.from("job_board_postings").select("id", { count: "exact", head: true }).eq("company_token", b.token).is("description", null);
          remaining += count ?? 0;
        }
        const incomplete = remaining > 50;
        await client.from("job_board_meta").upsert(
          { k: "desc_backfill", v: incomplete ? { incompleteAt: new Date().toISOString(), remaining } : { doneAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: "k" },
        );
        return json({ ok: true, done: true, remaining });
      }
      const s = BOARDS[ti];
      // Next PER_HOP postings for this board that still lack a description.
      const { data: rows, error: readErr } = await client
        .from("job_board_postings")
        .select("id")
        .eq("company_token", s.token)
        .is("description", null)
        .order("id")
        .limit(PER_HOP);
      if (readErr) throw readErr;
      let updated = 0;
      const clean = (x: string) => x.replace(/\u0000/g, "");
      for (const row of rows ?? []) {
        const ghId = String(row.id).split(":")[2] ?? "";
        if (!ghId) continue;
        try {
          const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs/${ghId}?questions=false`);
          if (!res.ok) continue;
          const job = (await res.json()) as { content?: string };
          const text = job.content ? clean(htmlToText(String(job.content).slice(0, 12000)).trim()).slice(0, 4000) : "";
          if (text) {
            const { error } = await client.from("job_board_postings").update({ description: text }).eq("id", row.id);
            if (!error) updated++;
          }
        } catch { /* transient — row stays null, retried next run */ }
      }
      // Fewer than a full page means this board has no more null rows to
      // fill — advance to the next board. A full page means keep going here.
      if (!rows || rows.length < PER_HOP) ti += 1;
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
      waitUntil(chainKey().then((key) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill-desc", chainKey: key, ti }),
      })).then((rr) => rr.text()).catch(() => {}));
      return json({ ok: true, board: s.token, updated, remaining: (rows ?? []).length === PER_HOP ? "more" : "board-done", nextTi: ti });
    }

    if (action === "verify") {
      // Live-now liveness for a batch of posting ids (verify-on-apply,
      // surfaced-match re-check). Confirms against the vendor, prunes ids
      // confirmed gone from the DB so they vanish for everyone, and records
      // the boards touched as a demand signal for prioritized refresh.
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
      if (ids.length === 0) return json({ live: {} });
      const liveMap: Record<string, boolean> = {};
      const deadIds: string[] = [];
      const demandTokens = new Set<string>();
      liveBoardMemo.clear();
      for (const id of ids) {
        const [source, token, ...rest] = id.split(":");
        const externalId = rest.join(":");
        const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
        if (!src || !externalId) { liveMap[id] = false; deadIds.push(id); continue; }
        demandTokens.add(src.token);
        const live = await checkLive(src, externalId);
        if (live === false) { liveMap[id] = false; deadIds.push(id); }
        else liveMap[id] = true; // true OR null(unknown) → keep showing, never a false close
      }
      if (deadIds.length > 0) {
        for (let i = 0; i < deadIds.length; i += 50) {
          await client.from("job_board_postings").delete().in("id", deadIds.slice(i, i + 50));
        }
      }
      // Demand signal: boards a user just looked at jump the refresh queue.
      if (demandTokens.size > 0) {
        const { data: dm } = await client.from("job_board_meta").select("v").eq("k", "demand").maybeSingle();
        const prev = ((dm?.v as { tokens?: Array<{ t: string; at: number }> } | null)?.tokens ?? []).filter((x) => Date.now() - x.at < 20 * 60_000);
        const merged = [...prev.filter((x) => !demandTokens.has(x.t)), ...[...demandTokens].map((t) => ({ t, at: Date.now() }))].slice(-60);
        await client.from("job_board_meta").upsert({ k: "demand", v: { tokens: merged }, updated_at: new Date().toISOString() }, { onConflict: "k" });
      }
      return json({ live: liveMap, pruned: deadIds.length });
    }

    if (action === "exists") {
      // Feature 7: the tracker asks which of a user's saved/applied job ids
      // are still live. A missing id means the company took the posting down
      // (refresh deletes vanished ids within the hour). Read-only, cheap.
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
      if (ids.length === 0) return json({ open: {} });
      const openMap: Record<string, boolean> = {};
      for (const id of ids) openMap[id] = false;
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await client
          .from("job_board_postings")
          .select("id")
          .in("id", ids.slice(i, i + 200));
        if (error) throw error;
        for (const r of data ?? []) openMap[r.id as string] = true;
      }
      return json({ open: openMap });
    }

    if (action === "detail") {
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      // Allowlist gate — the token must be one of ours (no SSRF via crafted ids).
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      const { data: jobRow } = await client.from("job_board_postings").select("*").eq("id", id).maybeSingle();
      // Stored description first (Lever/Ashby); live fetch covers the rest.
      const description = (jobRow?.description && jobRow.description.length > 200)
        ? jobRow.description
        : await getDescription(src, id, externalId);
      if (!description && !jobRow) return json({ error: "Posting not found (it may have closed)" }, 404);
      return json({ job: jobRow ? rowToJob(jobRow) : null, description });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[JOB-BOARD] error:", e);
    return json({ error: "Job board temporarily unavailable" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
const rowToJob = (r: any) => ({
  id: r.id,
  source: r.source,
  token: r.company_token,
  company: r.company,
  title: r.title,
  location: r.location,
  remote: r.remote,
  department: r.department,
  category: r.category,
  postedAt: r.posted_at,
  applyUrl: r.apply_url,
  salary: r.salary ?? null,
});

async function serveList(
  client: SupabaseClient,
  body: Record<string, unknown>,
  meta?: { v: Record<string, unknown>; updated_at: string } | null,
) {
  const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const countOnly = body.countOnly === true;

  // effective_posted = coalesce(posted_at, first_seen): undated feeds
  // (BambooHR) participate in freshness filters and recency sort. If the
  // function deploys before its migration, the column is missing — fall
  // back to posted_at for that window instead of 500ing the board.
  const buildQuery = (dateCol: string) => {
    let q = client
      .from("job_board_postings")
      .select("id,source,company_token,company,title,location,remote,department,category,posted_at,apply_url,salary", { count: "exact" });
    const terms = String(body.q ?? "").toLowerCase().split(/\s+/).map(sanitizeTerm).filter(Boolean).slice(0, 8);
    for (const t of terms) q = q.or(`title.ilike.%${t}%,company.ilike.%${t}%,department.ilike.%${t}%`);
    const loc = sanitizeTerm(String(body.location ?? ""));
    if (loc) q = q.ilike("location", `%${loc}%`);
    if (body.remote === true) q = q.eq("remote", true);
    const category = String(body.category ?? "");
    if ((JOB_CATEGORIES as readonly string[]).includes(category)) q = q.eq("category", category);
    if (Array.isArray(body.companies)) {
      const tokens = body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length);
      if (tokens.length) q = q.in("company_token", tokens);
    }
    // Saved searches ask "how many NEW since I last looked" — a cheap count.
    if (typeof body.postedAfter === "string" && !Number.isNaN(Date.parse(body.postedAfter))) {
      q = q.gt(dateCol, body.postedAfter);
    }
    return q;
  };
  const missingColumn = (e: { message?: string } | null) => !!e?.message?.includes("effective_posted");

  if (countOnly) {
    let { count, error } = await buildQuery("effective_posted").range(0, 0);
    if (missingColumn(error)) ({ count, error } = await buildQuery("posted_at").range(0, 0));
    if (error) throw error;
    return json({ total: count ?? 0 });
  }

  // Stable pagination: recency desc (nulls last), id as tiebreaker so
  // equal dates can't shuffle between "load more" pages.
  const page = (dateCol: string) =>
    buildQuery(dateCol)
      .order(dateCol, { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
  let { data, error, count } = await page("effective_posted");
  if (missingColumn(error)) ({ data, error, count } = await page("posted_at"));
  if (error) throw error;

  const v = (meta?.v ?? {}) as Record<string, unknown>;
  // The company facet grows with the catalog (~60 bytes/company); refetches
  // that already hold it can opt out instead of re-downloading it per filter
  // change. Absent/true keeps the old contract for deployed frontends.
  const includeFacets = (body as { includeFacets?: boolean }).includeFacets !== false;
  return json({
    jobs: (data ?? []).map(rowToJob),
    total: count ?? 0,
    totalAllCompanies: (v.total as number) ?? count ?? 0,
    companies: includeFacets ? ((v.companiesFacet as unknown[]) ?? []) : [],
    categories: (v.categoriesFacet as Record<string, number>) ?? {},
    failedSources: (v.failedSources as string[]) ?? [],
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}
