// THE KEYLESS ALLOWANCE: WHO PAYS FOR A CALL, AND WHAT A REFUSAL SAYS.
//
// Owner decision 2026-10-11 (economics decision 1(b), which replaces the wave-4
// spec's R1): 20,000 keyless calls a day, split by the platform the call came
// from -- Claude 10,000, ChatGPT 6,000 (200 for each person OpenAI names in
// openai/subject, 2,000 shared by calls that name nobody), everyone else 4,000
// (100 for each IPv4 address or IPv6 /64). Per minute: 60 overall, Claude 30,
// ChatGPT 20, other 15. Applying yourself draws on a pool of its own, 5,000 a
// day at 20 a minute, so reading an employer's form never spends a lookup.
// That pool is split by platform the same way (review of 9fe3bc0d): Claude
// 2,000 a day at 10 a minute, ChatGPT 2,000 at 6, everyone else 1,000 at 4,
// so a scraper outside both platforms can spend only its own part of it.
// Timeouts are never given back. board_stats is served from a five-minute
// cache and is not counted at all.
//
// WHO PAYS IS DECIDED BY THE ADDRESS THE PLATFORM SAW, AND BY NOTHING ELSE.
// Anthropic's published outbound range is Claude's share; OpenAI's published
// connector ranges (with the openai/ _meta marker or a ChatGPT user agent) are
// ChatGPT's, and only from there is openai/subject believed. A /chatgpt path,
// a user agent or a _meta key from any other address picks the TEXT edition
// (no purchase links, no header advice) and never the share: a script cannot
// spend ChatGPT's 6,000 by claiming to be ChatGPT.
//
// Every figure here is a parameter of mcp_anon_check_v2 (20261011102000), so a
// cut is a one-constant release. Pure: no I/O, so the Node suite walks every
// branch and Deno imports it unchanged.

/** The figures, one place. Read by the meter call, the notes, the guide and the instructions. */
export const ANON_ALLOWANCE = {
  /** Every keyless call of the day except the forms pool and board_stats. */
  overallPerDay: 20_000,
  shares: { claude: 10_000, chatgpt: 6_000, other: 4_000 },
  /** One ChatGPT user, when OpenAI's call names them. */
  chatgptPerPerson: 200,
  /** ChatGPT calls that carry no openai/subject, together. */
  chatgptNoSubject: 2_000,
  /** One IPv4 address, or one IPv6 /64, outside both platforms. */
  otherPerConnection: 100,
  perMinute: { overall: 60, claude: 30, chatgpt: 20, other: 15, forms: 20 },
  /**
   * apply_myself: a pool outside the 20,000. A host pool (Claude, ChatGPT
   * without a subject) gets `pool`, a person or a connection `perBucket`.
   * Each platform's part of the pool (`shares`, a day; `perMinute`) sits
   * inside `overall` and perMinute.forms, so no platform's callers can spend
   * another's.
   */
  forms: {
    perBucket: 100,
    pool: 2_000,
    overall: 5_000,
    shares: { claude: 2_000, chatgpt: 2_000, other: 1_000 },
    perMinute: { claude: 10, chatgpt: 6, other: 4 },
  },
  /** board_stats, never counted: one cached answer for this long, and this many calls a minute for a connection's bucket in one isolate (boardStatsPerMinuteFor scales it to a bigger bucket). */
  boardStatsCacheMs: 300_000,
  boardStatsPerMinute: 30,
  /** Rows on one keyless page, and the deepest offset a keyless caller may page to. */
  searchRows: 10,
  maxOffset: 200,
  /** The deepest offset a keyed MCP caller may page to: the same bound /v1 applies. */
  keyedMaxOffset: 10_000,
  /** Ids check_jobs_open answers in one keyless call (a keyed call takes 200). */
  checkJobsOpenIds: 50,
  /**
   * Transport failures and unknown ids given back per bucket per day: at
   * least refundsPerBucket, and refundShare of the bucket's day for a bigger
   * one (S12-176: Claude's 10,000 is one bucket for every Claude user, and 5
   * a day was 5 for all of them). boardStatsPerMinute is a connection's
   * (100 a day) minute; a bigger bucket gets the same per hundred a day.
   */
  refundsPerBucket: 5,
  refundShare: 0.05,
  /**
   * Keyless calls running at once in one isolate, and how long one waits for
   * a turn before it is turned away uncounted (review of 9fe3bc0d). The
   * per-minute caps bound a minute's total, not how many searches hit the
   * board together: sixty could arrive at once, on the worker pool job-board
   * shares with ingest. Isolates multiply this, so it bounds a burst rather
   * than the whole service.
   */
  inFlightPerIsolate: 6,
  inFlightWaitMs: 8_000,
} as const;

/** The three shares of the day, by verified source. */
export type Partition = "claude" | "chatgpt" | "other";

/**
 * Which words a caller reads. Chosen by what the caller says it is (its
 * address, its openai/ _meta, its user agent): chat users are never told
 * about request headers, and a ChatGPT caller is never sent to buy anything.
 * It never decides who pays.
 */
export type Edition = "claude" | "chatgpt" | "other";

export type AllowanceKind = "claude" | "chatgpt-user" | "chatgpt" | "connection";

/** One keyless bucket, ready for mcp_anon_check_v2. `bucket` never holds an address: a connection is the day's keyed hash (bucketHash). */
export type AllowanceBucket = {
  partition: Partition;
  kind: AllowanceKind;
  bucket: string;
  bucketCap: number;
  share: string;
  shareCap: number;
  minuteCap: number;
  /** How a sentence names whose allowance it is. */
  owner: string;
};

const parseV4 = (ip: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x <= 255) ? o : null;
};

/**
 * The eight 16-bit groups of an IPv6 address, or null when it is not one.
 * Handles `::` compression, a zone id, and an embedded IPv4 tail.
 */
function v6Groups(raw: string): number[] | null {
  let ip = raw.trim().replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return null;
  // An embedded IPv4 tail (::ffff:192.0.2.1) is two groups.
  const lastColon = ip.lastIndexOf(":");
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const o = parseV4(maybeV4);
    if (!o) return null;
    ip = `${ip.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s === "" ? [] : s.split(":"));
  const toNum = (g: string) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN);
  const h = part(halves[0]).map(toNum);
  const r = halves.length === 2 ? part(halves[1]).map(toNum) : [];
  if ([...h, ...r].some((n) => Number.isNaN(n))) return null;
  if (halves.length === 1) return h.length === 8 ? h : null;
  const fill = 8 - h.length - r.length;
  if (fill < 1) return null;
  return [...h, ...new Array(fill).fill(0), ...r];
}

/**
 * The /64 an IPv6 address belongs to, as four lower-case hex groups, or null
 * for anything that is not IPv6. One home or office connection is usually
 * handed a whole /64, and rotating within it costs nothing, so a /64 is one
 * connection here.
 */
export function v6Net64(ip: string): string | null {
  const g = v6Groups(ip);
  return g ? g.slice(0, 4).map((x) => x.toString(16)).join(":") : null;
}

/**
 * The connection a non-platform caller is counted by: its full IPv4 address
 * (never a /24, which would put an office or a carrier's NAT in one bucket of
 * 100), or its IPv6 /64. An IPv4-mapped IPv6 address is its IPv4 address.
 * Anything unreadable is itself, so it still has a bucket of its own.
 */
export function connectionOf(address: string): string {
  const a = String(address ?? "").trim();
  if (parseV4(a)) return a;
  const mapped = /^(?:::ffff:|::ffff:0:)(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a.replace(/^\[|\]$/g, ""));
  if (mapped && parseV4(mapped[1])) return mapped[1];
  const net = v6Net64(a);
  return net ? `v6:${net}::/64` : a || "unknown";
}

/**
 * The one bucket a lookup is counted in. `host` is the platform the VERIFIED
 * address belongs to (null for anyone else); `subjectHash` is a hash of
 * openai/subject, used only when that platform is ChatGPT; `connectionHash` is
 * bucketHash of connectionOf(address). Exactly one bucket per call: a spent bucket
 * never falls through to another.
 */
export function lookupBucket(host: "claude" | "chatgpt" | null, subjectHash: string, connectionHash: string): AllowanceBucket {
  const A = ANON_ALLOWANCE;
  if (host === "claude") {
    return {
      partition: "claude", kind: "claude", bucket: "host:claude", bucketCap: A.shares.claude,
      share: "global:claude", shareCap: A.shares.claude, minuteCap: A.perMinute.claude,
      owner: "shared by every Claude user",
    };
  }
  if (host === "chatgpt") {
    return subjectHash
      ? {
        partition: "chatgpt", kind: "chatgpt-user", bucket: `u:chatgpt:${subjectHash}`, bucketCap: A.chatgptPerPerson,
        share: "global:chatgpt", shareCap: A.shares.chatgpt, minuteCap: A.perMinute.chatgpt,
        owner: "yours in ChatGPT",
      }
      : {
        partition: "chatgpt", kind: "chatgpt", bucket: "host:chatgpt", bucketCap: A.chatgptNoSubject,
        share: "global:chatgpt", shareCap: A.shares.chatgpt, minuteCap: A.perMinute.chatgpt,
        owner: "shared by ChatGPT users whose calls carry no user id",
      };
  }
  return {
    partition: "other", kind: "connection", bucket: connectionHash, bucketCap: A.otherPerConnection,
    share: "global:other", shareCap: A.shares.other, minuteCap: A.perMinute.other,
    owner: "for this connection",
  };
}

/** The forms pool's own day row: the overall row of a forms call, never a share. */
export const FORMS_POOL = "global:forms";

/**
 * The same caller's bucket in the forms pool (apply_myself), which never
 * touches the lookups: its platform's part of the pool as the share
 * ('global:forms:claude', ':chatgpt', ':other', each with its own minute
 * row), and the pool itself (FORMS_POOL) as the overall row.
 */
export function formsBucket(b: AllowanceBucket): AllowanceBucket {
  const A = ANON_ALLOWANCE;
  const pool = b.kind === "claude" || b.kind === "chatgpt";
  return {
    ...b,
    bucket: `f:${b.bucket}`,
    bucketCap: pool ? A.forms.pool : A.forms.perBucket,
    share: `${FORMS_POOL}:${b.partition}`,
    shareCap: A.forms.shares[b.partition],
    minuteCap: A.forms.perMinute[b.partition],
  };
}

/** True for a forms call's bucket. */
export const isFormsBucket = (b: AllowanceBucket): boolean => b.share.startsWith(`${FORMS_POOL}:`);

/**
 * Calls given back a day for this bucket (mcp_anon_refund's p_max): the
 * bucket's refundShare, never fewer than refundsPerBucket. A connection
 * (100) keeps 5; a ChatGPT person (200) gets 10; Claude's pool (10,000) 500.
 */
export function refundsFor(b: AllowanceBucket): number {
  const A = ANON_ALLOWANCE;
  return Math.max(A.refundsPerBucket, Math.ceil(b.bucketCap * A.refundShare));
}

/**
 * board_stats calls a minute for this lookup bucket, in one isolate: a
 * connection's figure for each hundred calls of the bucket's day, never
 * fewer than a connection's. A connection keeps 30; Claude's pool gets 3,000.
 */
export function boardStatsPerMinuteFor(b: AllowanceBucket): number {
  const A = ANON_ALLOWANCE;
  return Math.max(A.boardStatsPerMinute, Math.round((A.boardStatsPerMinute * b.bucketCap) / A.otherPerConnection));
}

/** The UTC day a keyed hash and the allowance both run on. */
export const utcDay = (now: number = Date.now()): string => new Date(now).toISOString().slice(0, 10);

/**
 * A KEYED HASH THAT CHANGES EVERY DAY (sweep S12-175). A connection's bucket
 * was the plain SHA-256 of its address, and the IPv4 space is small enough to
 * hash whole in minutes, so a read of mcp_anon_rate gave the addresses back;
 * the Privacy page's "one-way hashed" was not so. The bucket is now
 * HMAC-SHA-256 of the value under a key derived for the UTC day from a secret
 * the table never sees, cut to 16 hex characters: without the secret no row
 * can be turned back into an address, and no two days' rows can be joined.
 * The allowance is a day long, so the day's key costs nothing the counter
 * needs. Each day's key is derived once per isolate.
 */
let dayKey: { secret: string; day: string; key: CryptoKey } | null = null;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const hmacSign = (key: CryptoKey, message: string): Promise<ArrayBuffer> =>
  crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
export async function bucketHash(secret: string, day: string, value: string): Promise<string> {
  if (!secret) throw new Error("bucketHash needs a secret");
  let key = dayKey && dayKey.secret === secret && dayKey.day === day ? dayKey.key : null;
  if (!key) {
    const root = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), HMAC, false, ["sign"]);
    key = await crypto.subtle.importKey("raw", await hmacSign(root, `mcp-anon-bucket:${day}`), HMAC, false, ["sign"]);
    dayKey = { secret, day, key };
  }
  const mac = new Uint8Array(await hmacSign(key, value));
  return [...mac.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** mcp_anon_check_v2's answer (its OUT columns). */
export type MeterDecision = {
  allowed: boolean;
  refused_by: string | null;
  bucket_used: number;
  bucket_cap: number;
  share_used: number;
  share_cap: number;
  overall_used: number;
  overall_cap: number;
  minute_used: number;
  minute_cap: number;
};

/** Whole hours until midnight UTC, at least one: what a refusal tells a person. */
export function hoursUntilReset(now: number = Date.now()): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / 3_600_000));
}

/** Seconds left in the current UTC minute, at least one. */
export function secondsLeftInMinute(now: number = Date.now()): number {
  return Math.max(1, 60 - new Date(now).getUTCSeconds());
}

/**
 * What a spent allowance says, as [message, fix]. The message keeps the
 * phrase "The unkeyed allowance is spent" for a day refusal (verify-deploy
 * greps it). The fix names the keyless twin -- `twin`, the posting or the
 * search on the site, which needs nothing -- and, only for a caller outside
 * both chat platforms, the free key and the header it travels in.
 */
export function spentRefusal(
  d: MeterDecision,
  b: AllowanceBucket,
  edition: Edition,
  twin: string,
  mintUrl: string,
  keyDailyQuota: number,
  now: number = Date.now(),
): [string, string] {
  const hours = hoursUntilReset(now);
  if (d.refused_by === "minute" || d.refused_by === "overall_minute") {
    const secs = secondsLeftInMinute(now);
    const forms = isFormsBucket(b);
    const from = b.partition === "claude" ? "from Claude" : b.partition === "chatgpt" ? "from ChatGPT" : "from outside Claude and ChatGPT";
    const whose = d.refused_by === "minute"
      ? (forms ? `for reading application forms ${from}` : from)
      : (forms ? "for reading application forms, across every keyless caller" : "across every keyless caller");
    return [
      `Too many keyless calls this minute ${whose} (${d.minute_used} of ${d.minute_cap}). Nothing was counted for this call.`,
      `Try again in ${secs} seconds. Meanwhile ${twin} needs nothing.`,
    ];
  }
  const forms = isFormsBucket(b);
  const shareOwner = b.partition === "claude" ? "shared by every Claude user" : b.partition === "chatgpt" ? "shared by every ChatGPT user" : "for everyone outside Claude and ChatGPT";
  const which = d.refused_by === "bucket"
    ? `${d.bucket_cap.toLocaleString("en-US")} ${forms ? "application-form reads" : "lookups"} a day ${b.owner}`
    : d.refused_by === "share"
    ? `${d.share_cap.toLocaleString("en-US")} ${forms ? "application-form reads" : "lookups"} a day ${shareOwner}`
    : `${d.overall_cap.toLocaleString("en-US")} ${forms ? "application-form reads a day for everyone" : "keyless lookups a day for everyone"}`;
  const message = `The unkeyed allowance is spent: ${which}. It resets at midnight UTC, in about ${hours} hour${hours === 1 ? "" : "s"}.`;
  const site = `Meanwhile ${twin} needs nothing.`;
  if (edition !== "other") return [message, site];
  return [message, `${site} A free key (${mintUrl}) gives ${keyDailyQuota.toLocaleString("en-US")} calls a day, no account: send it as Authorization: Bearer <key> or x-api-key.`];
}
