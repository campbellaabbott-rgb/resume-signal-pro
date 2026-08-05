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
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learnedKey, type LearnedAnswers, type LearnedAnswer } from "./questions/learned.js";
import * as broker from "./broker.js";
import type { BlockedQuestion } from "./apply.js";
import { applyToPosting } from "./apply.js";
import { ADAPTERS, BLOCKED } from "./vendors/index.js";
import { refusalBlocker } from "./refusal.js";
import type { PacketFieldKey } from "./vendors/types.js";
import { normaliseLabel, type StandingAnswers } from "./questions/match.js";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${Math.random().toString(36).slice(2, 8)}`;
// Between applications. Not evasion — plain courtesy to an employer's server,
// and it keeps one candidate's batch from looking like a burst.
const GAP_MS = Number(process.env.APPLY_GAP_MS ?? 20_000);
const IDLE_MS = 30_000;
// Stop after this long with nothing to do. OPT-IN — unset means run forever,
// which is what someone watching a browser on their own laptop expects, and a
// default of "exit" would strand them.
//
// Set it on a metered host and the pair becomes scale-to-zero: apply-agent
// starts a machine when paid work appears, the machine drains the queue, and
// then it leaves. Nobody has bought yet, so today the right amount of worker to
// run is none, and this is what makes "none" the resting state rather than a
// bill.
const IDLE_EXIT_MS = Number(process.env.WORKER_IDLE_EXIT_MS ?? 0);
// Reported in the heartbeat so two overlapping versions during a redeploy can be
// told apart when one of them is the one misbehaving.
const WORKER_VERSION = "2026-07-31.2";
// Where an unresolved submit leaves its evidence, for the human who has to
// decide whether the application actually went out.
const SHOT_DIR = process.env.WORKER_SHOT_DIR ?? join(process.cwd(), "mac", "uncertain");

// The measured zero-CAPTCHA set. Duplicated here deliberately: the worker is the
// last gate before a real submission and must not depend on a database row being
// right about what it is allowed to touch.
// Derived from the adapters, never hand-listed. A vendor is servable only when
// someone has looked at its real form and written an adapter (worker/RECON.md).
// The old hand-maintained list included workday, which needs a per-tenant
// candidate account nobody has built, and four vendors that have had no recon —
// so it claimed capability the driver did not have.
const AUTO_VENDORS = new Set(Object.keys(ADAPTERS));

if (!process.env.APPLY_BROKER_URL || !process.env.APPLY_WORKER_SECRET) {
  console.error(
    [
      "[worker] APPLY_BROKER_URL and APPLY_WORKER_SECRET are required.",
      "  The worker no longer holds a service-role key — it cannot. The backend",
      "  is Lovable Cloud-managed and injects that key into edge functions at",
      "  runtime, where it is not retrievable. Every privileged operation goes",
      "  through the apply-broker edge function instead.",
    ].join("\n"),
  );
  process.exit(1);
}

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
async function stageResume(resumeUrl: string | null): Promise<{ path: string; dir: string } | null> {
  // The broker hands back a short-lived signed URL rather than a storage path,
  // because the worker no longer has credentials to read the private bucket —
  // which is the point. A plain fetch is all that is needed, and the URL is
  // useless to anyone who intercepts it minutes later.
  if (!resumeUrl) return null;
  try {
    const res = await fetch(resumeUrl);
    if (!res.ok) {
      // A résumé we cannot fetch BLOCKS the send. It never falls through to
      // submitting an application with no CV attached, which is worse than not
      // applying: it burns the posting and looks to the employer like
      // carelessness by the candidate.
      console.warn(`[worker] resume download failed: ${res.status}`);
      return null;
    }
    const dir = await mkdtemp(join(tmpdir(), "rb-resume-"));
    // Name it from the URL path so the employer sees a sensible filename, and
    // fall back rather than trusting a query string to be absent.
    const guessed = decodeURIComponent(new URL(resumeUrl).pathname.split("/").pop() || "");
    const name = /\.(pdf|docx?|rtf|odt)$/i.test(guessed) ? guessed : "resume.pdf";
    const path = join(dir, name);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    return { path, dir };
  } catch (e) {
    console.warn(`[worker] resume fetch threw: ${String(e).slice(0, 120)}`);
    return null;
  }
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
  [/post\s*code|zip\s*code|postal/i, "postcode"],
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
 * The packet fields that are QUESTION LABELS, not adapter fields.
 *
 * `toFieldKeys` above keeps the entries an adapter fills directly — name,
 * email, phone. Everything it drops is a label read off the employer's own
 * form, and for the draftable ones apply-agent has already written a grounded
 * answer. Until 2026-08-03 they were dropped here and nowhere else looked at
 * them, so the worker refused postings as "no standing answer covers ..." while
 * carrying the answer in memory. See PreparedAnswers in questions/match.ts.
 *
 * Only `source: "drafted"` is taken. A `standing`/`profile` entry is one the
 * StandingAnswers path already owns, and letting a packet copy shadow the live
 * profile would reintroduce the drift the standing rules exist to prevent. The
 * cover note is excluded because toStanding already places it.
 */
function toPrepared(
  raw: Record<string, { value: string; source: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [label, field] of Object.entries(raw ?? {})) {
    if (label === COVER_NOTE_FIELD_KEY) continue;
    if (field?.source !== "drafted") continue;
    const v = String(field.value ?? "").trim();
    if (v) out.set(normaliseLabel(label), v);
  }
  return out;
}



/**
 * Turn a refusal into a question the candidate can answer once.
 *
 * ONLY LEARNABLE REFUSALS. `learnable` is decided in questions/learned.ts and
 * carried on the blocked question itself, so this function cannot accidentally
 * offer up a date of birth or a referee's phone number as something to "fix".
 * Those are refused for what they are, not for being absent, and putting them
 * in front of someone with an input box is how a safeguard becomes a feature.
 *
 * FAILING HERE MUST NOT FAIL THE PACKET. The packet is already blocked and its
 * reason is already recorded; this is an additional courtesy on top. A write
 * that throws would turn "blocked, and here is the question" into an unhandled
 * error partway through releasing the claim.
 */
async function recordPending(
  p: Packet,
  outcome: { kind: string; blocked?: BlockedQuestion[] },
): Promise<void> {
  if (outcome.kind !== "not-submitted" || !outcome.blocked?.length) return;
  const askable = outcome.blocked.filter((b) => b.learnable && b.label.trim());
  if (!askable.length) return;

  // Upserted on (user_id, question_key) by the broker: the same question across
  // ten postings is ONE thing to ask, not ten. seen_count records the cost.

  const r = await broker.pending(p.user_id, askable.map((b) => ({
    question_key: learnedKey(b.label),
    question_label: b.label.slice(0, 400),
    answer_kind: b.kind,
    options: b.options,
    refusal_reason: b.why.slice(0, 300),
    posting_id: p.posting_id,
    company: p.company,
  })).filter((q) => q.question_key));
  if (!r.ok) {
    console.error(`[worker] could not record pending questions (${r.kind}): ${r.detail}`);
    return;
  }
  console.log(`[worker] ${askable.length} question(s) recorded for ${p.user_id} to answer once`);
}

/**
 * The broker returns exactly the shape the matcher wants, so this is a cast
 * with a guard rather than a transform. The one thing that must survive intact
 * is the TRINARIES: `null` means "the candidate never said", and coercing it to
 * false would have the agent tell an employer someone is NOT authorised to work
 * somewhere when they simply had not answered.
 */
/**
 * Reserved key in `packet.fields` carrying a note written for THIS posting.
 *
 * Mirrors COVER_NOTE_FIELD_KEY in supabase/functions/_shared/submission-packet.ts.
 * The two runtimes cannot import from each other — Deno on one side, Node on the
 * other — so this is a hand-copied constant, and the cross-runtime test pins the
 * pair. That is the same shape as every other duplicated definition here, and
 * the reason the test exists: a rename on one side alone is silent, and the
 * symptom would be the generic note going out forever.
 */
const COVER_NOTE_FIELD_KEY = "__coverNote";

function toStanding(
  a: broker.StandingAnswersWire,
  /**
   * The packet's fields. When apply-agent tailored a note for this posting it
   * rides here, already past the grounding gate, and it WINS over the standing
   * note — that is the whole point of having written it.
   *
   * Optional, and absent means "use what the candidate wrote". A packet
   * prepared before tailoring shipped, or one where the gate refused the draft,
   * carries no such field and behaves exactly as it always did.
   */
  fields?: Record<string, { value: string; source: string }>,
): StandingAnswers {
  const tri = (v: boolean | null | undefined) => (typeof v === "boolean" ? v : null);
  const tailored = (fields?.[COVER_NOTE_FIELD_KEY]?.value ?? "").trim();
  return {
    fullName: a.fullName ?? "", firstName: a.firstName ?? "", lastName: a.lastName ?? "",
    email: a.email ?? "", phone: a.phone ?? "", city: a.city ?? "", country: a.country ?? "",
    address: a.address ?? "", postcode: a.postcode ?? "",
    linkedin: a.linkedin ?? "", website: a.website ?? "",
    coverNote: tailored || (a.coverNote ?? ""), salaryExpectation: a.salaryExpectation ?? "",
    earliestStart: a.earliestStart ?? "",
    workAuthorized: tri(a.workAuthorized),
    requiresSponsorship: tri(a.requiresSponsorship),
    willingToRelocate: tri(a.willingToRelocate),
    workAuthorizedCountries: (a.workAuthorizedCountries ?? []).map((c) => String(c).toUpperCase()),
    // These two gate behaviour rather than answering a question, so an unstated
    // value is treated as "not granted" — the safe direction for both.
    shareDemographics: a.shareDemographics === true,
    consentToProcessing: a.consentToProcessing === true,
  };
}

function toLearned(rows: broker.ClaimedPacket["learned"]): LearnedAnswers {
  const m = new Map<string, LearnedAnswer>();
  for (const r of rows ?? []) {
    if (!r?.key) continue;
    m.set(r.key, { key: r.key, label: r.label ?? "", kind: r.kind, value: r.value ?? "" });
  }
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-employer pacing, on top of the global gap.
 *
 * APPLY_GAP_MS spaces out submissions overall, which protects the vendors. It
 * does not protect an EMPLOYER: a candidate whose queue holds eight roles at
 * one company would hit that company eight times in under three minutes, from
 * one IP, which is what a burst looks like from the receiving end regardless of
 * how legitimate each individual application is.
 *
 * The four vendors this drives have no bot wall. That is a courtesy to respect
 * rather than an absence to exploit — and the person who pays for being read as
 * a bot is the candidate whose name is on the applications.
 */
const EMPLOYER_GAP_MS = Number(process.env.APPLY_EMPLOYER_GAP_MS ?? 120_000);
const lastSentToEmployer = new Map<string, number>();

async function pauseForEmployer(company: string): Promise<void> {
  const key = company.trim().toLowerCase();
  if (!key) return;
  const last = lastSentToEmployer.get(key);
  if (last !== undefined) {
    const wait = EMPLOYER_GAP_MS - (Date.now() - last);
    if (wait > 0) {
      console.log(`[worker] pausing ${Math.round(wait / 1000)}s — already applied to ${company} this run`);
      await sleep(wait);
    }
  }
  // Stamped BEFORE the attempt, not after. Stamping on success would let a
  // string of failures against one employer retry with no gap at all, which is
  // the case where restraint matters most.
  lastSentToEmployer.set(key, Date.now());
}

async function release(id: number, patch: Record<string, unknown>) {
  // The broker clears the lease itself and, on status:'submitted', mirrors the
  // row into user_applications so the tracker the candidate reads and
  // agent_submissions can never disagree about what they applied to.
  const r = await broker.release(id, patch);
  if (!r.ok) console.error(`[worker] release ${id} failed (${r.kind}): ${r.detail}`);
  else if (patch.status === "submitted" && r.data.mirrored === false) {
    // Not fatal — the send IS recorded. But the tracker is what the person
    // paying actually looks at, and a missing row there reads as "the agent
    // did nothing", so it is worth saying out loud rather than swallowing.
    console.warn(`[worker] ${id} sent but the tracker mirror did not land`);
  }
}

async function runOne(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  claimed: broker.ClaimedPacket,
): Promise<string> {
  // Everything this needs arrives with the claim in one round trip: the packet,
  // the candidate's standing answers, what they have already taught the agent,
  // and a short-lived signed URL for the résumé. The worker used to make three
  // more privileged queries per packet; it now makes none.
  const p = claimed.packet as unknown as Packet;
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
  await pauseForEmployer(p.company);

  const staged = await stageResume(claimed.resumeUrl);
  const answers = toStanding(claimed.answers, claimed.packet?.fields);
  const learned = toLearned(claimed.learned);
  let outcome;
  try {
    outcome = await applyToPosting(browser, {
      learned,
      applyUrl: p.apply_url, source: src, fields: toFieldKeys(p.fields ?? {}),
      resumePath: staged?.path, answers,
      // The drafted answers apply-agent already wrote for this posting's real
      // questions. Dropped on the floor until 2026-08-03.
      prepared: toPrepared(p.fields ?? {}),
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
      // The evidence, not the claim. `sent_answers` is what actually went onto
      // the form — distinct from the packet's `answers`, which is what was
      // PREPARED, because a learned answer can resolve a question between
      // preparation and send and that difference should stay visible.
      // `sent_evidence` is the employer's own confirmation wording.
      sent_answers: outcome.answered ?? [],
      sent_evidence: outcome.evidence.slice(0, 500),
    });
    return `SENT ${p.company} — ${p.title}`;
  }

  if (outcome.kind === "uncertain") {
    // The screenshot was being discarded. It is the single most useful artefact
    // for the one outcome a human has to resolve by hand, and it costs a file
    // write to keep. Saved next to the worker rather than uploaded: it can show
    // a candidate's own details, so it stays on the machine the operator
    // already trusts with the service-role key instead of going to a bucket
    // with its own access rules.
    if (outcome.screenshot) {
      const shot = join(SHOT_DIR, `uncertain-${p.id}-${p.company.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)}.png`);
      await mkdir(SHOT_DIR, { recursive: true }).catch(() => {});
      await writeFile(shot, outcome.screenshot).then(
        () => console.log(`[worker] screenshot: ${shot}`),
        (e) => console.warn(`[worker] could not save screenshot: ${String(e).slice(0, 80)}`),
      );
    }
    // Never our call to resolve. The RPC parks it for a human AND pushes
    // attempts past the ceiling so nothing picks it up again.
    await broker.uncertain(p.id, outcome.reason);
    return `UNCERTAIN ${p.company} — ${outcome.reason}`;
  }

  // not-submitted: nothing was sent, so this is safely retryable within the
  // A refusal caused by questions is the moment to ASK. Recorded before the
  // release below, so a blocked packet and the question that blocked it land
  // together rather than the packet going quiet with the reason buried in a
  // log line nobody reads.
  await recordPending(p, outcome);

  // attempt ceiling. The reason is stored where the candidate can read it.
  //
  // AND, NOW, WHERE SOMETHING CAN COUNT IT. The sentence alone told a person
  // what happened to their packet and told nobody at all what is failing across
  // every packet — 19 of 60 fills refusing looks identical, from the database,
  // to 19 unrelated accidents. `refusalBlocker` adds a stage from a closed list
  // and the employer's own question label, on the same terms that make
  // agent_confirmation_gaps safe to read without a session. `kind` and `detail`
  // are untouched, so packetState and the candidate's own view do not move.
  await release(p.id, {
    status: "blocked",
    blockers: [refusalBlocker(outcome.reason, src, outcome.blocked)],
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
  // PRE-FLIGHT, before paying for a browser.
  //
  // Launching Chromium costs a second or two and a few hundred MB. On a laptop
  // woken by a timer every few minutes that is the entire cost of the system,
  // and it would be spent almost every time on finding nothing — there are no
  // subscribers yet, and even with some, the queue is empty most of the day.
  //
  // Only short-circuits when WORKER_IDLE_EXIT_MS says this is a scheduled,
  // exit-when-done run. A long-running worker still starts its browser and
  // polls, because that mode exists for watching a submission happen.
  // FIRST CLAIM BEFORE THE BROWSER. Chromium costs a second or two and a few
  // hundred megabytes, and on a timer-woken machine it would be spent almost
  // every time on finding nothing.
  //
  // This used to call a separate agent_work_pending() probe to decide. Claiming
  // is the same signal with one fewer round trip and no chance of the two
  // disagreeing — a probe that says "work waiting" and a claim that returns
  // nothing is a state the old shape could reach and this one cannot.
  //
  // A packet claimed here holds a 10-minute lease. If the browser then fails to
  // launch, the lease simply expires and another run picks it up: no worse than
  // a crash mid-application, which the lease already exists to cover.
  let firstClaim: broker.ClaimedPacket | null = null;
  {
    // HEARTBEAT BEFORE THE FIRST CLAIM, and this is not a duplicate of the one
    // in the loop below — it is the only one an IDLE run ever reaches.
    //
    // THE DEADLOCK IT BREAKS, measured 2026-08-03 on the first armed worker.
    // apply-agent releases nothing unless `agent_sender_online(900)` is true,
    // and that is fed only by this ping. The loop below pings on every pass
    // including idle ones — deliberately, and its comment says why. But the
    // fast-exit twenty lines down (`nothing to do — exiting without starting a
    // browser`) RETURNS BEFORE THE LOOP, so on an empty queue the worker
    // claimed, found nothing, and left without ever checking in.
    //
    // That is stable in the worst way: the worker only heartbeats once it
    // already has work, and it can only get work after a heartbeat. A fresh
    // install would sit at "nothing to do" every five minutes forever while
    // apply-agent logged "sender OFFLINE — preparing packets but releasing
    // none", each component behaving exactly as designed and the pair of them
    // doing nothing. The loop's own comment names the failure — "the system
    // would talk itself into an outage" — it just could not see this path,
    // because the fast-exit was added after it.
    //
    // Cost is one POST on an idle run, against a browser launch it is skipping.
    const hello = await broker.ping(WORKER_ID, WORKER_VERSION, 0);
    if (!hello.ok) console.warn(`[worker] heartbeat failed (${hello.kind}): ${hello.detail}`);

    const r = await broker.claim(WORKER_ID, WORKER_VERSION);
    if (!r.ok) {
      // Could not ASK is not the same as nothing to do. Exit non-zero so a
      // scheduled run shows red rather than quietly reporting an empty queue.
      console.error(`[worker] first claim failed (${r.kind}): ${r.detail}`);
      if (r.kind === "auth" || r.kind === "misconfigured") process.exit(2);
      process.exit(1);
    }
    firstClaim = r.data;
    if (!firstClaim && IDLE_EXIT_MS > 0) {
      console.log("[worker] nothing to do — exiting without starting a browser");
      return;
    }
  }

  const browser = await chromium.launch({ headless, slowMo: slowMo > 0 ? slowMo : undefined });
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => { console.log(`[worker] ${sig} — finishing current packet`); stopping = true; });
  }

  // Time of the last actual work, not of the last loop. A worker that polled
  // every 30s and reset this each time would never reach the exit threshold.
  let lastWorkAt = Date.now();
  // One definition of "long enough with nothing achieved", used by BOTH the
  // no-packet path and the claim-failed path.
  //
  // It lived only in the no-packet branch at first, so a claim that kept
  // ERRORING — a bad key, a permissions change, a database hiccup — never
  // reached it and the worker ran forever. Under a launchd schedule that is a
  // new Chromium every five minutes, none of them ever leaving. Found by
  // running it with a deliberately wrong key and watching it not stop.
  const idleTooLong = () => IDLE_EXIT_MS > 0 && Date.now() - lastWorkAt > IDLE_EXIT_MS;

  while (!stopping) {
    // Check in BEFORE claiming, every loop including idle ones. An idle worker
    // is still a working worker, and if the heartbeat only landed on successful
    // claims then a healthy-but-idle sender would look dead and apply-agent
    // would stop releasing to it — the system would talk itself into an outage.
    const pong = await broker.ping(WORKER_ID, WORKER_VERSION, 0);
    if (!pong.ok) console.warn(`[worker] ping failed (${pong.kind}): ${pong.detail}`);

    // The packet claimed before the browser launched is used on the first pass,
    // then normal claiming takes over. Without this it would sit leased and
    // unworked for ten minutes.
    let claimed: broker.ClaimedPacket | null = firstClaim;
    if (claimed) firstClaim = null;
    else {
      const r = await broker.claim(WORKER_ID, WORKER_VERSION);
      if (!r.ok) {
        console.error(`[worker] claim failed (${r.kind}): ${r.detail}`);
      // A claim that will not run is not work. Left out of this check, a
      // persistent failure keeps the process (and its browser) alive forever.
        if (idleTooLong()) {
          console.log(`[worker] ${Math.round((Date.now() - lastWorkAt) / 1000)}s without a successful claim — stopping`);
          break;
        }
        await sleep(IDLE_MS);
        continue;
      }
      claimed = r.data;
    }

    if (!claimed) {
      // Idle. Leave only if configured to, and only from HERE — the top of an
      // idle pass, with nothing claimed. Exiting mid-application would strand a
      // packet under a lease until it expired, and exiting right after a submit
      // would lose the confirmation check that decides whether it actually sent.
      if (idleTooLong()) {
        console.log(`[worker] idle ${Math.round((Date.now() - lastWorkAt) / 1000)}s — stopping (WORKER_IDLE_EXIT_MS=${IDLE_EXIT_MS})`);
        break;
      }
      await sleep(IDLE_MS);
      continue;
    }
    const p = claimed.packet as unknown as Packet;
    lastWorkAt = Date.now();

    console.log(`[worker] claimed #${p.id} ${p.source} ${p.company}`);
    try {
      console.log(`[worker] ${await runOne(browser, claimed)}`);
    } catch (e) {
      // A crash after clicking submit is the same ambiguity as a timeout, and
      // gets the same treatment: parked, never retried.
      console.error(`[worker] #${p.id} threw:`, String(e).slice(0, 200));
      await broker.uncertain(p.id, `worker crashed: ${String(e).slice(0, 140)}`);
    }
    await sleep(GAP_MS);
  }

  await browser.close();
  console.log("[worker] stopped");
}

main().catch((e) => { console.error("[worker] fatal:", e); process.exit(1); });
