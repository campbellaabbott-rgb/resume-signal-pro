import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as acorn from "acorn";

/**
 * A CONST READ BEFORE ITS LINE IS A PAGE THAT NEVER RENDERS.
 *
 * WHAT HAPPENED. The /agents block of scripts/prerender-seo.mjs built a
 * sentence from two constants declared twelve lines below it. The sentence
 * sat behind a ternary that was false until 2026-09-16, when the host table
 * gained two rows with oauth: true (23e294ac); the literal was then evaluated,
 * read `unkeyedNames` in its temporal dead zone, and threw. The script's
 * top-level catch (its never-throw policy, :2207) logged the error and let
 * the build ship, so every page written AFTER the throw -- /agents, /pricing,
 * /changelog, /explore, /freelance-boost and the rest of the list -- was
 * served to crawlers as the homepage shell. The publish was green. Every
 * prerender guard read the script AS TEXT, and text does not have a dead
 * zone. Same class as project_ranked_path_tdz: a hoisted read of a const
 * that had not yet run, fully down, silent.
 *
 * THE PROPERTY. In scripts/prerender-seo.mjs, no statement in a block reads
 * a `const`/`let` that a LATER statement of the same block declares, where
 * "reads" means a synchronous reference -- one not wrapped in a function or
 * arrow body, which is only evaluated when called. That is exactly the TDZ
 * rule the engine enforces; a parser can state it before the engine does.
 * The file is parsed with acorn (a vite dependency, already installed) and
 * the walk is hand-written so the rule is visible here rather than in a
 * lint config nobody reads.
 *
 * TEETH. The pre-fix ordering -- the sentence above the declarations -- is
 * rebuilt below from the current file and must be reported; a reference
 * inside an arrow body, which is legal, must not be.
 */

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/prerender-seo.mjs");

type Node = acorn.Node & Record<string, any>;

/** Names a `const`/`let` declaration statement introduces. */
function declaredNames(stmt: Node): string[] {
  if (stmt.type !== "VariableDeclaration" || stmt.kind === "var") return [];
  const out: string[] = [];
  // `any`: acorn's Node type narrows the else-if chain to a union that does
  // not name every pattern kind; the runtime shapes are what matter here.
  const grab = (p: any) => {
    if (p.type === "Identifier") out.push(p.name);
    else if (p.type === "ObjectPattern") for (const prop of p.properties) grab(prop.type === "RestElement" ? prop.argument : prop.value);
    else if (p.type === "ArrayPattern") for (const el of p.elements) if (el) grab(el.type === "RestElement" ? el.argument : el);
    else if (p.type === "AssignmentPattern") grab(p.left);
  };
  for (const d of stmt.declarations) grab(d.id);
  return out;
}

/**
 * Every Identifier reference to `names` under `node` that is evaluated
 * synchronously -- the walk stops at function and arrow bodies (evaluated
 * later, legally) and at nested blocks that re-declare the name (shadowed).
 */
function syncReads(node: Node, names: Set<string>, out: Node[], parent?: Node, key?: string): void {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "FunctionDeclaration") return;
  if (node.type === "Identifier") {
    // A property name (`a.b`) or an object key (`{ b: 1 }`) is not a read.
    const isPropertyName = parent && parent.type === "MemberExpression" && key === "property" && !parent.computed;
    const isObjectKey = parent && parent.type === "Property" && key === "key" && !parent.computed;
    if (!isPropertyName && !isObjectKey && names.has(node.name)) out.push(node);
    return;
  }
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) syncReads(c, names, out, node, k);
    else if (v && typeof v === "object" && typeof v.type === "string") syncReads(v, names, out, node, k);
  }
}

/** Every block-like statement list in the program, in source order. */
function blocks(node: Node, out: Node[][] = []): Node[][] {
  if (!node || typeof node.type !== "string") return out;
  if (node.type === "Program" || node.type === "BlockStatement") out.push(node.body);
  if (node.type === "SwitchCase") out.push(node.consequent);
  for (const k of Object.keys(node)) {
    if (k === "type") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) blocks(c, out);
    else if (v && typeof v === "object" && typeof v.type === "string") blocks(v, out);
  }
  return out;
}

export function deadZoneReads(source: string): Array<{ name: string; readLine: number; declaredLine: number }> {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true }) as Node;
  const found: Array<{ name: string; readLine: number; declaredLine: number }> = [];
  for (const body of blocks(ast)) {
    for (let i = 0; i < body.length; i++) {
      const names = new Set(declaredNames(body[i]));
      if (!names.size) continue;
      for (let j = 0; j < i; j++) {
        const reads: Node[] = [];
        syncReads(body[j], names, reads);
        for (const r of reads) found.push({ name: r.name, readLine: r.loc.start.line, declaredLine: body[i].loc.start.line });
      }
    }
  }
  return found;
}

describe("a const read before its line is a page that never renders", () => {
  const src = readFileSync(SCRIPT, "utf8");

  it("the prerender script reads no const or let above the line that declares it", () => {
    const reads = deadZoneReads(src);
    expect(
      reads.map((r) => `${r.name} read at line ${r.readLine}, declared at line ${r.declaredLine}`),
      "a synchronous read above the declaration throws at runtime, the never-throw policy swallows it, and every page after the throw ships as the homepage shell -- move the declaration up",
    ).toEqual([]);
  });

  it("the /agents block declares the unkeyed names and caps before the sentence that interpolates them", () => {
    const block = src.slice(src.indexOf("const withSignIn = andList("), src.indexOf('path: "/agents",'));
    const decl = block.indexOf("const unkeyedNames");
    const use = block.indexOf("const signInSentence");
    expect(decl).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(-1);
    expect(decl, "unkeyedNames must be declared above signInSentence").toBeLessThan(use);
  });
});

describe("a const read before its line is a page that never renders -- has teeth", () => {
  const src = readFileSync(SCRIPT, "utf8");
  it("reports the exact shape that broke the 2026-09-16 bake", () => {
    const bad = `
      function page(D) {
        const withSignIn = D.hosts.length ? "x" : "";
        const sentence = withSignIn ? \`from \${withSignIn}: \${unkeyedNames}, \${unkeyedCaps}\` : "";
        const unkeyedNames = D.tools.join(", ");
        const unkeyedCaps = \`\${D.caps.perDay} a day\`;
        return sentence + unkeyedNames + unkeyedCaps;
      }
    `;
    const reads = deadZoneReads(bad).map((r) => r.name).sort();
    expect(reads).toEqual(["unkeyedCaps", "unkeyedNames"]);
  });

  it("does not report a reference inside an arrow or function body, which is evaluated later and legal", () => {
    const fine = `
      function page(D) {
        const hostBadge = (x) => (x.header ? "every tool" : unkeyedLabel);
        const render = function () { return unkeyedLabel; };
        const unkeyedLabel = "unkeyed tools only";
        return hostBadge(D) + render();
      }
    `;
    expect(deadZoneReads(fine)).toEqual([]);
  });

  it("does not report a property name or an object key that merely spells the name", () => {
    const fine = `
      function page(D) {
        const a = D.unkeyedCaps;
        const b = { unkeyedCaps: 1 };
        const unkeyedCaps = 2;
        return a + b.unkeyedCaps + unkeyedCaps;
      }
    `;
    expect(deadZoneReads(fine)).toEqual([]);
  });

  it("the current file, with the two declarations moved back below the sentence, fails the first property", () => {
    const decl = /\n\s*const unkeyedNames = codes\(D\.MCP_ANON_TOOLS\);\n\s*const unkeyedCaps = [^\n]+\n/.exec(src);
    expect(decl, "re-anchor this teeth case: the two declarations moved").not.toBeNull();
    const without = src.replace(decl![0], "\n");
    const after = without.indexOf("const unkeyedOnlySentence");
    expect(after).toBeGreaterThan(-1);
    const preFix = without.slice(0, after) + decl![0].trimStart() + without.slice(after);
    const names = deadZoneReads(preFix).map((r) => r.name).sort();
    expect(names).toEqual(["unkeyedCaps", "unkeyedNames"]);
  });
});
