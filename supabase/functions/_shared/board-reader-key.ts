/**
 * OUR OWN SERVERS PROVE THEY ARE NOT A BROWSER WHEN THEY READ THE BOARD.
 *
 * job-board counts anonymous reads per address (job-board/anon-budget.ts).
 * agent-mcp, public-api and send-search-digest read the board with the ANON
 * key on purpose -- they must hold no more search power than the site -- and
 * they all leave from the platform's shared egress, so without a proof every
 * MCP agent, /v1 customer and digest would spend one browser's allowance.
 *
 * The proof is a value derived from the service-role key, which every function
 * in this project has and no browser ever sees. It grants nothing but skipping
 * the browser meter: the bearer stays the anon key. Defined once, here, so the
 * sender and the checker cannot drift apart.
 */

/** The request header that carries the proof. Lowercase; Headers.get is case-insensitive. */
export const BOARD_READER_HEADER = "x-rb-reader";

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** The first 32 hex of SHA-256(serviceKey + ":board-reader"); "" for an empty key, which never matches. */
export async function boardReaderKey(serviceKey: string): Promise<string> {
  if (!serviceKey) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${serviceKey}:board-reader`));
  return hex(digest).slice(0, 32);
}

/** Spread into a board fetch's headers. Empty when the key is unset, so nothing false is ever sent. */
export async function boardReaderHeader(serviceKey: string): Promise<Record<string, string>> {
  const key = await boardReaderKey(serviceKey);
  return key ? { [BOARD_READER_HEADER]: key } : {};
}
