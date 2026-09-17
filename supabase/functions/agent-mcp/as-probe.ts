// THE SIGN-IN FACT — is the authorization server switched on right now?
//
// The server publishes a protected-resource document and, for a keyed tool
// called with no credential, can answer the sign-in challenge a host turns
// into its Connect card. That challenge is only honest while an
// authorization server stands behind it: Supabase's OAuth 2.1 server is a
// dashboard toggle the owner flips, and until it is on, every host that
// follows the challenge dead-ends in a sign-in that cannot finish. So the
// dispatcher asks THIS module before it challenges, and the answer is one
// fact with three values, computed here and nowhere else:
//
//   on       the metadata document answers 200 with everything a public
//            MCP client needs to register and sign in;
//   off      it answers anything else, or a 200 that lacks one of them;
//   unknown  the probe timed out or the network failed — treated like `off`
//            by every reader, because the in-band answer strands nobody and
//            a challenge into a dead sign-in is the failure this exists to
//            prevent.
//
// The fact rides on the initialize result (under SIGN_IN_META_KEY), in one
// sentence of initialize.instructions and the guide, and in the dispatcher's
// challenge decision. Pages branch on `state` only; `reason` is for the
// developer disclosure and the log.
//
// Cached per isolate: a positive answer is believed for five minutes (Claude
// caches its own discovery about that long, so a shorter positive TTL buys
// nothing); a negative or unknown one for a minute, so the owner's toggle is
// noticed within a minute. One in-flight probe is shared, so a burst of
// first calls costs one fetch. Import-light like oauth.ts — only the sibling
// module that spells the server's URL — with fetch, clock and log injected,
// so the Node test suite walks it with a stubbed fetch and Deno imports it
// unchanged.

import { AUTH_ISSUER } from "./oauth.ts";

/** The reverse-DNS key the fact rides under on the initialize result's _meta. Mirrored on the page side; pinned equal by a guard. */
export const SIGN_IN_META_KEY = "work.resumebooster/sign-in";

export type SignInState = "on" | "off" | "unknown";
export type SignInReason =
  | "feature_disabled" | "no_registration_endpoint" | "no_s256" | "no_none_auth"
  | `http_${number}` | "timeout" | "network" | null;

/** The fact exactly as it is published: pages branch on `state` only. */
export type SignInVerdict = {
  state: SignInState;
  checkedAt: string;
  authorizationServer: string;
  reason: SignInReason;
};

/**
 * The RFC 8414 document for the issuer — origin, the well-known prefix, then
 * the issuer's path. This is the URL Supabase names as the discovery
 * endpoint and the one that flips when the owner enables the server. NOT
 * the OpenID configuration document, which answers 200 with no registration
 * endpoint while the server is off, so a 200 there proves nothing.
 */
export const AUTHORIZATION_SERVER_METADATA_URL = (() => {
  const issuer = new URL(AUTH_ISSUER);
  return `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`;
})();

export const SIGN_IN_PROBE_TIMEOUT_MS = 1_500;
export const SIGN_IN_ON_TTL_MS = 5 * 60 * 1_000;
export const SIGN_IN_OFF_TTL_MS = 60 * 1_000;

export type ProbeOptions = {
  /** Injected for the harness; defaults to the isolate's fetch. */
  fetch?: typeof fetch;
  /** Milliseconds since the epoch, as a function so the cache can be walked through time. */
  now?: () => number;
  /** Where the probe line goes; defaults to console.log. */
  log?: (line: string) => void;
};

type Cached = { verdict: SignInVerdict; at: number };
let cached: Cached | null = null;
let inFlight: Promise<SignInVerdict> | null = null;

/**
 * The last verdict this isolate probed, fresh or not — null before the
 * first probe completes. For the one reader that must stay synchronous (the
 * guide, a function of the registry): its read sites await probeSignIn()
 * first, so this is the verdict that probe returned.
 */
export function cachedSignIn(): SignInVerdict | null {
  return cached?.verdict ?? null;
}

/** Test seam: forget the cached verdict and any probe in flight. */
export function resetSignInCache(): void {
  cached = null;
  inFlight = null;
}

const ttlOf = (state: SignInState): number => (state === "on" ? SIGN_IN_ON_TTL_MS : SIGN_IN_OFF_TTL_MS);

const includes = (v: unknown, needle: string): boolean => Array.isArray(v) && v.includes(needle);

/**
 * The checks, in order, each one a thing a public MCP client cannot sign in
 * without: dynamic client registration (the only client identity Claude and
 * ChatGPT can obtain here), PKCE with S256, and a token endpoint that admits
 * a public client. The first missing piece is the reason.
 */
function judgeMetadata(body: unknown): SignInReason {
  const doc = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const registration = doc?.registration_endpoint;
  if (typeof registration !== "string" || registration.trim() === "") return "no_registration_endpoint";
  if (!includes(doc?.code_challenge_methods_supported, "S256")) return "no_s256";
  if (!includes(doc?.token_endpoint_auth_methods_supported, "none")) return "no_none_auth";
  return null;
}

async function fetchVerdict(fetchFn: typeof fetch, now: () => number, log: (line: string) => void): Promise<SignInVerdict> {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIGN_IN_PROBE_TIMEOUT_MS);
  let state: SignInState;
  let reason: SignInReason;
  let status = 0;
  try {
    const res = await fetchFn(AUTHORIZATION_SERVER_METADATA_URL, { headers: { Accept: "application/json" }, signal: controller.signal });
    status = res.status;
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 200) {
      reason = judgeMetadata(body);
      state = reason === null ? "on" : "off";
    } else {
      const code = body && typeof body === "object" ? (body as { error_code?: unknown }).error_code : undefined;
      reason = code === "feature_disabled" ? "feature_disabled" : `http_${res.status}`;
      state = "off";
    }
  } catch (e) {
    const aborted = (e as { name?: unknown })?.name === "AbortError" || controller.signal.aborted;
    reason = aborted ? "timeout" : "network";
    state = "unknown";
  } finally {
    clearTimeout(timer);
  }
  const finished = now();
  log(`[AGENT-MCP] as probe ${state} (${status}${reason ? " " + reason : ""}) ${finished - started}ms`);
  return { state, checkedAt: new Date(finished).toISOString(), authorizationServer: AUTH_ISSUER, reason };
}

/**
 * The fact, from the cache while it is fresh, otherwise from ONE probe shared
 * by every caller that arrives while it is in flight. Never throws: a probe
 * that cannot complete is the `unknown` verdict, cached like a negative one.
 */
export function probeSignIn(opts: ProbeOptions = {}): Promise<SignInVerdict> {
  const now = opts.now ?? Date.now;
  const t = now();
  if (cached && t - cached.at < ttlOf(cached.verdict.state)) return Promise.resolve(cached.verdict);
  if (inFlight) return inFlight;
  // The verdict is cached before the slot is cleared, so a caller arriving
  // between the two reads the cache rather than starting a second probe.
  const run: Promise<SignInVerdict> = fetchVerdict(opts.fetch ?? fetch, now, opts.log ?? console.log)
    .then((verdict) => {
      cached = { verdict, at: now() };
      return verdict;
    })
    .finally(() => {
      if (inFlight === run) inFlight = null;
    });
  inFlight = run;
  return run;
}

// ── What the fact decides, and how it is said ───────────────────────────────

/**
 * A keyed tool called with no usable credential answers one of three ways.
 * The challenge forms exist only while sign-in is on; in every other state,
 * every caller — the host that reads its cue in band included — gets the
 * in-band answer with no cue at all, so no host is sent into a sign-in that
 * cannot finish. `readsCueInBand` is the dispatcher's word for a caller
 * whose request carries the OpenAI marker.
 */
export type NoCredentialAnswer = "challenge" | "challenge_in_band" | "in_band";
export function noCredentialAnswer(state: SignInState, readsCueInBand: boolean): NoCredentialAnswer {
  if (state !== "on") return "in_band";
  return readsCueInBand ? "challenge_in_band" : "challenge";
}

/**
 * The decision, logged once per keyed-tool-without-credential call. The word
 * "challenge" is what the log reader greps to count sign-in attempts; the
 * challenge form names its transport (the 401, or the cue in a 200 result
 * for the caller that reads it there), the in-band form names the state
 * that decided it. Takes the same two facts the decision takes, so the line
 * can never name a form the caller did not receive.
 */
export function noCredentialLog(cause: string, toolName: string, state: SignInState, readsCueInBand: boolean): string {
  const answer = noCredentialAnswer(state, readsCueInBand);
  const form = answer === "challenge" ? "401 challenge" : answer === "challenge_in_band" ? "in-band challenge" : `in-band, sign-in ${state}`;
  return `[AGENT-MCP] ${cause} on ${toolName}: ${form}`;
}

const SMALL_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number): string => SMALL_WORDS[n] ?? String(n);

/**
 * The one sentence initialize.instructions and the guide add for the state.
 * Both variants are short and fixed so the rendered instructions stay under
 * the truncation one host applies in either state; the unkeyed count is the
 * registry's, never typed.
 */
export function signInSentence(state: SignInState, unkeyedToolCount: number): string {
  if (state === "on") {
    return "A keyed tool called with no key answers a sign-in challenge (HTTP 401); a host that supports sign-in opens it.";
  }
  return `Sign-in through this server is not switched on yet: a keyed tool called with no key answers in words, and the ${countWord(unkeyedToolCount)} unkeyed tools still work.`;
}

/**
 * The guide's closing section: the same sentence, then the one refusal row
 * that depends on the state — what a keyed tool answers with no credential
 * today and what to do about it. The strings the server writes into that
 * refusal are handed in, so the guide quotes the refusal the reader will
 * actually meet rather than a paraphrase of it.
 */
export function signInGuideSection(
  state: SignInState,
  unkeyedToolCount: number,
  words: { notOn: string; unkeyedTools: readonly string[]; mintUrl: string },
): string {
  const unkeyed = words.unkeyedTools.map((n) => `\`${n}\``).join(", ");
  const row = state === "on"
    ? `- A sign-in challenge, which a host shows as its Connect card — the tool needs your account; complete the host's sign-in and it retries the call itself. A client with no sign-in sends a free key (${words.mintUrl}) as Authorization: Bearer <key> instead.`
    : `- "${words.notOn}" — the tool needs your account, and sign-in from chat apps is not available today; ${unkeyed} still answer with no key, and every other tool works from a client that can send a free key (${words.mintUrl}) as Authorization: Bearer <key>.`;
  return [
    `## Sign-in today`,
    ``,
    signInSentence(state, unkeyedToolCount),
    ``,
    row,
  ].join("\n");
}
