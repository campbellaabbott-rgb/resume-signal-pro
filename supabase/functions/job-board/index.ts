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
import { JOB_SOURCES, type JobSource } from "./sources.ts";
import {
  htmlToText,
  normalizeAshby,
  normalizeGreenhouse,
  normalizeLever,
  normalizeSmartRecruiters,
  normalizeWorkable,
  type JobPosting,
} from "./normalize.ts";
import { JOB_CATEGORIES } from "./categories.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const STALE_MS = 12 * 60_000; // SWR threshold — cron target is 10 min
const LOCK_MS = 5 * 60_000; // min gap between refresh passes
const FETCH_TIMEOUT_MS = 8_000;
const CONCURRENCY = 12;
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
    ? `https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs`
    : s.source === "lever"
      ? `https://api.lever.co/v0/postings/${s.token}?mode=json`
      : s.source === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${s.token}`
        : s.source === "smartrecruiters"
          ? `https://api.smartrecruiters.com/v1/companies/${s.token}/postings?limit=100`
          : `https://apply.workable.com/api/v1/widget/accounts/${s.token}?details=false`;

// SmartRecruiters paginates; Bosch alone lists ~4.7k postings. 500/board
// keeps a full refresh under ~90s — the board never claimed per-company
// exhaustiveness, and newest-first ordering surfaces the fetched ones.
const SR_CAP = 500;
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
              : normalizeWorkable(raw, s.name, s.token);
    return { jobs, raw };
  } catch (e) {
    console.warn(`[JOB-BOARD] board ${s.source}:${s.token} failed:`, String(e).slice(0, 100));
    return null;
  }
}

// ── refresh: fan-out → upsert → prune (only successful boards) ─────────────

async function runRefresh(client: SupabaseClient, force = false): Promise<{ ok: boolean; detail: string }> {
  // Lock: skip if a pass finished recently (cron + SWR + manual can overlap).
  const { data: meta } = await client.from("job_board_meta").select("updated_at").eq("k", "refresh").maybeSingle();
  if (!force && meta && Date.now() - new Date(meta.updated_at).getTime() < LOCK_MS) {
    return { ok: true, detail: "skipped — refreshed recently" };
  }
  const startIso = new Date().toISOString();

  const queue = [...JOB_SOURCES];
  const okTokens: string[] = [];
  const failed: string[] = [];
  const allRows: Record<string, unknown>[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        const r = await fetchBoard(s);
        if (!r) {
          failed.push(s.name);
          continue;
        }
        okTokens.push(s.token);
        for (const j of r.jobs) {
          allRows.push({
            id: j.id,
            source: j.source,
            company_token: j.token,
            company: j.company,
            title: j.title.slice(0, 300),
            location: j.location.slice(0, 300),
            remote: j.remote,
            department: j.department?.slice(0, 200) ?? null,
            category: j.category,
            posted_at: j.postedAt,
            apply_url: j.applyUrl,
            last_seen: startIso,
          });
        }
      }
    }),
  );

  if (okTokens.length === 0) return { ok: false, detail: "every board fetch failed — nothing written" };

  for (let i = 0; i < allRows.length; i += 500) {
    const { error } = await client.from("job_board_postings").upsert(allRows.slice(i, i + 500), { onConflict: "id" });
    if (error) return { ok: false, detail: `upsert failed at chunk ${i}: ${error.message}` };
  }

  // Prune vanished postings — but ONLY for boards that answered this pass,
  // so a transient feed outage never mass-deletes a company's listings.
  for (let i = 0; i < okTokens.length; i += 50) {
    await client
      .from("job_board_postings")
      .delete()
      .lt("last_seen", startIso)
      .in("company_token", okTokens.slice(i, i + 50));
  }

  // Facets are computed here once per pass (global, not filter-aware) so the
  // hot list path never pays for aggregation.
  const companiesFacet: Array<{ token: string; name: string; count: number }> = [];
  const categoriesFacet: Record<string, number> = {};
  {
    const counts = new Map<string, number>();
    for (const r of allRows) counts.set(r.company_token as string, (counts.get(r.company_token as string) ?? 0) + 1);
    for (const s of JOB_SOURCES) {
      const c = counts.get(s.token) ?? 0;
      if (c > 0) companiesFacet.push({ token: s.token, name: s.name, count: c });
    }
    for (const r of allRows) categoriesFacet[r.category as string] = (categoriesFacet[r.category as string] ?? 0) + 1;
  }

  const v = {
    total: allRows.length,
    boards: okTokens.length,
    failedSources: failed,
    companiesFacet,
    categoriesFacet,
    refreshedAt: startIso,
  };
  await client.from("job_board_meta").upsert({ k: "refresh", v, updated_at: new Date().toISOString() }, { onConflict: "k" });
  console.log(`[JOB-BOARD] refresh: ${allRows.length} postings from ${okTokens.length}/${JOB_SOURCES.length} boards (${failed.length} failed)`);
  return { ok: true, detail: `${allRows.length} postings from ${okTokens.length} boards` };
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
      const r = await runRefresh(client, body.force === true);
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

    if (action === "detail") {
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      // Allowlist gate — the token must be one of ours (no SSRF via crafted ids).
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      const [description, { data: jobRow }] = await Promise.all([
        getDescription(src, id, externalId),
        client.from("job_board_postings").select("*").eq("id", id).maybeSingle(),
      ]);
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
    .select("id,source,company_token,company,title,location,remote,department,category,posted_at,apply_url", { count: "exact" });

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
  return json({
    jobs: (data ?? []).map(rowToJob),
    total: count ?? 0,
    totalAllCompanies: (v.total as number) ?? count ?? 0,
    companies: (v.companiesFacet as unknown[]) ?? [],
    categories: (v.categoriesFacet as Record<string, number>) ?? {},
    failedSources: (v.failedSources as string[]) ?? [],
    refreshedAt: (v.refreshedAt as string) ?? null,
  });
}
