/**
 * The worker's only way to reach the database.
 *
 * WHY THIS EXISTS. The worker used to hold a service_role key: full read/write
 * on every table, plus every private résumé in storage, sitting in a file on
 * whatever machine happened to be running it. That was never a good shape, and
 * it stopped being a possible one when the backend moved to Lovable Cloud — the
 * key is injected into edge functions at runtime and cannot be retrieved at all.
 *
 * So the privileged half moved server-side. `apply-broker` holds the injected
 * key and exposes exactly five operations. The worker holds a shared secret
 * that grants those five and nothing else. If this secret leaks, the blast
 * radius is "someone can claim and release application packets", not "someone
 * has every candidate's résumé".
 *
 * The browser half stayed here, because Deno has no browser and driving real
 * application forms is the entire reason this process exists.
 *
 * THE ONE RULE WORTH STATING. A failure to reach the broker and a broker that
 * says "no work" must never look the same to the caller. That distinction is
 * the difference between "the queue is empty, stop cleanly" and "we are blind,
 * and every packet is about to look undeliverable". Every function below
 * returns a discriminated result rather than null-on-everything.
 */

const URL_BASE = (process.env.APPLY_BROKER_URL ?? "").replace(/\/+$/, "");
const SECRET = process.env.APPLY_WORKER_SECRET ?? "";

/** Long enough for a cold edge function, short enough not to wedge a run. */
const TIMEOUT_MS = 20_000;

export type BrokerFailure = {
  ok: false;
  /**
   * `auth` is called out separately because it is never transient. Retrying a
   * bad secret forever, logging "failed" each time, is how a five-second
   * misconfiguration turns into an afternoon of confused debugging.
   */
  kind: "auth" | "network" | "server" | "misconfigured";
  detail: string;
};

export type StandingAnswersWire = {
  fullName: string; firstName: string; lastName: string;
  email: string; phone: string; city: string; country: string;
  address: string; postcode: string; linkedin: string; website: string;
  coverNote: string; salaryExpectation: string; earliestStart: string;
  workAuthorized: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  workAuthorizedCountries: string[];
  shareDemographics: boolean | null;
  consentToProcessing: boolean | null;
};

export type ClaimedPacket = {
  packet: {
    id: number; user_id: string; posting_id: string; title: string;
    company: string; company_token: string; apply_url: string; source: string;
    fields: Record<string, { value: string; source: string }>;
  };
  answers: StandingAnswersWire;
  learned: Array<{ key: string; label: string; kind: "fill" | "choose" | "check"; value: string }>;
  /** Signed, ~5 minutes. Fetched once and written to a temp file. */
  resumeUrl: string | null;
};

async function post<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | BrokerFailure> {
  if (!URL_BASE || !SECRET) {
    return {
      ok: false, kind: "misconfigured",
      detail: "APPLY_BROKER_URL and APPLY_WORKER_SECRET must both be set",
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "auth", detail: `broker rejected the worker secret (${res.status})` };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, kind: "server", detail: `${res.status} ${text.slice(0, 160)}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, kind: "network", detail: String(e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claim one packet, or learn there is nothing to do.
 *
 * THREE OUTCOMES, deliberately not two. `{ ok: true, data: null }` means the
 * queue is empty — a normal, healthy state that should let the worker exit.
 * A failure means we could not ask, which is not the same thing and must not
 * be treated as an empty queue.
 */
export async function claim(workerId: string, version: string) {
  const r = await post<{ packet: ClaimedPacket["packet"] | null } & Partial<ClaimedPacket>>({
    action: "claim", worker_id: workerId, version,
  });
  if (!r.ok) return r;
  return { ok: true as const, data: r.data.packet ? (r.data as ClaimedPacket) : null };
}

/** Write the outcome back and drop the lease. */
export async function release(id: number, patch: Record<string, unknown>) {
  return post<{ ok: boolean; mirrored?: boolean }>({ action: "release", id, patch });
}

/**
 * Submitted, result unknown.
 *
 * A separate action rather than a `release` patch on purpose. The underlying
 * RPC carries `WHERE submitted_at IS NULL`, which refuses to overwrite a
 * CONFIRMED send with "we don't know" — the worst data loss this system can
 * suffer — and appends to `blockers` server-side rather than racing a
 * read-modify-write. Flattening it into release would silently drop both.
 */
export async function uncertain(id: number, reason: string) {
  return post<{ ok: boolean }>({ action: "uncertain", id, reason });
}

/** Questions the agent refused and the candidate can answer once. */
export async function pending(
  userId: string,
  questions: Array<{
    question_key: string; question_label: string;
    answer_kind: "fill" | "choose" | "check";
    options: string[]; refusal_reason: string;
    posting_id: string; company: string;
  }>,
) {
  return post<{ ok: boolean }>({ action: "pending", user_id: userId, questions });
}

/** Heartbeat. What makes the pricing card admit the sender is live. */
export async function ping(workerId: string, version: string, claimed = 0) {
  return post<{ ok: boolean }>({ action: "ping", worker_id: workerId, version, claimed });
}
