/**
 * A supabase client double for mounting the Shortlist page: every query chain
 * is recorded (table, then each call and its arguments, in order), and a test
 * decides the answer per chain. Used as
 *   vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./helpers/shortlist-page-fake")).fakeSupabase }));
 */
export type Chain = { table: string; ops: Array<[string, unknown[]]> };
export type Answer = { data: unknown; error: unknown };
type Terminal = "many" | "single" | "maybe";

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "insert", "upsert", "update", "delete", "range", "neq", "is", "gt", "lt"];

export const shortlistFake = {
  chains: [] as Chain[],
  invoked: [] as Array<{ fn: string; body: Record<string, unknown> }>,
  rpcs: [] as Array<{ name: string; args: unknown }>,
  respond: ((_chain: Chain, _t: Terminal): Answer => ({ data: [], error: null })) as (chain: Chain, t: Terminal) => Answer,
  invoke: (async () => ({ data: { success: true }, error: null })) as (fn: string, body: Record<string, unknown>) => Promise<Answer>,
  rpcAnswer: ((): Answer => ({ data: null, error: null })) as (name: string, args: unknown) => Answer,
  reset() {
    this.chains.length = 0;
    this.invoked.length = 0;
    this.rpcs.length = 0;
    this.respond = () => ({ data: [], error: null });
    this.invoke = async () => ({ data: { success: true }, error: null });
    this.rpcAnswer = () => ({ data: null, error: null });
  },
};

export const fakeSupabase = {
  from(table: string) {
    const chain: Chain = { table, ops: [] };
    shortlistFake.chains.push(chain);
    const self: Record<string, unknown> = {};
    for (const k of CHAIN_METHODS) self[k] = (...args: unknown[]) => { chain.ops.push([k, args]); return self; };
    self.then = (ok: (v: Answer) => unknown, no?: (e: unknown) => unknown) => Promise.resolve().then(() => shortlistFake.respond(chain, "many")).then(ok, no);
    self.single = async () => shortlistFake.respond(chain, "single");
    self.maybeSingle = async () => shortlistFake.respond(chain, "maybe");
    return self;
  },
  rpc: async (name: string, args: unknown) => { shortlistFake.rpcs.push({ name, args }); return shortlistFake.rpcAnswer(name, args); },
  functions: {
    invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
      shortlistFake.invoked.push({ fn, body: opts.body });
      return shortlistFake.invoke(fn, opts.body);
    },
  },
};

/** The arguments of a chain's first call of that name, or undefined. */
export const argsOf = (chain: Chain, name: string) => chain.ops.find(([k]) => k === name)?.[1];
/** Every call of that name in a chain. */
export const callsOf = (chain: Chain, name: string) => chain.ops.filter(([k]) => k === name).map(([, a]) => a);
/** The rows a chain asked for with range(), the way PostgREST would page them (1,000 at most without one). */
export function page<T>(chain: Chain, rows: T[]): T[] {
  const r = argsOf(chain, "range") as [number, number] | undefined;
  return r ? rows.slice(r[0], r[1] + 1) : rows.slice(0, 1000);
}
/** The Blob the page handed to URL.createObjectURL, read back as text. */
export async function blobText(b: Blob): Promise<string> {
  if (typeof (b as Blob & { text?: () => Promise<string> }).text === "function") return b.text();
  return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
}
