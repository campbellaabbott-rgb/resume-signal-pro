/**
 * EVERY RESPONSE SAYS WHICH BUILD ANSWERED IT.
 *
 * The deploy check (scripts/verify-deploy.sh, scripts/deploy-ledger.mjs) reads
 * what is deployed from one header, x-fn-build, on an OPTIONS request. A
 * function that never sends it cannot be told apart from a stale deploy of
 * itself: on 2026-10-08, 21 functions sent none (sweep S8-124).
 *
 * `stamped(build, handler)` wraps a handler so that every Response it returns,
 * the preflight included, carries the header and exposes it to browsers. It
 * changes nothing else: status, body (streamed bodies pass through untouched)
 * and every other header are the handler's own, and a handler that throws
 * still throws.
 */
export function stamped(
  build: string,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set("x-fn-build", build);
    const expose = headers.get("access-control-expose-headers");
    if (!expose) headers.set("access-control-expose-headers", "x-fn-build");
    else if (!/(^|,)\s*x-fn-build\s*(,|$)/i.test(expose)) headers.set("access-control-expose-headers", `${expose}, x-fn-build`);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
