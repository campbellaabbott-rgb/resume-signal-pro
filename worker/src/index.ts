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
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyToPosting } from "./apply.js";
import { ADAPTERS, BLOCKED } from "./vendors/index.js";
import type { PacketFieldKey } from "./vendors/types.js";
import type { StandingAnswers } from "./questions/match.js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const WORKER_ID = process.env.WORKER_ID ?? `worker-${Math.random().toString(36).slice(2, 8)}`;
// Between applications. Not evasion — plain courtesy to an employer's server,
// and it keeps one candidate's batch from looking like a burst.
const GAP_MS = Number(process.env.APPLY_GAP_MS ?? 20_000);
const IDLE_MS = 30_000;
// Reported in the heartbeat so two overlapping versions during a redeploy can be
// told apart when one of them is the one misbehaving.
const WORKER_VERSION = "2026-07-31.1";

// The measured zero-CAPTCHA set. Duplicated here deliberately: the worker is the
// last gate before a real submission and must not depend on a database row being
// right about what it is allowed to touch.
// Derived from the adapters, never hand-listed. A vendor is servable only when
// someone has looked at its real form and written an adapter (worker/RECON.md).
// The old hand-maintained list included workday, which needs a per-tenant
// candidate account nobody has built, and four vendors that have had no recon —
// so it claimed capability the driver did not have.
const AUTO_VENDORS = new Set(Object.keys(ADAPTERS));

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

// Stage the résumé to local disk. Playwright's setInputFiles needs a real path —
// it cannot take a URL or a buffer for a file input, and a file input is the one
// control on nearly every application form that cannot be typed into.
//
// The bucket is PRIVATE, so this reads with the service key. That is the only
// path by which a résumé leaves its owner's control, and it goes straight into
// an application that owner asked for.
async function stageResume(userId: string): Promise<{ path: string; dir: string } | null> {
  const { data: m } = await db.from("agent_mandates")
    .select("resume_file_url").eq("user_id", userId).maybeSingle();
  const key = String((m as { resume_file_url?: string } | null)?.resume_file_url ?? "").trim();
  if (!key) return null;

  // The stored value is a storage PATH, not a URL. A row still holding an http
  // URL predates the bucket and cannot be downloaded this way — better to skip
  // and let the form's required-field check block than to attach nothing and
  // submit an application with no résumé.
  if (/^https?:\/\//i.test(key)) {
    console.warn(`[worker] ${userId} resume_file_url is a URL, not a storage path — skipping`);
    return null;
  }

  const { data, error } = await db.storage.from("resumes").download(key);
  if (error || !data) {
    console.warn(`[worker] resume download failed for ${userId}: ${error?.message ?? "no data"}`);
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), "rb-resume-"));
  const name = key.split("/").pop() || "resume.pdf";
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await data.arrayBuffer()));
  return { path, dir };
}


/**
 * Packet answers arrive keyed by the QUESTION LABEL the vendor used. The driver
 * wants a closed set of field keys so each adapter can decide where a value
 * belongs on its own form.
 *
 * Anything unrecognised is dropped rather than guessed into a nearby field —
 * putting a salary expectation into a cover-note box because both are text is
 * the kind of "helpful" that reaches a real employer.
 */
const FIELD_ALIASES: Array<[RegExp, PacketFieldKey]> = [
  [/^(full|your)?\s*name$/i, "fullName"],
  [/first\s*name/i, "firstName"],
  [/last\s*name|surname|family name/i, "lastName"],
  [/^confirm.*email/i, "confirmEmail"],
  [/e-?mail/i, "email"],
  [/phone|mobile|telephone/i, "phone"],
  [/^city|town$/i, "city"],
  [/^country/i, "country"],
  [/address/i, "address"],
  [/linked\s*in/i, "linkedin"],
  [/website|portfolio|personal site/i, "website"],
  [/cover|message|why|summary|tell us/i, "coverNote"],
  [/salary|compensation|expected pay/i, "salaryExpectation"],
];

function toFieldKeys(
  raw: Record<string, { value: string; source: string }>,
): Partial<Record<PacketFieldKey, { value: string; source: string }>> {
  const out: Partial<Record<PacketFieldKey, { value: string; source: string }>> = {};
  for (const [label, field] of Object.entries(raw ?? {})) {
    const hit = FIELD_ALIASES.find(([re]) => re.test(label.trim()));
    // First alias wins, and an already-filled key is not overwritten: the
    // earliest label is the one the packet builder considered primary.
    if (hit && !out[hit[1]]) out[hit[1]] = field;
  }
  return out;
}

/**
 * The candidate's standing answers to employer screening questions.
 *
 * Read from the mandate at claim time rather than snapshotted into the packet:
 * somebody who corrects "requires sponsorship" this morning must not have
 * yesterday's answer sent to an employer this afternoon.
 *
 * Booleans stay TRINARY. `?? null` and never `?? false` — a missing row means
 * the person never answered, and defaulting that to "no" would have the agent
 * tell an employer a candidate is not authorised to work in a country when they
 * simply had not said. That ends the application, and it is a false statement.
 */
async function loadAnswers(userId: string): Promise<StandingAnswers | undefined> {
  // COLUMN NAMES ARE VERIFIED AGAINST THE SCHEMA, not guessed from the field
  // names in StandingAnswers. My first version asked for first_name, last_name,
  // address, linkedin_url and website_url; the table has none of those (it has
  // linkedin and website, and no split name at all). PostgREST answers an
  // unknown column with an error and no rows, so loadAnswers would have
  // returned undefined every time and every screening form would have been
  // refused — the feature silently absent, looking exactly like "no employer
  // form is answerable".
  const { data, error } = await db.from("agent_mandates")
    .select("full_name, email, phone, city, country, location, linkedin, website, " +
            "salary_expectation, earliest_start, work_authorized, requires_sponsorship, " +
            "willing_to_relocate, share_demographics, consent_to_processing")
    .eq("user_id", userId).maybeSingle();
  if (error) {
    // Loud, because the failure mode is invisible: no answers means every form
    // with a screening question is refused, which reads as a hard market rather
    // than a broken query.
    console.error(`[worker] loadAnswers failed for ${userId}: ${error.message}`);
    return undefined;
  }
  if (!data) return undefined;
  const m = data as unknown as Record<string, unknown>;
  const str = (k: string) => String(m[k] ?? "").trim();
  // TRINARY. `?? null`, never `?? false` — a column the candidate never filled
  // in means "not stated". Defaulting it to "no" would have the agent tell an
  // employer someone is not authorised to work in a country when they simply
  // had not said, which is both a false statement and an instant rejection.
  const tri = (k: string) => (typeof m[k] === "boolean" ? (m[k] as boolean) : null);

  // The table stores one name. Splitting it is a formatting choice about the
  // candidate's own stated name, not an inference about a new fact.
  const full = str("full_name");
  const parts = full.split(/\s+/).filter(Boolean);
  const firstName = parts.length > 0 ? parts[0]! : "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";

  return {
    fullName: full, firstName, lastName,
    email: str("email"), phone: str("phone"),
    city: str("city") || str("location"), country: str("country"),
    // No address column exists. Left empty on purpose so that a form requiring
    // an address refuses rather than receiving a city where a street should be.
    address: "",
    linkedin: str("linkedin"), website: str("website"), coverNote: "",
    salaryExpectation: str("salary_expectation"), earliestStart: str("earliest_start"),
    workAuthorized: tri("work_authorized"),
    requiresSponsorship: tri("requires_sponsorship"),
    willingToRelocate: tri("willing_to_relocate"),
    shareDemographics: m["share_demographics"] === true,
    consentToProcessing: m["consent_to_processing"] === true,
  };
}

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
      blockers: [{ kind: "vendor-not-auto", detail: BLOCKED[src] ?? `${src} has no adapter — no recon has been done on it` }] });
    return `skipped ${src}`;
  }

  // Staged per packet rather than cached per user: a candidate may replace their
  // résumé mid-batch, and the file on disk must be the one their profile points
  // at right now, not the one it pointed at when the worker started.
  const staged = await stageResume(p.user_id);
  const answers = await loadAnswers(p.user_id);
  let outcome;
  try {
    outcome = await applyToPosting(browser, {
      applyUrl: p.apply_url, source: src, fields: toFieldKeys(p.fields ?? {}),
      resumePath: staged?.path, answers,
    });
  } finally {
    // Always clean up. A worker that runs for days would otherwise accumulate
    // every résumé it has ever touched in /tmp.
    if (staged) await rm(staged.dir, { recursive: true, force: true }).catch(() => {});
  }

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

  // Headless by default, because that is how this runs in production.
  //
  // HEADLESS=false opens a real window, and SLOW_MO puts a delay between actions
  // so a person can follow along. That combination exists for exactly one job:
  // the first watched submission on a new vendor, where someone needs to SEE
  // which field got filled, whether the résumé attached, and what the page said
  // after the click.
  //
  // Nothing about the run changes except visibility — same adapters, same
  // guards, same refusals. A test that takes a different code path than
  // production is not a test of production.
  const headless = process.env.HEADLESS !== "false";
  const slowMo = Number(process.env.SLOW_MO ?? 0);
  if (!headless) {
    console.log(`[worker] HEADED mode, slowMo=${slowMo}ms — a browser window will open`);
  }
  const browser = await chromium.launch({ headless, slowMo: slowMo > 0 ? slowMo : undefined });
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => { console.log(`[worker] ${sig} — finishing current packet`); stopping = true; });
  }

  while (!stopping) {
    // Check in BEFORE claiming, every loop including idle ones. An idle worker
    // is still a working worker, and if the heartbeat only landed on successful
    // claims then a healthy-but-idle sender would look dead and apply-agent
    // would stop releasing to it — the system would talk itself into an outage.
    await db.rpc("agent_worker_ping", { p_worker: WORKER_ID, p_version: WORKER_VERSION, p_claimed: 0 })
      .then(() => {}, (e: unknown) => console.warn("[worker] ping failed:", String(e).slice(0, 120)));

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
