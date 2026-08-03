// The broker: the worker's four privileged operations, and nothing else.
//
// WHY IT EXISTS: the worker drives real application forms with Playwright, so it
// has to run somewhere with a browser — outside this runtime. It used to do that
// holding a service_role key, which is a key to the entire database sitting on a
// laptop. This function is the whole of what it actually needed that key FOR:
// claim a packet, release the outcome, record a question it could not answer,
// and say it is alive. Four operations. Nothing derived from the service key —
// no key, no token, no admin URL — is ever put in a response.
//
// AUTH: one shared secret, APPLY_WORKER_SECRET, compared in constant time.
//   401  -> the caller is not the worker
//   200 {"packet": null} -> the caller IS the worker and there is no work
// Those are different situations and they get different responses, deliberately.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ENTITLEMENT_COLUMNS, normalizeEmail, rowIsEntitled } from "../_shared/agent-entitlement.ts";

const BUILD_VERSION = "2026-08-03.7";
const LEASE_MINUTES = 10;
const RESUME_URL_TTL_SECONDS = 300; // 5 minutes; the worker downloads and deletes

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Constant-time string equality. Length is compared first and the loop still
 *  runs over a fixed width, so neither length nor prefix leaks through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const width = Math.max(x.length, y.length, 32);
  let diff = x.length ^ y.length;
  for (let i = 0; i < width; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/** null stays null. A candidate who never said whether they need sponsorship has
 *  not said "no" — coercing that to false is the agent telling an employer
 *  something about a real person that the person never told us. */
const trinary = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : Boolean(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("APPLY_WORKER_SECRET") ?? "";
  if (!expected) {
    console.error("[APPLY-BROKER] APPLY_WORKER_SECRET is not configured");
    return json({ error: "broker not configured" }, 503);
  }
  const presented = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(presented, expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body -> invalid action below */ }
  const action = str(body.action);

  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    if (action === "ping") {
      const { error } = await client.rpc("agent_worker_ping", {
        p_worker: str(body.worker_id) || "unknown",
        p_version: str(body.version),
        p_claimed: Number(body.claimed ?? 0) || 0,
      });
      if (error) return json({ error: error.message }, 500);
      // An idle worker is still an online worker — the pricing card's auto-apply
      // claim is true because something is alive to send, not because it is busy.
      return json({ ok: true, build: BUILD_VERSION });
    }

    if (action === "claim") {
      const worker = str(body.worker_id) || "unknown";
      // Heartbeat on claim too: a worker that is polling is a worker that is up.
      await client.rpc("agent_worker_ping", {
        p_worker: worker, p_version: str(body.version), p_claimed: 0,
      });

      // Claim, then check entitlement. The claim itself must stay atomic (the
      // UPDATE ... WHERE claimed_at IS NULL is the only thing stopping two
      // workers sending one application twice), so an unpaid user's packet is
      // claimed and immediately handed back rather than filtered beforehand.
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await client.rpc("agent_claim_submission", {
          p_worker: worker, p_lease_minutes: LEASE_MINUTES,
        });
        if (error) return json({ error: error.message }, 500);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return json({ packet: null });

        // NARROWED, because `deno check` types a maybeSingle() result as the
        // row OR GenericStringError and refuses every field access on the union
        // — the function ran fine in production while the repo's mandatory
        // edge-function gate went red. A gate that stays red gets ignored, and
        // then it is protecting nothing at all.
        //
        // A cast rather than a guard on purpose: every read below already goes
        // through str()/trinary(), which return "" and null for anything that
        // is not the expected type. The narrowing changes no behaviour; it just
        // lets the checker see what those helpers already handle.
        const { data: mandateRow } = await client
          .from("agent_mandates")
          .select("email,full_name,phone,linkedin,website,city,country,address,postcode," +
            "resume_file_url,work_authorized,requires_sponsorship,willing_to_relocate," +
            "work_authorized_countries,salary_expectation,earliest_start,cover_note," +
            "share_demographics,consent_to_processing,active")
          .eq("user_id", row.user_id).maybeSingle();
        const mandate = mandateRow as Record<string, unknown> | null;

        const unclaim = async () => {
          await client.from("agent_submissions")
            .update({ claimed_at: null, claimed_by: "" }).eq("id", row.id);
        };

        if (!mandate) { await unclaim(); continue; }

        /**
         * THE STOP BUTTON, ENFORCED WHERE STOPPING ACTUALLY HAPPENS.
         *
         * `active` is what the candidate toggles when they turn the agent off.
         * apply-agent has always honoured it — `.eq("active", true)` — so
         * switching off correctly stops NEW packets being prepared.
         *
         * It did not stop anything already prepared. Packets released before
         * the switch stayed claimable, and this function handed them to a
         * worker that typed them into an employer's form. Someone who turned
         * the agent off because they had accepted a job, or changed their mind
         * about a company, would have watched applications keep going out with
         * no way to intervene — and the queue drains over hours, so "off" would
         * have meant "off eventually".
         *
         * The comment directly below has said for months that this is the LAST
         * gate before a packet reaches a form. Entitlement was checked here for
         * exactly that reason. The candidate's own instruction to stop deserves
         * at least the same standing as their subscription status.
         *
         * Fails closed: a mandate whose `active` is null or missing does not
         * send. Off is the safe direction for a control whose whole purpose is
         * to make something stop.
         */
        if (mandate.active !== true) { await unclaim(); continue; }

        // Entitlement, checked at claim time rather than at prepare time: a
        // lapsed subscriber must stop being applied for the day they lapse.
        //
        // Checked status, not merely row existence — see the note in
        // _shared/agent-entitlement.ts. This is the LAST gate before a packet
        // is handed to a worker that will type it into an employer's form, so
        // it is the worst possible place to ask an easier question than the one
        // that was intended.
        const { data: sub } = await client
          .from("agent_subscribers").select(ENTITLEMENT_COLUMNS)
          .eq("email", normalizeEmail(mandate.email)).maybeSingle();
        if (!rowIsEntitled(sub)) { await unclaim(); continue; }

        const { data: learnedRows } = await client
          .from("agent_learned_answers")
          .select("question_key,question_label,answer_kind,answer_value")
          .eq("user_id", row.user_id);

        // A signed URL into the PRIVATE bucket, valid for five minutes. Never a
        // public URL: a résumé is an address, a phone number and a work history.
        let resumeUrl: string | null = null;
        const path = str(mandate.resume_file_url);
        if (path) {
          const { data: signed, error: signErr } = await client.storage
            .from("resumes").createSignedUrl(path, RESUME_URL_TTL_SECONDS);
          if (signErr) console.warn(`[APPLY-BROKER] sign failed for ${row.id}: ${signErr.message}`);
          resumeUrl = signed?.signedUrl ?? null;
        }

        const full = str(mandate.full_name).trim();
        const parts = full.split(/\s+/).filter(Boolean);

        return json({
          packet: {
            id: row.id,
            user_id: row.user_id,
            posting_id: row.posting_id,
            title: row.title,
            company: row.company,
            company_token: row.company_token,
            apply_url: row.apply_url,
            source: row.source,
            fields: row.fields ?? {},
          },
          answers: {
            fullName: full,
            firstName: parts[0] ?? "",
            lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
            email: str(mandate.email),
            phone: str(mandate.phone),
            city: str(mandate.city),
            country: str(mandate.country),
            address: str(mandate.address),
            postcode: str(mandate.postcode),
            linkedin: str(mandate.linkedin),
            website: str(mandate.website),
            coverNote: str(mandate.cover_note),
            salaryExpectation: str(mandate.salary_expectation),
            earliestStart: str(mandate.earliest_start),
            // TRINARY — null means "not stated" and must survive as null.
            workAuthorized: trinary(mandate.work_authorized),
            requiresSponsorship: trinary(mandate.requires_sponsorship),
            willingToRelocate: trinary(mandate.willing_to_relocate),
            workAuthorizedCountries: Array.isArray(mandate.work_authorized_countries)
              ? mandate.work_authorized_countries : [],
            shareDemographics: trinary(mandate.share_demographics),
            consentToProcessing: trinary(mandate.consent_to_processing),
          },
          learned: (learnedRows ?? []).map((l: Record<string, unknown>) => ({
            key: l.question_key, label: l.question_label,
            kind: l.answer_kind, value: l.answer_value,
          })),
          resumeUrl,
        });
      }
      // Five claims in a row belonged to nobody entitled — treat as no work.
      return json({ packet: null });
    }

    if (action === "release") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return json({ error: "id required" }, 400);
      const patch = (body.patch ?? {}) as Record<string, unknown>;

      // Allow-list. The worker writes outcomes, not arbitrary columns — it can
      // never set released_at, fit_pct, or anyone else's user_id.
      const update: Record<string, unknown> = { claimed_at: null, claimed_by: "" };
      for (const key of ["status", "submitted_at", "submitted_via", "error",
        "blockers", "attempts", "sent_answers", "sent_evidence"]) {
        if (patch[key] !== undefined) update[key] = patch[key];
      }

      // The trigger on agent_submissions refuses `submitted` without both a
      // timestamp and a source. Left in place on purpose: it is the reason a
      // send that did not happen cannot be recorded as one.
      const { error } = await client.from("agent_submissions").update(update).eq("id", id);
      if (error) return json({ error: error.message }, 400);

      // THE TRACKER MIRROR. A confirmed send must also appear in the tracker the
      // candidate reads, or a real application looks to them like the agent did
      // nothing. Done here, inside the same call that records the send, so the
      // worker cannot crash between the two writes and half-do it.
      let mirrored = false;
      if (str(update.status) === "submitted") {
        const { data: row } = await client.from("agent_submissions")
          .select("user_id,company,title,posting_id,apply_url,submitted_at")
          .eq("id", id).maybeSingle();
        if (row?.user_id) {
          // Idempotent: a retried release must not add a second tracker entry.
          const { data: existing } = await client.from("user_applications")
            .select("id").eq("user_id", row.user_id)
            .eq("job_id", str(row.posting_id)).limit(1).maybeSingle();
          if (!existing) {
            const { error: mirrorErr } = await client.from("user_applications").insert({
              user_id: row.user_id,
              company: str(row.company) || "Unknown",
              role: str(row.title) || "Unknown",
              status: "applied",
              job_id: str(row.posting_id) || null,
              apply_url: str(row.apply_url) || null,
            });
            if (mirrorErr) {
              // The send is already recorded and must not be rolled back — a
              // failed mirror is a visibility bug, not a lost application.
              console.error(`[APPLY-BROKER] mirror failed for ${id}: ${mirrorErr.message}`);
            } else mirrored = true;
          }
        }
      }
      return json({ ok: true, mirrored });
    }

    if (action === "uncertain") {
      // Straight passthrough to agent_mark_uncertain. Its semantics are NOT
      // reimplemented here: the `submitted_at IS NULL` guard (which refuses to
      // overwrite a confirmed send with "we don't know") and the server-side
      // blockers append (which cannot drop a concurrent write the way a
      // read-modify-write from the worker would) only exist inside the RPC.
      const id = Number(body.id);
      if (!Number.isFinite(id)) return json({ error: "id required" }, 400);
      const { error } = await client.rpc("agent_mark_uncertain", {
        p_id: id, p_reason: str(body.reason) || "worker could not confirm the result",
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "pending") {
      const userId = str(body.user_id);
      const questions = Array.isArray(body.questions) ? body.questions : [];
      if (!userId) return json({ error: "user_id required" }, 400);
      if (!questions.length) return json({ ok: true, upserted: 0 });

      const now = new Date().toISOString();
      const rows = questions
        .map((raw) => raw as Record<string, unknown>)
        .filter((q) => str(q.question_key) && str(q.question_label))
        .map((q) => ({
          user_id: userId,
          question_key: str(q.question_key),
          question_label: str(q.question_label),
          answer_kind: ["fill", "choose", "check"].includes(str(q.answer_kind))
            ? str(q.answer_kind) : "fill",
          options: Array.isArray(q.options) ? q.options : [],
          refusal_reason: str(q.refusal_reason),
          posting_id: str(q.posting_id) || null,
          company: str(q.company) || null,
          last_seen_at: now,
        }));
      if (!rows.length) return json({ ok: true, upserted: 0 });

      // One question, one row — the same ask across ten postings is one thing to
      // answer, not ten.
      const { error } = await client
        .from("agent_pending_questions")
        .upsert(rows, { onConflict: "user_id,question_key" });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, upserted: rows.length });
    }

    return json({
      error: "unknown action",
      actions: ["claim", "release", "uncertain", "pending", "ping"],
    }, 400);
  } catch (e) {
    console.error(`[APPLY-BROKER] ${action}: ${String(e).slice(0, 200)}`);
    return json({ error: "broker failure" }, 500);
  }
});
