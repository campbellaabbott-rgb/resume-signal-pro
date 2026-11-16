/**
 * ONE supabase/functions/_shared MODULE, BUNDLED WITH ITS REMOTE IMPORTS
 * STUBBED, AND ITS EXPORTS RETURNED. For a Deno module the Node suite cannot
 * import directly because it reaches esm.sh (pro.ts reaches Stripe). A remote
 * import with no stub is a build error, never a network call.
 */
import { build, type Plugin } from "esbuild";
import { resolve } from "node:path";

const SHARED = resolve(__dirname, "../../../supabase/functions/_shared");

export async function loadSharedModule<T = Record<string, unknown>>(file: string, stubs: Record<string, string>): Promise<T> {
  const plugin: Plugin = {
    name: "shared-stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in stubs) return { path: args.path, namespace: "shared-stub" };
        if (/^(https?:|npm:|jsr:)/.test(args.path)) return { errors: [{ text: `unstubbed remote import ${args.path}` }] };
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "shared-stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
    },
  };
  const out = await build({
    entryPoints: [resolve(SHARED, file)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "es2022",
    plugins: [plugin],
    logLevel: "silent",
  });
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", out.outputFiles[0].text)(mod, mod.exports);
  return mod.exports as T;
}
