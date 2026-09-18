// One HTTP client for the poller: strictly sequential, one User-Agent that
// names a contact address, a per-host floor between requests, and a body
// cap. Nothing here retries and nothing loops on a failure — a fetch that
// fails is reported to the caller once and the next cron picks up.
//
// SEC's published ceiling is 10 requests per second per declared agent; the
// floor here keeps EDGAR traffic well under it (2/s on the hourly poll,
// 4/s on the one-time backfill). State sites and raw.githubusercontent.com
// get the same courtesy at 1/s. The floor is enforced by awaiting a timer
// BEFORE each request on the same host, and every request is chained behind
// the previous one, so two calls never overlap even when a caller forgets
// to await in order.

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface HttpOptions {
  userAgent: string;
  /** Minimum milliseconds between two requests to the same host (suffix match). */
  minIntervalMs?: Record<string, number>;
  defaultIntervalMs?: number;
  timeoutMs?: number;
  /** Test seam: replace global fetch. */
  fetchImpl?: typeof fetch;
}

export interface HttpResult {
  status: number;
  headers: Headers;
  body: Uint8Array;
  url: string;
}

export class Http {
  private lastAt = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();
  requests = 0;

  constructor(private opts: HttpOptions) {}

  /** The floor and the bucket it applies to: www.sec.gov, data.sec.gov and efts.sec.gov share one SEC budget. */
  private intervalFor(host: string): { floor: number; bucket: string } {
    const m = this.opts.minIntervalMs ?? {};
    for (const k of Object.keys(m)) if (host === k || host.endsWith("." + k)) return { floor: m[k], bucket: k };
    return { floor: this.opts.defaultIntervalMs ?? 1000, bucket: host };
  }

  /** GET (or HEAD) one URL, in turn. Throws on network failure; never on status. */
  request(
    url: string,
    init: { method?: "GET" | "HEAD"; headers?: Record<string, string>; maxBytes?: number } = {},
  ): Promise<HttpResult> {
    const run = async (): Promise<HttpResult> => {
      const host = new URL(url).host;
      const { floor, bucket } = this.intervalFor(host);
      const last = this.lastAt.get(bucket) ?? 0;
      const wait = last + floor - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt.set(bucket, Date.now());
      this.requests += 1;
      const f = this.opts.fetchImpl ?? fetch;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 25_000);
      try {
        const res = await f(url, {
          method: init.method ?? "GET",
          headers: {
            "User-Agent": this.opts.userAgent,
            "Accept-Encoding": "gzip, deflate",
            ...(init.headers ?? {}),
          },
          redirect: "follow",
          signal: ctrl.signal,
        });
        const limit = init.maxBytes ?? MAX_BODY_BYTES;
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > limit) {
          try { await res.body?.cancel(); } catch { /* nothing to release */ }
          throw new Error(`oversize: declared ${declared} > ${limit}`);
        }
        let body = new Uint8Array(0);
        if (init.method !== "HEAD" && res.body) {
          const chunks: Uint8Array[] = [];
          let seen = 0;
          const reader = res.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            seen += value.byteLength;
            if (seen > limit) {
              try { await reader.cancel(); } catch { /* released */ }
              throw new Error(`oversize: streamed ${seen} > ${limit}`);
            }
            chunks.push(value);
          }
          body = new Uint8Array(seen);
          let off = 0;
          for (const c of chunks) { body.set(c, off); off += c.byteLength; }
        } else if (res.body) {
          try { await res.body.cancel(); } catch { /* released */ }
        }
        return { status: res.status, headers: res.headers, body, url: res.url || url };
      } finally {
        clearTimeout(timer);
      }
    };
    // Serialise every request behind the previous one, whatever the host.
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async getText(
    url: string,
    headers?: Record<string, string>,
    maxBytes?: number,
  ): Promise<{ status: number; text: string; headers: Headers; url: string }> {
    const r = await this.request(url, { headers, maxBytes });
    return { status: r.status, text: decodeText(r.body, r.headers.get("content-type")), headers: r.headers, url: r.url };
  }

  async getJson(url: string, headers?: Record<string, string>): Promise<{ status: number; json: unknown; headers: Headers }> {
    const r = await this.getText(url, { Accept: "application/json", ...(headers ?? {}) });
    let json: unknown = null;
    try { json = JSON.parse(r.text); } catch { json = null; }
    return { status: r.status, json, headers: r.headers };
  }

  head(url: string, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request(url, { method: "HEAD", headers });
  }
}

/** Decode a body by its declared charset; EDGAR's Atom is ISO-8859-1. */
export function decodeText(body: Uint8Array, contentType: string | null): string {
  const m = /charset=([\w-]+)/i.exec(contentType ?? "");
  const cs = (m?.[1] ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs === "iso-8859-1" || cs === "latin1" ? "iso-8859-1" : "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
