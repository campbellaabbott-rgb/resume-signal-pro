/**
 * job-board/index.ts cannot be imported (it calls Deno.serve at load and imports
 * from esm.sh), so these lift a top-level function, or the block an anchor
 * names, out of the RAW source with the TypeScript parser and RUN it with every
 * free name bound to a stub. A name the lifted code reads that the test does
 * not bind throws, so a moved block fails loudly instead of passing on nothing.
 * (The same shape as a-pass-end-hop-answers-before-its-tail.test.ts.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export const INDEX = resolve(__dirname, "../../../supabase/functions/job-board/index.ts");
export const FN = (): string => readFileSync(INDEX, "utf8");

const sf = () => ts.createSourceFile("index.ts", FN(), ts.ScriptTarget.ES2022, true);

/** A top-level function's source, by name; throws when it is gone. */
export function fnSource(name: string): string {
  const SF = sf();
  const f = SF.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!f) throw new Error(`function ${name} was not found in job-board/index.ts`);
  return f.getText(SF);
}

/** A top-level `const NAME = …;` statement's source (with its type), by name. */
export function constSource(name: string): string {
  const SF = sf();
  const st = SF.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name));
  if (!st) throw new Error(`const ${name} was not found at the top level of job-board/index.ts`);
  return st.getText(SF);
}

/** The then-block of the first `if (<cond>) {` whose condition text is exactly `cond`. */
export function ifBlock(cond: string): string {
  const SF = sf();
  let found: ts.IfStatement | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isIfStatement(n) && n.expression.getText(SF) === cond) { found = n; return; }
    ts.forEachChild(n, visit);
  };
  visit(SF);
  if (!found) throw new Error(`no \`if (${cond}) {\` in job-board/index.ts`);
  const block = (found as ts.IfStatement).thenStatement as ts.Block;
  return block.statements.map((s) => s.getFullText(SF)).join("");
}

/** Compile `src` into an async function whose free names resolve through `scope` only. */
export function compile(src: string, ret: string): (scope: Record<string, unknown>) => Promise<unknown> {
  const js = ts.transpileModule(`async function __lifted() {\n${src}\n${ret}\n}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const make = new Function("__scope", `with (__scope) { ${js}\n return __lifted(); }`);
  return (deps) => {
    const scope = new Proxy(deps, {
      has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
      get: (_t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (typeof k === "string" && k in deps) return deps[k];
        throw new Error(`the lifted code reads \`${String(k)}\`, which this harness does not bind`);
      },
      set: (_t, k, v) => { (deps as Record<string | symbol, unknown>)[k] = v; return true; },
    });
    return make(scope) as Promise<unknown>;
  };
}

export type Op = [string, unknown[]];
export type Call = { table?: string; rpc?: string; ops: Op[] };

/** A supabase-js stand-in: every chain is recorded and answered by `answer` when awaited. */
export function stubClient(answer: (c: Call) => unknown, calls: Call[] = []) {
  const chain = (call: Call): unknown => {
    calls.push(call);
    const p: unknown = new Proxy(function () { /* callable */ }, {
      get(_t, prop) {
        if (prop === "then") {
          const r = Promise.resolve().then(() => answer(call));
          return r.then.bind(r);
        }
        return (...args: unknown[]) => { call.ops.push([String(prop), args]); return p; };
      },
    });
    return p;
  };
  return {
    calls,
    from: (table: string) => chain({ table, ops: [] }),
    rpc: (name: string, args?: unknown) => chain({ rpc: name, ops: [["args", [args]]] }),
  };
}

export const op = (c: Call, name: string) => c.ops.find((o) => o[0] === name);
export const eqOf = (c: Call, col: string) => c.ops.find((o) => o[0] === "eq" && o[1][0] === col)?.[1][1];
