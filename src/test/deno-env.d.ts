/**
 * Ambient `Deno` for the frontend typechecker.
 *
 * A few `supabase/functions/_shared/*` modules are pure enough to unit-test
 * from vitest, and importing one drags it into `tsconfig.app.json` — TypeScript
 * typechecks whatever an included file imports, regardless of `exclude`. The
 * edge runtime provides `Deno`; the browser build never sees these modules, and
 * the tests stub it.
 *
 * Deliberately narrow: only the surface those shared modules actually use. A
 * blanket `declare const Deno: any` would let a genuine mistake — a real
 * `Deno.readFile` in code that vitest also runs — typecheck clean.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
};
