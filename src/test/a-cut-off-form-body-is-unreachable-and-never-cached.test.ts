/**
 * A CUT-OFF FORM BODY IS UNREACHABLE, AND NEVER CACHED (S14X-134).
 *
 * The form reader turned a body it could not finish reading into "no form":
 * jsonOf answered null when res.json() threw, and each res.text() catch
 * returned null. A body cut off mid-read (a connection reset, or the reader's
 * own 6-second timeout firing while the body streamed) or a 200 that was not
 * JSON was therefore read as an employer with no form, and the reader wrote
 * ok = false into application_form_cache, believed for 24 hours. A 5xx, the
 * same failure seen earlier, answered unreachable and cached nothing.
 *
 * Now every body read that fails is the same transient failure as a 5xx:
 * unreachable, with no cache write. A whole 200 that states no questions is
 * still absent, and still cached.
 */
import { describe, expect, it, vi } from "vitest";
import { readApplicationForm, type FormCache, type PostingRef } from "../../supabase/functions/_shared/application-form";

const NOW = Date.parse("2026-11-16T10:00:00Z");

/** A 200 whose body stream sends some bytes and then fails, as a reset connection does. */
const brokenBody = (first: string) => new Response(new ReadableStream<Uint8Array>({
  start(c) {
    c.enqueue(new TextEncoder().encode(first));
    c.error(new Error("connection reset"));
  },
}), { status: 200 });

const spyCache = () => {
  const put = vi.fn(async () => {});
  const cache: FormCache = { get: async () => null, put };
  return { cache, put };
};

const read = (ref: PostingRef, res: () => Response) => {
  const { cache, put } = spyCache();
  return readApplicationForm(ref, { fetch: (async () => res()) as typeof fetch, cache, now: () => NOW }).then((r) => ({ r, put }));
};

const GH: PostingRef = { id: "greenhouse:acme:101", source: "greenhouse", token: "acme", applyUrl: null };
const LEVER: PostingRef = { id: "lever:acme:0b1c2d3e-0000-4000-8000-000000000001", source: "lever", token: "acme", applyUrl: null };
const WORKABLE: PostingRef = { id: "workable:acme:ABC123DEF", source: "workable", token: "acme", applyUrl: null };
const BREEZY: PostingRef = { id: "breezy:acme:abc123", source: "breezy", token: "acme", applyUrl: "https://acme.breezy.hr/p/abc123-engineer" };

describe("a body that could not be read whole answers unreachable and writes nothing to the cache", () => {
  it("Greenhouse: a JSON body cut off mid-object", async () => {
    const { r, put } = await read(GH, () => new Response('{"questions":[{"label":', { status: 200 }));
    expect(r.kind).toBe("unreachable");
    expect(put).not.toHaveBeenCalled();
  });

  it("Greenhouse: a body stream that errors", async () => {
    const { r, put } = await read(GH, () => brokenBody('{"questions":['));
    expect(r.kind).toBe("unreachable");
    expect(put).not.toHaveBeenCalled();
  });

  it("Workable: a 200 whose body is not JSON", async () => {
    const { r, put } = await read(WORKABLE, () => new Response("<html>gateway</html>", { status: 200 }));
    expect(r.kind).toBe("unreachable");
    expect(put).not.toHaveBeenCalled();
  });

  it("Lever: an apply page whose body stream errors", async () => {
    const { r, put } = await read(LEVER, () => brokenBody("<html><body><form"));
    expect(r.kind).toBe("unreachable");
    expect(put).not.toHaveBeenCalled();
  });

  it("Breezy: an apply page whose body stream errors", async () => {
    const { r, put } = await read(BREEZY, () => brokenBody("<html><body>"));
    expect(r.kind).toBe("unreachable");
    expect(put).not.toHaveBeenCalled();
  });
});

describe("a whole answer is believed as before", () => {
  it("a whole 200 that states no questions is absent, and cached as absent", async () => {
    const { r, put } = await read(GH, () => new Response(JSON.stringify({ questions: [] }), { status: 200 }));
    expect(r.kind).toBe("absent");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toEqual([GH.id, "greenhouse", false, {}]);
  });

  it("a whole 200 with questions is read, and cached as read", async () => {
    const { r, put } = await read(GH, () => new Response(JSON.stringify({ questions: [{ label: "Why us?", required: false, fields: [{ type: "textarea" }] }] }), { status: 200 }));
    expect(r.kind).toBe("read");
    expect(put).toHaveBeenCalledTimes(1);
    expect((put.mock.calls[0] as unknown[])[2]).toBe(true);
  });
});
