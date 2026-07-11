// Job board aggregator. Pulls live postings from each company's OFFICIAL
// public job-board API (Greenhouse / Lever / Ashby — endpoints the vendors
// publish for exactly this), normalizes them, and serves filtered lists.
// "Apply" always points at the company's own posting page; we never proxy
// or fake submissions.
//
//   POST { action: "list", q?, location?, remote?, companies?, limit?, offset? }
//   POST { action: "detail", id }   // full description text for the fit scan
//
// Per-board results are cached in module memory for 10 minutes: a cold
// isolate pays one ~5–10s fan-out; warm requests are instant. Dead tokens
// (companies migrating ATSs) degrade gracefully via failedSources.

import { JOB_SOURCES, type JobSource } from "./sources.ts";
import {
  filterJobs,
  htmlToText,
  normalizeAshby,
  normalizeGreenhouse,
  normalizeLever,
  sortJobs,
  type JobPosting,
} from "./normalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 6_000;
const CONCURRENCY = 10;

interface BoardCacheEntry {
  at: number;
  jobs: JobPosting[];
  /** Lever/Ashby ship descriptions in the list payload — kept here (trimmed)
      so detail lookups don't refetch. Greenhouse details are fetched on
      demand into gh-detail cache below. */
  descriptions: Map<string, string>;
  failed: boolean;
}
const boardCache = new Map<string, BoardCacheEntry>();
const ghDetailCache = new Map<string, { at: number; text: string }>();
const DESC_CAP = 14_000; // matches the scanner's own resume/JD input bounds

const listUrl = (s: JobSource) =>
  s.source === "greenhouse"
    ? `https://boards-api.greenhouse.io/v1/boards/${s.token}/jobs`
    : s.source === "lever"
      ? `https://api.lever.co/v0/postings/${s.token}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${s.token}`;

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" } });
  } finally {
    clearTimeout(t);
  }
}

async function loadBoard(s: JobSource): Promise<BoardCacheEntry> {
  const key = `${s.source}:${s.token}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && !hit.failed) return hit;
  try {
    const res = await fetchWithTimeout(listUrl(s));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    let jobs: JobPosting[] = [];
    const descriptions = new Map<string, string>();
    if (s.source === "greenhouse") {
      jobs = normalizeGreenhouse(raw, s.name, s.token);
    } else if (s.source === "lever") {
      jobs = normalizeLever(raw, s.name, s.token);
      for (const j of Array.isArray(raw) ? raw : []) {
        const text = (j.descriptionPlain ?? "") + (j.descriptionBodyPlain ? `\n${j.descriptionBodyPlain}` : "");
        if (text.trim()) descriptions.set(`lever:${s.token}:${j.id}`, text.slice(0, DESC_CAP));
      }
    } else {
      jobs = normalizeAshby(raw, s.name, s.token);
      for (const j of raw.jobs ?? []) {
        const text = j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : "");
        if (text.trim()) descriptions.set(`ashby:${s.token}:${j.id}`, text.slice(0, DESC_CAP));
      }
    }
    const entry = { at: Date.now(), jobs, descriptions, failed: false };
    boardCache.set(key, entry);
    return entry;
  } catch (e) {
    console.warn(`[JOB-BOARD] board ${key} failed:`, String(e).slice(0, 120));
    // Serve stale data over nothing; only mark failed when we have nothing.
    if (hit) return { ...hit, at: Date.now() };
    const entry = { at: Date.now(), jobs: [], descriptions: new Map<string, string>(), failed: true };
    boardCache.set(key, entry);
    return entry;
  }
}

async function loadAllBoards(): Promise<{ jobs: JobPosting[]; failedSources: string[] }> {
  const results: BoardCacheEntry[] = [];
  const queue = [...JOB_SOURCES];
  const failedSources: string[] = [];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      const entry = await loadBoard(s);
      if (entry.failed) failedSources.push(s.name);
      results.push(entry);
    }
  });
  await Promise.all(workers);
  return { jobs: results.flatMap((r) => r.jobs), failedSources };
}

async function greenhouseDetail(token: string, externalId: string): Promise<string | null> {
  const key = `greenhouse:${token}:${externalId}`;
  const hit = ghDetailCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS * 6) return hit.text;
  const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${externalId}?questions=false`);
  if (!res.ok) return null;
  const j = await res.json();
  const text = htmlToText(String(j.content ?? "")).slice(0, DESC_CAP);
  if (!text.trim()) return null;
  if (ghDetailCache.size > 300) ghDetailCache.clear(); // crude but sufficient bound
  ghDetailCache.set(key, { at: Date.now(), text });
  return text;
}

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

  try {
    if (action === "list") {
      const { jobs, failedSources } = await loadAllBoards();
      const filtered = filterJobs(jobs, {
        q: typeof body.q === "string" ? body.q.slice(0, 200) : undefined,
        location: typeof body.location === "string" ? body.location.slice(0, 120) : undefined,
        remote: body.remote === true,
        companies: Array.isArray(body.companies)
          ? body.companies.filter((c): c is string => typeof c === "string").slice(0, JOB_SOURCES.length)
          : undefined,
      });
      const sorted = sortJobs(filtered);
      const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
      const offset = Math.max(Number(body.offset) || 0, 0);
      // Company facet reflects the CURRENT text filters so counts stay honest.
      const counts = new Map<string, number>();
      for (const j of filtered) counts.set(j.token, (counts.get(j.token) ?? 0) + 1);
      return json({
        jobs: sorted.slice(offset, offset + limit),
        total: filtered.length,
        totalAllCompanies: jobs.length,
        companies: JOB_SOURCES.map((s) => ({ token: s.token, name: s.name, count: counts.get(s.token) ?? 0 })),
        failedSources,
        fetchedAt: new Date().toISOString(),
      });
    }

    if (action === "detail") {
      const id = String(body.id ?? "");
      const [source, token, ...rest] = id.split(":");
      const externalId = rest.join(":");
      // Allowlist gate — the token must be one of ours (no SSRF via crafted ids).
      const src = JOB_SOURCES.find((s) => s.source === source && s.token === token);
      if (!src || !externalId) return json({ error: "Unknown job id" }, 404);
      const entry = await loadBoard(src);
      const job = entry.jobs.find((j) => j.id === id) ?? null;
      let description: string | null = entry.descriptions.get(id) ?? null;
      if (!description && source === "greenhouse") description = await greenhouseDetail(token, externalId);
      if (!job && !description) return json({ error: "Posting not found (it may have closed)" }, 404);
      return json({ job, description });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[JOB-BOARD] error:", e);
    return json({ error: "Job board temporarily unavailable" }, 500);
  }
});
