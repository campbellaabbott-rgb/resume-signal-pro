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
import { JOB_CATEGORIES } from "./categories.ts";
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
const HOT_LIST = interleaveByVendor(JOB_SOURCES.filter((s) => HOT_TOKENS.has(s.token)));
const COLD_LIST = JOB_SOURCES.filter((s) => !HOT_TOKENS.has(s.token));
const COLD_SLICES_PER_PASS = 8;
const CHAIN_CAP = Math.ceil(HOT_LIST.length / HOT_SLICE) + COLD_SLICES_PER_PASS + 4; // pass length + stall headroom

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
  const slice = inHotPhase
    ? HOT_LIST.slice(hot, hot + HOT_SLICE)
    : COLD_LIST.slice(cold, cold + COLD_SLICE);
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
            last_seen: startIso,
          });
        }
        const rows = [...rowsById.values()];
        let boardOk = true;
        for (let i = 0; i < rows.length; i += 250) {
          const { error } = await client.from("job_board_postings").upsert(rows.slice(i, i + 250), { onConflict: "id" });
          if (error) {
            boardOk = false;
            lastUpsertError = `${s.token}: ${error.message}`;
            console.warn(`[JOB-BOARD] upsert failed for ${s.token}:`, error.message.slice(0, 200));
            break;
          }
        }
        if (!boardOk) {
          failed.push(s.name);
          continue;
        }
        okTokens.push(s.token);
        sliceTotal += rows.length;
      }
    }),
  );

  // Prune vanished postings for boards that answered THIS slice only.
  for (let i = 0; i < okTokens.length; i += 50) {
    await client
      .from("job_board_postings")
      .delete()
      .lt("last_seen", startIso)
      .in("company_token", okTokens.slice(i, i + 50));
  }

  // Advance cursors. Cold advances by the ACTUAL slice length — the tail
  // slice is short, and advancing by a full COLD_SLICE would skip the boards
  // just past the wrap point on every rotation.
  if (inHotPhase) hot += HOT_SLICE;
  else {
    cold = (cold + slice.length) % Math.max(1, COLD_LIST.length);
    coldDone += 1;
  }
  const passDone = hot >= HOT_LIST.length && coldDone >= COLD_SLICES_PER_PASS;

  const failedAcc = [...(Array.isArray(pv.failedAcc) ? pv.failedAcc : []), ...failed].slice(-120);
  await client.from("job_board_meta").upsert(
    { k: "refresh_progress", v: { hot, cold, coldDone, failedAcc }, updated_at: new Date().toISOString() },
    { onConflict: "k" },
  );

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
    const companies = Array.isArray(f.companiesFacet) ? f.companiesFacet : [];
    const v = {
      total: f.total,
      boards: companies.length,
      failedSources: failedAcc,
      companiesFacet: companies,
      categoriesFacet: f.categoriesFacet ?? {},
      refreshedAt: startIso,
    };
    await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
    console.log(`[JOB-BOARD] pass complete: hot ${HOT_LIST.length} boards + ${COLD_SLICES_PER_PASS} cold slices; corpus total ${f.total}`);
    return { ok: true, detail: `pass complete — corpus ${f.total} postings from ${companies.length} boards; cold rotation at ${cold}/${COLD_LIST.length}${lastUpsertError ? ` — last upsert error: ${String(lastUpsertError).slice(0, 120)}` : ""}` };
  }

  if (chainHop < CHAIN_CAP) chainNextSlice(chainHop);
  const phase = inHotPhase ? `hot ${Math.min(hot, HOT_LIST.length)}/${HOT_LIST.length}` : `cold slice ${coldDone}/${COLD_SLICES_PER_PASS} (rotation ${cold}/${COLD_LIST.length})`;
  return { ok: true, detail: `slice done (${sliceTotal} postings, ${failed.length} failed) — ${phase}` };
}

// ── detail: one posting's description (bounded memo, no bulk caching) ─────

const detailCache = new Map<string, { at: number; text: string }>();
const DETAIL_TTL_MS = 60 * 60_000;

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
    q = q.gt("posted_at", body.postedAfter);
  }
  if (countOnly) {
    const { count, error } = await q.range(0, 0);
    if (error) throw error;
    return json({ total: count ?? 0 });
  }

  // Stable pagination: posted_at desc (nulls last), id as tiebreaker so
  // equal dates can't shuffle between "load more" pages.
  const { data, error, count } = await q
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
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
