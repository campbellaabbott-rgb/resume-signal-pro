// THE PROTOCOL REVISIONS THIS SERVER SPEAKS, AND THE WAY IN FOR A CLIENT OF
// ONE IT DOES NOT (lane fix/1121-connector-errors, item 8).
//
// PURE: the version lists, the era of a request, the batch bounds, and the
// fixed answers. index.ts does the I/O.
//
// THE HANDSHAKE (2025-11-25 lifecycle, Version Negotiation): "If the server
// supports the requested protocol version, it MUST respond with the same
// version. Otherwise, the server MUST respond with another protocol version it
// supports", and a client that does not support the answer SHOULD disconnect.
// This server used to list one revision, 2025-06-18, and answer it whatever was
// asked, so a client that speaks only 2025-03-26 or 2024-11-05 was told a
// revision it does not speak and hung up. It now answers each of the four
// handshake revisions as itself:
//   - 2025-11-25 differs from 2025-06-18 only in things this server does not
//     use or already sends (icons, title and websiteUrl are sent; a bad Origin
//     is answered 403; input errors are tool results).
//   - 2025-03-26 REQUIRES a server to accept JSON-RPC batches: an array body is
//     accepted while the MCP-Protocol-Version header is absent or names
//     2025-03-26 (the 2026-07-28 transport page: a server "MAY treat a request
//     that omits the header as protocol version 2025-03-26"), up to BATCH_MAX
//     messages, each handled and metered on its own.
//   - 2024-11-05 has no batching rule this server breaks, and is spoken over
//     this transport.
// With a header naming 2025-06-18 or later an array keeps its 400: that
// revision removed batching.
//
// THE CURRENT REVISION, 2026-07-28, has no handshake (server/discover, and a
// protocol version in every request's _meta). This build does NOT speak it
// (SERVES_2026_07_28 is false): such a request is answered HTTP 400 with the
// JSON-RPC error -32600, which is none of that revision's modern errors
// (-32022 unsupported version, -32020 header mismatch, 404 with -32601), so a
// client that speaks both eras falls back to initialize, as the 2026-07-28
// transport page (Backward Compatibility) tells it to on a 400 whose body is
// "not a recognized modern JSON-RPC error". Today's HTTP 200 carrying -32601
// was not that, and a client could do nothing with it.

/** The handshake revisions, latest first: initialize answers the one asked when it is here, else the first. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/** Whether this build serves the stateless 2026-07-28 revision (8c). False: its fallback answer ships. */
export const SERVES_2026_07_28 = false;

/** The _meta key a 2026-07-28 request carries its revision under. */
export const MODERN_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";

/** The revision initialize answers: the one asked when this server speaks it, else the latest handshake revision. */
export function negotiatedVersion(asked: unknown): string {
  const a = typeof asked === "string" ? asked : "";
  return MCP_PROTOCOL_VERSIONS.includes(a) ? a : MCP_PROTOCOL_VERSIONS[0];
}

/** True for a request of the stateless revision: server/discover, or a protocol version in params._meta. */
export function isModernRequest(method: unknown, params: Record<string, unknown>): boolean {
  if (method === "server/discover") return true;
  const meta = params._meta;
  return !!meta && typeof meta === "object" && !Array.isArray(meta) &&
    Object.prototype.hasOwnProperty.call(meta, MODERN_VERSION_META_KEY);
}

/** What a request of the stateless revision is answered while this build does not speak it: HTTP 400, -32600. */
export const MODERN_FALLBACK_STATUS = 400;
export function modernFallback(id: unknown): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32600,
      message: "This server speaks the initialize handshake (protocol 2025-11-25 and earlier): send initialize first.",
      // Never a key named `supported`, which the 2026-07-28 unsupported-version error uses.
      data: { handshakeVersions: [...MCP_PROTOCOL_VERSIONS] },
    },
  };
}

/** At most this many messages in one batch. */
export const BATCH_MAX = 10;

/** A batch is read only when the request's MCP-Protocol-Version header is absent or names 2025-03-26. */
export function batchAllowed(headerVersion: string | null): boolean {
  const v = (headerVersion ?? "").trim();
  return v === "" || v === "2025-03-26";
}

/** Why a batch was refused for its size. */
export function batchSizeError(n: number): string | null {
  if (n === 0) return "An empty batch holds no message: send at least one JSON-RPC message.";
  if (n > BATCH_MAX) return `A batch holds at most ${BATCH_MAX} messages; this one holds ${n}. Send them in smaller batches or one per request.`;
  return null;
}

/** initialize inside a batch is refused for that element (the revision forbids it). */
export const INITIALIZE_IN_BATCH = "initialize cannot be part of a batch: send it on its own first.";

/** A GET that asks for an event stream: a client set to the old sse transport. */
export function wantsEventStream(accept: string | null): boolean {
  return /\btext\/event-stream\b/i.test(accept ?? "") && !/\bapplication\/json\b/i.test(accept ?? "");
}
export const SSE_TRANSPORT_SENTENCE =
  "This server speaks Streamable HTTP only: set the transport type to http, not sse, and POST to this same address.";
