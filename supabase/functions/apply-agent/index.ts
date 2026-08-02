// The orchestrator: queue row in, submission packet out.
//
// agent-runner decides WHAT to apply to and fills agent_queue. This function
// decides HOW FAR each of those can be taken, and — in auto mode — whether it
// goes out. It is the only place the two halves meet.
//
// Per queue row: dedupe, fetch the employer's real questions where the vendor
// publishes them, draft answers grounded strictly in the résumé, assemble the
// field map, and write a packet. buildPacket decides what can be filled and what
// must block; decideRelease decides whether a ready packet is actually sent. Both
// are pure and tested separately — this file is the plumbing around them, and it
// deliberately contains no judgement of its own.
//
// WHAT IT WILL NEVER DO: submit. No vendor exposes a public submit endpoint
// (measured 2026-07-29: Greenhouse 401, Lever 404, Ashby 401 — all gated behind
// the EMPLOYER's credentials), so submission means driving the real form in the
// candidate's own browser session. This function marks a packet released; the
// hands report back and stamp submitted_at, which a database trigger refuses to
// accept without a source.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { wakeSender } from "../_shared/wake-sender.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPacket, type PacketQuestion, type Profile, type StandingAnswers } from "../_shared/submission-packet.ts";
import { decideRelease } from "../_shared/apply-release.ts";
import { automationFor } from "../_shared/apply-automation.ts";
import { ENTITLEMENT_COLUMNS, normalizeEmail, rowIsEntitled } from "../_shared/agent-entitlement.ts";
import { nextRunStamp } from "../_shared/run-stamp.ts";

// Bumped whenever this function's behaviour changes. It rides along in the run
// stamp so "the new code has not deployed yet" and "the code deployed but has
// never run" are different observations rather than the same silence.
const BUILD_VERSION = "2026-08-02.2";

// Wall clock, not a row count. Question fetches and answer drafting are both
// network-bound and wildly variable, so a fixed "20 packets" budget either wastes
// the invocation or gets killed mid-write. Stopping on time and self-chaining is
// the pattern the dating sweep needed after it spun forever on a row count.
const SOFT_DEADLINE_MS = 100_000;
const MANDATES_PER_RUN = 50;
const PACKETS_PER_MANDATE = 10;
const MIN_FIT_PCT = 55; // floor for unattended sending; review mode ignores it

const t = (v: unknown): string => String(v ?? "").trim();

interface MandateRow {
  user_id: string; email: string; resume_text: string;
  full_name: string; phone: string; linkedin: string; website: string;
  city: string; country: string; resume_file_url: string;
  work_authorized: boolean | null; requires_sponsorship: boolean | null;
  willing_to_relocate: boolean | null; salary_expectation: string; earliest_start: string;
  share_demographics: boolean; apply_mode: "review" | "auto";
  auto_apply_daily_cap: number; auto_apply_sources: string[];
  cover_note: string; tailor_cover_note: boolean;
}
interface QueueRow {
  id: number; user_id: string; posting_id: string; title: string; company: string;
  company_token: string; apply_url: string; fit_pct: number | null; status: string;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Maintenance-gated. This function reads every mandate on the platform and can
  // release applications; it is never reachable from a browser.
  const key = req.headers.get("x-maintenance-key") ?? "";
  const expected = Deno.env.get("MAINTENANCE_KEY") ?? "";
  if (!expected || key !== expected) {
    // THE REFUSAL CARRIES THE BUILD VERSION. Nothing else about the function,
    // and certainly nothing about the key — just which bundle is deployed.
    //
    // WHY: on 2026-08-02 job-board's new bundle went live and the run stamp
    // stayed empty through two cron firings. That has exactly two causes — the
    // vault key is missing, or apply-agent did not redeploy alongside job-board
    // — and there was NO WAY to tell them apart without the maintenance key,
    // because every observable this function offers was behind that key. So the
    // one question you most need answered when the agent is silent was the one
    // question you needed a credential to ask.
    //
    // A version string is not a secret. job-board has published its own for
    // months and it is the reason "did the deploy land?" is answerable there.
    // With this, `version` here plus `status.applyAgent` there separate the two
    // causes completely, from a terminal, with nothing but curl:
    //
    //   version current + no stamp after a firing -> THE VAULT KEY IS MISSING
    //   version stale                             -> apply-agent did not deploy
    //
    // It does NOT reveal whether the key is set, and knowing the build date
    // buys an attacker nothing they could not learn from the public repo.
    return new Response(JSON.stringify({
      error: "apply-agent is a maintenance action",
      version: BUILD_VERSION,
    }), {
      status: 403, headers: { "content-type": "application/json" },
    });
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  // Make sure the résumé bucket exists, and say so out loud on every run.
  //
  // The bucket DOES exist in production today — verified with a write probe,
  // which is the only probe that distinguishes a missing bucket ("Bucket not
  // found") from an existing one that refuses you ("violates row-level security
  // policy"). Listing objects cannot tell those apart; it returns [] for both.
  //
  // This is kept anyway, for two reasons that are not hypothetical here:
  //
  //  1. The deploy path strips INSERT INTO storage.buckets from migrations —
  //     20260730040000 declared the bucket and four policies, and the emitted
  //     20260730202622 kept the policies and dropped the bucket. So SQL cannot
  //     be trusted to reconstruct this bucket in a new environment, and the
  //     storage API can.
  //  2. A missing bucket is a nearly silent failure: the policies still exist,
  //     everything looks configured, and the only symptom is that every résumé
  //     upload dies at the last step. Reporting the state on every run is what
  //     turns that into something noticeable.
  //
  // Idempotent — an existing bucket returns a duplicate error, which is success.
  async function ensureResumeBucket(): Promise<string> {
    const { error } = await client.storage.createBucket("resumes", {
      public: false, // a résumé is an address, a phone number and a work history
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ],
    });
    if (!error) return "created";
    const msg = String(error.message ?? "");
    if (/already exists|duplicate/i.test(msg)) return "already present";
    return `FAILED: ${msg}`;
  }

  // Runnable on its own so the bucket can be fixed without releasing anything.
  let body: { action?: string; source?: string } = {};
  try { body = await req.json(); } catch { /* no body is the normal run */ }

  // WHO ASKED. The hourly cron sends {"source":"cron"}; anything else is a hand
  // invocation. Keeping them apart is the entire point of the stamp below: a
  // manual run proves the FUNCTION works, and proves nothing whatsoever about
  // whether the schedule fires. Those were indistinguishable before, and the
  // difference is exactly the open question — the cron's WHERE clause is gated
  // on a vault secret, so with no key it fires NOTHING, silently and by design.
  const trigger = body.source === "cron" ? "cron" : "manual";
  if (body.action === "ensure-storage") {
    return new Response(JSON.stringify({ resumesBucket: await ensureResumeBucket() }), {
      headers: { "content-type": "application/json" },
    });
  }
  const bucketState = await ensureResumeBucket();

  // Is there a worker alive to actually send? Read ONCE per run rather than per
  // packet — it is the same answer for every packet in a run, and asking per row
  // would add a round trip to each one.
  //
  // FAILS CLOSED. If the check itself errors we treat the sender as offline,
  // because the alternative is releasing applications in a real person's name on
  // the strength of a query that did not answer.
  const { data: onlineRow, error: onlineErr } = await client.rpc("agent_sender_online", {
    p_max_age_seconds: 900,
  });
  const senderOnline = !onlineErr && onlineRow === true;
  let wake: unknown = null;
  if (!senderOnline) {
    console.warn(`[APPLY-AGENT] sender OFFLINE (${onlineErr?.message ?? "no recent heartbeat"}) — preparing packets but releasing none`);

    // Ask for a sender to be started — but only if there is genuinely paid work
    // waiting. Both halves of that matter: a subscriber with an empty queue and
    // a full queue with no subscriber should each start nothing, and only
    // agent_work_pending() knows both at once.
    //
    // With WORKER_START_URL unset — the state today, since no worker exists
    // anywhere — this is a no-op and everything below runs exactly as before.
    // Packets prepared on this pass simply wait, which is the design: they
    // drain whenever a sender next appears, so nothing is lost by not having
    // one, and nothing needs to run while nobody has bought.
    try {
      const { data: pend } = await client.rpc("agent_work_pending");
      const p = (pend ?? {}) as { should_run?: boolean; pending?: number };
      wake = await wakeSender(p.should_run === true);
      if (p.should_run) {
        console.warn(`[APPLY-AGENT] ${p.pending} packet(s) waiting on a sender — wake: ${JSON.stringify(wake)}`);
      }
    } catch (e) {
      // Never fatal. A failed wake leaves packets waiting, the same safe state
      // as before this existed. Letting it throw would stop packets being
      // PREPARED, which is strictly worse than them being prepared and queued.
      wake = { attempted: true, ok: false, error: String(e).slice(0, 120) };
      console.warn(`[APPLY-AGENT] wake check failed: ${String(e).slice(0, 120)}`);
    }
  }

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > SOFT_DEADLINE_MS;

  const summary = {
    mandates: 0, prepared: 0, ready: 0, blocked: 0, released: 0,
    skippedDuplicate: 0, failed: 0, refusals: {} as Record<string, number>,
    stoppedEarly: false,
    // Both, not just the successes. A tailoring feature that is switched on and
    // silently rejects every draft looks identical to one nobody enabled, and
    // the only visible symptom would be an absence of tailored notes — which is
    // exactly what the fallback is designed to look like.
    coverNotesTailored: 0, coverNotesRejected: 0,
  };

  const { data: mandates } = await client
    .from("agent_mandates")
    .select("user_id,email,resume_text,full_name,phone,linkedin,website,city,country," +
      "resume_file_url,work_authorized,requires_sponsorship,willing_to_relocate," +
      "salary_expectation,earliest_start,share_demographics,apply_mode," +
      "auto_apply_daily_cap,auto_apply_sources,cover_note,tailor_cover_note")
    .eq("active", true)
    .limit(MANDATES_PER_RUN);

  for (const m of ((mandates ?? []) as unknown as MandateRow[])) {
    if (outOfTime()) { summary.stoppedEarly = true; break; }
    summary.mandates++;

    // Entitlement is checked per mandate, not once per run: a lapsed subscriber
    // must stop being applied for the same day their subscription ends.
    //
    // This once selected only `email` and tested that the row existed, which is
    // not the same question. agent-access is unauthenticated and used to upsert
    // a row for any address posted to it, so "a row exists" was true for
    // essentially everyone — and this function is the one that PREPARES
    // APPLICATIONS TO EMPLOYERS. rowIsEntitled reads status and period end, and
    // is the single definition all four consumers now share.
    const { data: sub } = await client
      .from("agent_subscribers").select(ENTITLEMENT_COLUMNS)
      .eq("email", normalizeEmail(m.email)).maybeSingle();
    if (!rowIsEntitled(sub)) continue;

    // In auto mode the agent works its own picks; in review mode it only
    // prepares what the candidate approved. The queue is the same table either
    // way — the mode decides which rows are its business.
    const wanted = m.apply_mode === "auto" ? ["ready", "approved"] : ["approved"];
    const { data: rows } = await client
      .from("agent_queue")
      .select("id,user_id,posting_id,title,company,company_token,apply_url,fit_pct,status")
      .eq("user_id", m.user_id).in("status", wanted)
      .order("created_at", { ascending: false })
      .limit(PACKETS_PER_MANDATE);
    if (!rows?.length) continue;

    // Read the day's sends ONCE and count locally as we release. Re-reading per
    // row would be correct but slower; recomputing from a stale read would let a
    // cap of 5 send 30, which is exactly the bug decideBatch exists to prevent.
    const { data: sentRow } = await client.rpc("agent_sent_today", { p_user: m.user_id });
    let sentToday = Number(sentRow ?? 0);

    const profile: Profile = {
      fullName: m.full_name, email: m.email, phone: m.phone, linkedin: m.linkedin,
      website: m.website, city: m.city, country: m.country, resumeFileUrl: m.resume_file_url,
    };
    const standing: StandingAnswers = {
      workAuthorized: m.work_authorized, requiresSponsorship: m.requires_sponsorship,
      willingToRelocate: m.willing_to_relocate, salaryExpectation: m.salary_expectation,
      earliestStart: m.earliest_start, shareDemographics: m.share_demographics,
    };

    for (const q of (rows as unknown as QueueRow[])) {
      if (outOfTime()) { summary.stoppedEarly = true; break; }

      // A packet already exists for this posting. The unique index would reject
      // the insert anyway; checking first keeps us from spending an LLM call to
      // rediscover that.
      const { data: existing } = await client
        .from("agent_submissions").select("id,status")
        .eq("user_id", m.user_id).eq("posting_id", q.posting_id).maybeSingle();
      if (existing) { summary.skippedDuplicate++; continue; }

      // ...and the candidate may have applied by hand. The tracker is the record
      // of what a HUMAN did; agent_submissions only knows what the agent did.
      //
      // The table is `user_applications` and the board reference is `job_id`.
      // My first draft queried job_applications.posting_id — a table that does
      // not exist and a column that does not exist on the one that does
      // (verified against production: 42703). Neither would have thrown: the
      // client returns an error OBJECT, `tracked` would be falsy forever, and
      // this guard would have been dead code that always answered "no, they have
      // not applied". A silent always-false duplicate check on the one path that
      // sends real applications is the worst possible way for that mistake to
      // fail, because nothing would look broken.
      const { data: tracked, error: trackErr } = await client
        .from("user_applications").select("id")
        .eq("user_id", m.user_id).eq("job_id", q.posting_id).maybeSingle();
      if (trackErr) {
        // Fail CLOSED. If the duplicate check itself is broken we do not get to
        // assume the answer is "no" — that assumption is how someone applies to
        // the same employer twice under an agent's name.
        summary.failed++;
        console.error(`[APPLY-AGENT] duplicate check failed for ${q.posting_id}: ${trackErr.message}`);
        continue;
      }
      const duplicate = !!tracked;

      const source = String(q.posting_id.split(":")[0] ?? "").toLowerCase();
      const auto = automationFor(source);

      try {
        // Real questions where the vendor publishes them; inferred (and labelled
        // as inferred) everywhere else. questionsAreReal travels with the packet
        // so no surface can present a guess as the employer's actual form.
        let questions: PacketQuestion[] = [];
        let real = false;
        if (auto.realQuestions) {
          const { data: qr } = await client.functions.invoke("job-board", {
            body: { action: "application-questions", id: q.posting_id },
          });
          const list = (qr as { questions?: Array<{ label: string; required?: boolean; type?: string }> })?.questions;
          if (Array.isArray(list) && list.length) {
            questions = list.map((x) => ({ label: x.label, required: x.required, fieldType: x.type, real: true }));
            real = true;
          }
        }
        if (!questions.length) {
          // The floor every ATS form asks for. Deliberately minimal: inventing a
          // long inferred form would produce blockers for questions that may not
          // exist, and strand packets that could have gone out.
          questions = [
            { label: "Full name", required: true },
            { label: "Email", required: true },
            { label: "Phone", required: false },
            { label: "Resume", required: true, fieldType: "file" },
          ];
        }

        // Draft only the questions that need drafting — the classifier already
        // knows identity/file/demographic/factual are not the LLM's business.
        let drafted: Array<{ label: string; answer: string; supported: boolean; note?: string }> = [];
        const needsDraft = questions.filter((x) => (x.label ?? "").length > 24);
        if (needsDraft.length && m.resume_text) {
          const { data: ans } = await client.functions.invoke("generate-application-answers", {
            body: {
              resumeText: m.resume_text, jobTitle: q.title, jobCompany: q.company,
              questions: needsDraft.map((x) => ({ label: x.label, required: x.required })),
            },
          });
          const list = (ans as { answers?: typeof drafted })?.answers;
          if (Array.isArray(list)) drafted = list;
        }

        // ── the cover note ───────────────────────────────────────────────────
        // Opt-in, and the default is off. The candidate wrote `cover_note`
        // expecting it to be sent as they wrote it; quietly substituting a
        // model's prose for their own words would be a trust violation whatever
        // the prose was like. So `tailor_cover_note` gates this, and when it is
        // off nothing about the old behaviour changes.
        //
        // FAILURE IS A FEATURE HERE. Anything that goes wrong — no résumé text,
        // no description to tailor against, a rejected draft, a 502, a timeout —
        // falls through to the candidate's own note. A generic note is a fine
        // outcome. A false one is not, and a BLOCKED application would be worse
        // than either, so this can never add a blocker.
        let coverNote: { value: string; tailored: boolean } | undefined =
          t(m.cover_note) ? { value: t(m.cover_note), tailored: false } : undefined;

        if (m.tailor_cover_note && m.resume_text && !outOfTime()) {
          try {
            // The posting text is what makes a tailored note worth having, and
            // it doubles as the gate's supporting context: a figure the employer
            // published is legitimate to quote back at them.
            const { data: det } = await client.functions.invoke("job-board", {
              body: { action: "detail", id: q.posting_id },
            });
            const jobDescription = String((det as { description?: string })?.description ?? "");

            const { data: cn } = await client.functions.invoke("generate-application-answers", {
              body: {
                mode: "cover-note",
                resumeText: m.resume_text,
                jobTitle: q.title, jobCompany: q.company, jobDescription,
                baseNote: t(m.cover_note), candidateName: m.full_name,
              },
            });
            const note = (cn as { note?: string | null })?.note;
            if (typeof note === "string" && note.trim()) {
              coverNote = { value: note.trim(), tailored: true };
              summary.coverNotesTailored++;
            } else {
              // The gate refused it twice. Recorded, because "the feature is on
              // and nothing is ever tailored" must be answerable from the run
              // summary rather than from guesswork.
              summary.coverNotesRejected++;
            }
          } catch (e) {
            summary.coverNotesRejected++;
            console.error(`[APPLY-AGENT] cover note failed for ${q.posting_id}: ${String(e).slice(0, 120)}`);
          }
        }

        const packet = buildPacket({
          questions, profile, standing, drafted, automationTier: auto.tier, coverNote,
        });

        const decision = decideRelease({
          applyMode: m.apply_mode,
          packetReady: packet.ready,
          blockerCount: packet.blockers.length,
          source,
          allowedSources: m.auto_apply_sources ?? [],
          sentToday,
          dailyCap: m.auto_apply_daily_cap,
          alreadySubmitted: false,
          fitPct: q.fit_pct,
          minFitPct: MIN_FIT_PCT,
          duplicate,
          senderOnline,
        });
        if (!decision.release) {
          summary.refusals[decision.code] = (summary.refusals[decision.code] ?? 0) + 1;
        }

        // `released` is NOT `submitted`. It means the hands may pick this up. The
        // send itself is stamped by the extension reporting back, and the trigger
        // on agent_submissions refuses `submitted` without a timestamp AND a
        // source — so nothing here can assert an application was sent.
        const status = duplicate ? "stale" : packet.ready ? "ready" : "blocked";
        const { error } = await client.from("agent_submissions").insert({
          user_id: m.user_id, posting_id: q.posting_id, title: q.title,
          company: q.company, company_token: q.company_token, apply_url: q.apply_url,
          source, status,
          fields: Object.fromEntries(packet.fields.map((f) => [f.key, { value: f.value, source: f.source }])),
          questions, questions_are_real: real,
          answers: drafted, blockers: packet.blockers,
          fit_pct: q.fit_pct, prepared_at: new Date().toISOString(),
          // PERSIST THE RELEASE DECISION. It used to exist only as a counter in
          // the run summary and a log line, which meant the worker had no way to
          // tell "prepared, awaiting review" from "prepared, approved, send it".
          // released_at is the flag the worker gates on; the refusal code is
          // stored so "why did nothing go out last night" is answerable from the
          // row rather than from logs nobody reads.
          released_at: decision.release ? new Date().toISOString() : null,
          release_refusal: decision.release ? "" : decision.code,
        });
        if (error) { summary.failed++; continue; }

        summary.prepared++;
        if (status === "ready") summary.ready++;
        if (status === "blocked") summary.blocked++;
        if (decision.release) { summary.released++; sentToday++; }
      } catch (e) {
        // One posting failing must never stop a candidate's whole batch.
        summary.failed++;
        console.error(`[APPLY-AGENT] ${q.posting_id}: ${String(e).slice(0, 140)}`);
      }
    }
  }

  // Reported on every run, not just the standalone action. A missing bucket
  // blocks essentially every application at the résumé step, and that is far
  // too quiet a failure to leave out of the summary.
  // senderOnline is in the summary because "0 released" has two very different
  // meanings — nothing qualified, or nothing could be sent at all — and a run
  // report that cannot tell them apart is the same trap as a silent refusal.
  console.log(`[APPLY-AGENT] senderOnline=${senderOnline} wake=${JSON.stringify(wake)} resumesBucket=${bucketState} ${JSON.stringify(summary)}`);

  // THE RUN STAMP. Makes "has the apply agent ever actually run?" answerable
  // from outside, with no database access, no dashboard and no service key —
  // job-board's `status` action reads this row and is anon-readable.
  //
  // WHY IT WAS NEEDED. apply-agent is scheduled hourly at :23, but the cron
  // body is wrapped in `WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets
  // WHERE name = 'apply_agent_maintenance_key')`. With no key that fires
  // NOTHING — deliberately, so a missing key does not mean 24 failed POSTs a
  // day. The cost of that good decision is that "armed and working" and "never
  // armed at all" produce byte-identical evidence from outside: no packets, no
  // errors, no logs. Nobody can tell you which one you are in, and the only
  // people who could are the ones with dashboard access.
  //
  // lastCronAt is carried forward across manual runs on purpose. A hand
  // invocation must never be able to make the schedule look alive — that would
  // be a probe that answers the question you meant to ask with the answer to an
  // easier one, which is the whole failure this exists to end.
  try {
    const { data: prevRow } = await client
      .from("job_board_meta").select("v").eq("k", "apply_agent_run").maybeSingle();
    const now = new Date().toISOString();
    await client.from("job_board_meta").upsert({
      k: "apply_agent_run",
      v: nextRunStamp(prevRow?.v, {
        trigger, now, buildVersion: BUILD_VERSION, senderOnline,
        resumesBucket: bucketState,
        mandates: summary.mandates,
        prepared: summary.prepared,
        released: summary.released,
        ms: Date.now() - startedAt,
      }),
      updated_at: now,
    });
  } catch (e) {
    // Never let observability failure break a run that otherwise worked.
    console.error(`[APPLY-AGENT] run stamp failed: ${String(e).slice(0, 140)}`);
  }
  // `wake` rides along for the same reason senderOnline does: "0 released" has
  // several very different causes, and a run that asked for a sender and was
  // refused looks identical to one that never asked unless it is recorded.
  return new Response(JSON.stringify({ ...summary, senderOnline, wake, resumesBucket: bucketState, ms: Date.now() - startedAt }), {
    headers: { "content-type": "application/json" },
  });
});
