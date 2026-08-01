import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Waking the apply worker is an OPTIMISATION on top of a system that already
 * works without it. Packets sit as `ready` and drain whenever a sender next
 * appears, so the only thing this must never do is get in the way.
 *
 * The failure it guards against is specific and expensive: a wake that throws
 * inside apply-agent's offline branch would stop packets being PREPARED, which
 * is strictly worse than them being prepared and waiting. Today, with nobody
 * subscribed and no worker anywhere, `WORKER_START_URL` is unset — so the path
 * exercised in production right now is the no-op one, and that is the path
 * these tests cover.
 */
const env = new Map<string, string>();
// Minimal Deno shim: the module is written for the edge runtime and reads
// config through Deno.env. Stubbing it here is cheaper and more honest than
// abstracting the real code behind an indirection that exists only for tests.
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (k: string) => env.get(k) },
};

const load = async () => (await import("../../supabase/functions/_shared/wake-sender.ts")).wakeSender;

afterEach(() => { env.clear(); vi.unstubAllGlobals(); });

describe("wakeSender stays out of the way", () => {
  it("does nothing, and calls nothing, when there is no work", async () => {
    env.set("WORKER_START_URL", "https://example.invalid/start");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await (await load())(false)).toEqual({ attempted: false, reason: "not-needed" });
    // Starting a machine for an empty queue is a bill with nothing to show.
    expect(fetchSpy, "must not call out when there is no paid work").not.toHaveBeenCalled();
  });

  it("is a no-op when no start URL is configured — today's actual state", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await (await load())(true)).toEqual({ attempted: false, reason: "no-url" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws when the start endpoint fails", async () => {
    // The whole point. A dead webhook must degrade to "packets wait", not to
    // "apply-agent crashed and prepared nothing".
    env.set("WORKER_START_URL", "https://example.invalid/start");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r = await (await load())(true);
    expect(r).toMatchObject({ attempted: true, ok: false });
    expect((r as { error?: string }).error).toContain("ECONNREFUSED");
  });

  it("reports a non-2xx as a failure rather than a success", async () => {
    env.set("WORKER_START_URL", "https://example.invalid/start");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await (await load())(true)).toEqual({ attempted: true, ok: false, status: 403 });
  });

  it("sends a bearer token only when one is configured", async () => {
    env.set("WORKER_START_URL", "https://example.invalid/start");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await (await load())(true);
    let headers = fetchSpy.mock.calls[0]![1].headers as Record<string, string>;
    // A stray Authorization header would break a plain unauthenticated webhook.
    expect(headers.Authorization).toBeUndefined();

    fetchSpy.mockClear();
    env.set("WORKER_START_TOKEN", "sekrit");
    await (await load())(true);
    headers = fetchSpy.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sekrit");
  });
});

/**
 * The body GitHub needs. This is the difference between a wake that starts the
 * worker and a 422 nobody notices — wake failures are swallowed by design, so
 * a wrong body would show up only as applications never being sent.
 */
describe("the wake body is the host's shape, not ours", () => {
  /** Capture the request the module actually makes. */
  const capture = () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, status: 204 } as Response;
    }));
    return seen;
  };

  it("sends WORKER_START_BODY verbatim when it is set", async () => {
    const seen = capture();
    env.set("WORKER_START_URL", "https://api.github.com/dispatches");
    // GitHub's workflow_dispatch REQUIRES a ref and 422s without one.
    env.set("WORKER_START_BODY", '{"ref":"main"}');
    expect(await (await load())(true)).toMatchObject({ attempted: true, ok: true });
    expect(seen[0]?.init.body).toBe('{"ref":"main"}');
  });

  it("falls back to the readable default when the secret is not JSON", async () => {
    // A typo in a wake payload must not take down the path that PREPARES
    // applications — that would turn a cosmetic misconfiguration into
    // customers getting nothing at all.
    const seen = capture();
    env.set("WORKER_START_URL", "https://example.test/start");
    env.set("WORKER_START_BODY", "{ref:main}");
    expect(await (await load())(true)).toMatchObject({ attempted: true, ok: true });
    expect(JSON.parse(String(seen[0]?.init.body))).toHaveProperty("reason");
  });

  it("still sends the default when no body is configured", async () => {
    const seen = capture();
    env.set("WORKER_START_URL", "https://example.test/start");
    await (await load())(true);
    expect(JSON.parse(String(seen[0]?.init.body))).toHaveProperty("reason");
  });
});
