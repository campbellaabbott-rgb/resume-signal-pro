// The apply worker. Claims released packets, drives the real form, reports back.
//
// Runs as its own service because Supabase edge functions are Deno with no
// browser binary, and every zero-CAPTCHA vendor builds its form in JavaScript —
// measured 2026-07-30, 0% postable forms across all seven. There is nothing an
// HTTP client can POST to, so this needs Chromium.
//
// What it will not do, and none of it is incidental:
//   - touch a vendor outside the measured zero-CAPTCHA set (re-checked here, not
//     trusted from the row)
//   - solve or evade a CAPTCHA; if one appears the packet goes back to a human
//   - retry an ambiguous submit
//   - claim a row another worker holds
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { applyToPosting } from "./apply.js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const WORKER_ID = process.env.WORKER_ID ?? `worker-${Math.random().toString(36).slice(2, 8)}`;
// Between applications. Not evasion — plain courtesy to an employer's server,
// and it keeps one candidate's batch from looking like a burst.
const GAP_MS = Number(process.env.APPLY_GAP_MS ?? 20_000);
const IDLE_MS = 30_000;

// The measured zero-CAPTCHA set. Duplicated here deliberately: the worker is the
// last gate before a real submission and must not depend on a database row being
// right about what it is allowed to touch.
const AUTO_VENDORS = new Set([
  "workday", "smartrecruiters", "breezy", "oracle", "teamtailor", "personio", "pinpoint",
]);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[worker] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Packet = {
  id: number; user_id: string; posting_id: string; title: string; company: string;
  apply_url: string; source: string;
  fields: Record<string, { value: string; source: string }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function release(id: number, patch: Record<string, unknown>) {
  await db.from("agent_submissions").update({ claimed_at: null, claimed_by: "", ...patch }).eq("id", id);
}

async function runOne(browser: Awaited<ReturnType<typeof chromium.launch>>, p: Packet): Promise<string> {
  const src = String(p.source ?? "").toLowerCase();

  // Belt and braces against the row being wrong about its own vendor — a stale
  // tier table, a hand-edited allow-list, a vendor that changed since the packet
  // was prepared. The worker is the last thing standing before a real send.
  if (!AUTO_VENDORS.has(src)) {
    await release(p.id, { status: "blocked", attempts: 99,
      blockers: [{ kind: "vendor-not-auto", detail: `${src} is not in the measured zero-CAPTCHA set` }] });
    return `skipped ${src}`;
  }

  const outcome = await applyToPosting(browser, {
    applyUrl: p.apply_url, source: src, fields: p.fields ?? {},
  });

  if (outcome.kind === "submitted") {
    // The trigger on agent_submissions refuses `submitted` without both a
    // timestamp and a source, so this cannot record a send that did not happen.
    await release(p.id, {
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_via: "worker",
      error: "",
    });
    // Mirror into the tracker the human reads, so the two never disagree about
    // what this person has applied to.
    await db.from("user_applications").insert({
      user_id: p.user_id, company: p.company, role: p.title,
      status: "applied", job_id: p.posting_id, apply_url: p.apply_url,
    }).then(() => {}, () => {});
    return `SENT ${p.company} — ${p.title}`;
  }

  if (outcome.kind === "uncertain") {
    // Never our call to resolve. The RPC parks it for a human AND pushes
    // attempts past the ceiling so nothing picks it up again.
    await db.rpc("agent_mark_uncertain", { p_id: p.id, p_reason: outcome.reason });
    return `UNCERTAIN ${p.company} — ${outcome.reason}`;
  }

  // not-submitted: nothing was sent, so this is safely retryable within the
  // attempt ceiling. The reason is stored where the candidate can read it.
  await release(p.id, {
    status: "blocked",
    blockers: [{ kind: "worker", detail: outcome.reason }],
    error: outcome.reason.slice(0, 300),
  });
  return `not sent ${p.company} — ${outcome.reason}`;
}

async function main() {
  console.log(`[worker] ${WORKER_ID} starting`);
  const browser = await chromium.launch({ headless: true });
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => { console.log(`[worker] ${sig} — finishing current packet`); stopping = true; });
  }

  while (!stopping) {
    const { data, error } = await db.rpc("agent_claim_submission", {
      p_worker: WORKER_ID, p_lease_minutes: 10,
    });
    if (error) { console.error("[worker] claim failed:", error.message); await sleep(IDLE_MS); continue; }
    const p = (Array.isArray(data) ? data[0] : null) as Packet | null;
    if (!p) { await sleep(IDLE_MS); continue; }

    console.log(`[worker] claimed #${p.id} ${p.source} ${p.company}`);
    try {
      console.log(`[worker] ${await runOne(browser, p)}`);
    } catch (e) {
      // A crash after clicking submit is the same ambiguity as a timeout, and
      // gets the same treatment: parked, never retried.
      console.error(`[worker] #${p.id} threw:`, String(e).slice(0, 200));
      await db.rpc("agent_mark_uncertain", { p_id: p.id, p_reason: `worker crashed: ${String(e).slice(0, 140)}` });
    }
    await sleep(GAP_MS);
  }

  await browser.close();
  console.log("[worker] stopped");
}

main().catch((e) => { console.error("[worker] fatal:", e); process.exit(1); });
